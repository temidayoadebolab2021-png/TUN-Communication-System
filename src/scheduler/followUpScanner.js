// This runs automatically once a day. For every recruit who is still sitting
// at the "New" stage (meaning staff hasn't manually moved them forward, which
// is our best signal that nobody has replied yet - PnW's API has no way to
// read inbox replies), it sends an automatic follow-up at roughly 3, 7, and
// 14 days after the FIRST contact.
//
// This only runs against recruits already in our database (i.e. nations
// we've already contacted at least once) - it never reaches out to anyone new.

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');
const { getOrCreateRecruitThread } = require('../utils/threads');
const { truncateForDiscord } = require('../utils/discordText');

const FOLLOW_UP_THRESHOLDS = {
  1: 3, // follow_up_stage 0 -> 1 once 3+ days have passed since first contact
  2: 7, // follow_up_stage 1 -> 2 once 7+ days have passed
  3: 14, // follow_up_stage 2 -> 3 (final) once 14+ days have passed
};

const DELAY_BETWEEN_SENDS_MS = 2000;
const MAX_PER_RUN = 30; // safety cap, same philosophy as the other scanners

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fillTemplate(text, nation) {
  // Supports both our own placeholders AND PnW's native ones
  return text.replaceAll('{nation_name}', nation.nation_name)
    .replaceAll('{leader_name}', nation.leader_name)
    .replaceAll('{nation}', nation.nation_name)
    .replaceAll('{leader}', nation.leader_name);
}

function daysSince(isoString) {
  if (!isoString) return -1;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Figures out which follow-up (if any) a recruit is due for right now,
 * based on how long it's been since their FIRST contact (created_at).
 */
function getDueFollowUpStage(recruit) {
  const currentStage = recruit.follow_up_stage || 0;
  const ageInDays = daysSince(recruit.created_at);

  for (const [nextStage, thresholdDays] of Object.entries(FOLLOW_UP_THRESHOLDS)) {
    const stageNum = Number(nextStage);
    if (currentStage < stageNum && ageInDays >= thresholdDays) {
      return stageNum;
    }
  }
  return null; // not due for anything yet
}

async function runFollowUpScan(client) {
  const allRecruits = db.getAllRecruits();

  // Only recruits still at "New" stage and not blacklisted are candidates -
  // anyone moved to Interested/Joined/Rejected/etc. has effectively "replied"
  // from our tracking perspective, so we leave them alone.
  const candidates = allRecruits.filter((r) => r.stage === 'New' && !db.isBlacklisted(r.nation_id));

  const logChannelId = db.getMailLogChannelId();
  const logChannel = logChannelId ? await client.channels.fetch(logChannelId).catch(() => null) : null;

  let sentCount = 0;

  for (const recruit of candidates) {
    if (sentCount >= MAX_PER_RUN) break;

    const dueStage = getDueFollowUpStage(recruit);
    if (!dueStage) continue;

    const templateType = `followup${dueStage}`;
    const template = db.getRandomTemplate(templateType);
    if (!template) continue; // no template of this type exists yet, skip silently

    let nation;
    try {
      nation = await pnw.getNation(recruit.nation_id);
    } catch (err) {
      console.error(`❌ Follow-up scan: could not look up nation #${recruit.nation_id}:`, err.message);
      continue;
    }
    if (!nation) continue; // nation no longer exists

    const subject = fillTemplate(template.subject, nation);
    const body = fillTemplate(template.body, nation);

    try {
      await pnw.sendMail(nation.id, subject, body);
    } catch (err) {
      console.error(`❌ Follow-up mail failed for nation #${nation.id}:`, err.message);
      continue;
    }

    db.addMailLog({
      nationId: nation.id,
      direction: 'outgoing',
      subject,
      message: body,
      sentBy: 'follow-up-system',
    });
    db.touchLastContacted(nation.id);
    db.setFollowUpStage(nation.id, dueStage);
    sentCount++;

    if (logChannel) {
      try {
        const thread = await getOrCreateRecruitThread(client, nation.id, nation.nation_name);
        const embed = new EmbedBuilder()
          .setTitle(`📨 FOLLOW-UP #${dueStage} SENT`)
          .addFields(
            { name: 'Nation', value: `${nation.nation_name} (#${nation.id})` },
            { name: 'Template Used', value: template.id }
          )
          .setColor(0x95a5a6)
          .setTimestamp();
        await thread.send({ embeds: [embed] });
        await thread.send({ content: truncateForDiscord(body, '**Message:**\n') });
      } catch (err) {
        console.error('❌ Could not post follow-up log to thread:', err.message);
      }
    }

    await sleep(DELAY_BETWEEN_SENDS_MS);
  }

  if (sentCount > 0) {
    console.log(`✅ Follow-up scan complete: sent ${sentCount} follow-up(s).`);
  }
}

function startFollowUpScanner(client) {
  // Runs once a day at 09:00 (server time - on Railway this is UTC by default).
  cron.schedule('0 9 * * *', () => {
    runFollowUpScan(client).catch((err) => console.error('❌ Follow-up scanner crashed:', err));
  });
  console.log('🔄 Follow-up scanner started (checks once daily).');
}

module.exports = { startFollowUpScanner, runFollowUpScan };
