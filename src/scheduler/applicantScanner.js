// Applicant & Demotion Scanner
//
// Runs every 5 minutes. Checks your alliance's current applicants and
// full members, then compares against the last known snapshot to detect:
//
// 1. NEW APPLICANT — a nation just applied to your alliance.
//    → Sends them the configurable "applicant welcome / join Discord" message.
//
// 2. DEMOTED MEMBER — a nation that was a full member is now an applicant.
//    → Sends them the configurable "you've been demoted" message.
//
// Unlike the alliance-departure scanner, this uses REAL confirmed API data:
// PnW's GraphQL schema has an alliance_position field with an APPLICANT value,
// so this detection is direct, not inferred.
//
// Your alliance ID must be configured via /config alliance-id for this to work.

const cron = require('node-cron');
const pnw = require('../pnwApi');
const db = require('../database');
const { truncateForDiscord } = require('../utils/discordText');

const DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fillTemplate(text, nation) {
  return text
    .replaceAll('{nation_name}', nation.nation_name)
    .replaceAll('{leader_name}', nation.leader_name)
    .replaceAll('{nation}', nation.nation_name)
    .replaceAll('{leader}', nation.leader_name);
}

async function runApplicantScan(client) {
  const allianceId = db.getSetting('myAllianceId');
  if (!allianceId) return; // not configured yet, nothing to do

  let applicants, members;
  try {
    [applicants, members] = await Promise.all([
      pnw.getMyApplicants(allianceId),
      pnw.getMyMembers(allianceId),
    ]);
  } catch (err) {
    console.error('❌ Applicant scanner failed to fetch data:', err.message);
    return;
  }

  const applicantMap = {};
  for (const a of applicants) applicantMap[String(a.id)] = a;

  const memberMap = {};
  for (const m of members) memberMap[String(m.id)] = m;

  // --- First ever run: silent backfill ---
  if (!db.isApplicantBackfillDone()) {
    db.setKnownApplicants(applicantMap);
    db.setKnownMembers(memberMap);
    db.setApplicantBackfillDone();
    console.log(
      `🔄 Applicant scanner: backfill complete. ` +
        `Tracking ${applicants.length} applicant(s) and ${members.length} member(s). ` +
        `No messages sent this run.`
    );
    return;
  }

  const prevApplicants = db.getKnownApplicants();
  const prevMembers = db.getKnownMembers();

  const logChannelId = db.getMailLogChannelId();
  const logChannel = logChannelId
    ? await client.channels.fetch(logChannelId).catch(() => null)
    : null;

  // --- Detect new applicants ---
  const applicantMsg = db.getApplicantMessage();
  for (const [id, nation] of Object.entries(applicantMap)) {
    if (prevApplicants[id]) continue; // already knew about this one

    console.log(`📥 New applicant detected: ${nation.nation_name} (#${id})`);

    if (logChannel) {
      await logChannel.send(
        `📥 **NEW APPLICANT**\n**Nation:** ${nation.nation_name} (#${id})\n**Leader:** ${nation.leader_name}\n**Score:** ${nation.score} | **Cities:** ${nation.num_cities}`
      ).catch(() => {});
    }

    if (applicantMsg.subject && applicantMsg.body) {
      const subject = fillTemplate(applicantMsg.subject, nation);
      const body = fillTemplate(applicantMsg.body, nation);
      try {
        await pnw.sendMail(Number(id), subject, body);
        db.addMailLog({ nationId: Number(id), direction: 'outgoing', subject, message: body, sentBy: 'applicant-system' });
        console.log(`✅ Sent applicant welcome message to ${nation.nation_name}`);
      } catch (err) {
        console.error(`❌ Failed to send applicant message to ${nation.nation_name}:`, err.message);
      }
      await sleep(DELAY_MS);
    }
  }

  // --- Detect demoted members (were full members, now applicants) ---
  const demotionMsg = db.getDemotionMessage();
  for (const [id, nation] of Object.entries(applicantMap)) {
    if (!prevMembers[id]) continue; // wasn't a member before, not a demotion

    console.log(`⬇️  Demotion detected: ${nation.nation_name} (#${id}) dropped from member to applicant`);

    if (logChannel) {
      await logChannel.send(
        `⬇️ **MEMBER DEMOTED TO APPLICANT**\n**Nation:** ${nation.nation_name} (#${id})\n**Leader:** ${nation.leader_name}`
      ).catch(() => {});
    }

    if (demotionMsg.subject && demotionMsg.body) {
      const subject = fillTemplate(demotionMsg.subject, nation);
      const body = fillTemplate(demotionMsg.body, nation);
      try {
        await pnw.sendMail(Number(id), subject, body);
        db.addMailLog({ nationId: Number(id), direction: 'outgoing', subject, message: body, sentBy: 'demotion-system' });
        console.log(`✅ Sent demotion message to ${nation.nation_name}`);
      } catch (err) {
        console.error(`❌ Failed to send demotion message to ${nation.nation_name}:`, err.message);
      }
      await sleep(DELAY_MS);
    }
  }

  // Save updated snapshots for next run
  db.setKnownApplicants(applicantMap);
  db.setKnownMembers(memberMap);
}

function startApplicantScanner(client) {
  cron.schedule('*/5 * * * *', () => {
    runApplicantScan(client).catch((err) =>
      console.error('❌ Applicant scanner crashed:', err)
    );
  });
  console.log('🔄 Applicant & demotion scanner started (checks every 5 minutes).');
}

module.exports = { startApplicantScanner, runApplicantScan };
