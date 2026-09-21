// Personal Recruit Scanner
//
// Runs every 5 minutes alongside the shared alliance scanner.
// For each staff member who has:
//   a) auto-recruit enabled
//   b) a personal API key registered
//   c) at least one personal template of type 'initial'
//
// ...it fetches recent unaligned nations and mails any it hasn't
// seen before, using THAT staff member's API key (so mail appears
// from their nation in-game) and THEIR private template pool.
//
// Each staff member has their own knownNationIds set, so they never
// double-mail the same nation. However, the SHARED alliance scanner's
// known nations list is also checked — we don't want the alliance
// system and a staff member to both mail the same new nation.

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');
const prDb = require('../personalRecruitDb');
const { getOrCreateRecruitThread } = require('../utils/threads');
const { truncateForDiscord } = require('../utils/discordText');

const MAX_PER_RUN = 15;
const DELAY_MS = 2000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fillTemplate(text, nation) {
  return text
    .replaceAll('{nation_name}', nation.nation_name)
    .replaceAll('{leader_name}', nation.leader_name)
    .replaceAll('{nation}', nation.nation_name)
    .replaceAll('{leader}', nation.leader_name);
}

async function runPersonalScanForStaff(userId, client) {
  const profile = prDb.getProfile(userId);
  if (!profile || !profile.autoRecruitEnabled) return;

  const apiKey = db.getPersonalApiKey(userId);
  if (!apiKey) {
    console.warn(`⚠️ Personal auto-recruit: user ${userId} has auto-recruit ON but no API key registered. Skipping.`);
    return;
  }

  const template = prDb.getRandomPersonalTemplate(userId, 'initial');
  if (!template) {
    console.warn(`⚠️ Personal auto-recruit: user ${userId} has no 'initial' templates. Skipping.`);
    return;
  }

  let candidates;
  try {
    candidates = await pnw.getRecentUnalignedNations(50);
  } catch (err) {
    console.error(`❌ Personal auto-recruit (${userId}): failed to fetch nations: ${err.message}`);
    return;
  }

  // Filter out nations already known to this staff member OR to the shared system
  const fresh = candidates.filter(
    (n) => !prDb.isPersonalKnownNation(userId, n.id) && !db.isKnownNation(n.id)
  );

  if (fresh.length === 0) return;

  const logChannelId = db.getMailLogChannelId();
  const logChannel = logChannelId
    ? await client.channels.fetch(logChannelId).catch(() => null)
    : null;

  let sentCount = 0;

  for (const nation of fresh) {
    // Mark known immediately so a crash mid-loop never causes a double-send
    prDb.markPersonalNationKnown(userId, nation.id);
    if (sentCount >= MAX_PER_RUN) continue;
    if (db.isBlacklisted(nation.id)) continue;

    const chosenTemplate = prDb.getRandomPersonalTemplate(userId, 'initial');
    if (!chosenTemplate) continue;

    const subject = fillTemplate(chosenTemplate.subject, nation);
    const body = fillTemplate(chosenTemplate.body, nation);

    try {
      await pnw.sendMail(nation.id, subject, body, apiKey);
    } catch (err) {
      console.error(`❌ Personal auto-recruit (${userId}) failed for #${nation.id}: ${err.message}`);
      continue;
    }

    db.addMailLog({
      nationId: nation.id,
      direction: 'outgoing',
      subject,
      message: body,
      sentBy: userId,
    });
    db.touchLastContacted(nation.id);
    sentCount++;

    if (logChannel) {
      try {
        const thread = await getOrCreateRecruitThread(client, nation.id, nation.nation_name);
        const embed = new EmbedBuilder()
          .setTitle('🎯 PERSONAL AUTO-RECRUIT SENT')
          .addFields(
            { name: 'Nation', value: `${nation.nation_name} (#${nation.id})` },
            { name: 'Template', value: chosenTemplate.id },
            { name: 'Recruiter', value: `<@${userId}>` }
          )
          .setColor(0xe67e22)
          .setTimestamp();
        await thread.send({ embeds: [embed] });
        await thread.send({ content: truncateForDiscord(body, '**Message:**\n') });
      } catch (err) {
        console.error(`❌ Could not log personal auto-recruit thread: ${err.message}`);
      }
    }

    await sleep(DELAY_MS);
  }

  if (sentCount > 0) {
    console.log(`✅ Personal auto-recruit (${userId}): mailed ${sentCount} nation(s).`);
  }
}

async function runAllPersonalScanners(client) {
  const profiles = prDb.getAllProfiles();
  const active = profiles.filter((p) => p.autoRecruitEnabled);
  if (active.length === 0) return;

  for (const profile of active) {
    await runPersonalScanForStaff(profile.userId, client).catch((err) =>
      console.error(`❌ Personal auto-recruit crashed for ${profile.userId}:`, err.message)
    );
  }
}

function startPersonalRecruitScanner(client) {
  cron.schedule('*/5 * * * *', () => {
    runAllPersonalScanners(client).catch((err) =>
      console.error('❌ Personal recruit scanner error:', err.message)
    );
  });
  console.log('🔄 Personal recruit scanner started (checks every 5 minutes).');
}

module.exports = { startPersonalRecruitScanner, runAllPersonalScanners };
