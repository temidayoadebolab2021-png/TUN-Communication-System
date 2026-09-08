// This runs automatically every 5 minutes in the background.
// It checks Politics & War for brand-new nations, and if auto-recruit is ON,
// mails each new one a random template - while making sure to NEVER mail the
// same nation twice (Module 13 safety: duplicate-mail protection).

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');
const { getOrCreateRecruitThread } = require('../utils/threads');
const { truncateForDiscord } = require('../utils/discordText');

// How many new nations we'll mail in a single run, at most.
// This protects against accidentally mass-mailing hundreds of nations
// in one go if the bot was off for a long time.
const MAX_PER_RUN = 15;

// A short pause between each mail we send, so we don't hammer PnW's API
// with a burst of requests all at once.
const DELAY_BETWEEN_SENDS_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fillTemplate(text, nation) {
  // Supports both our own placeholders AND PnW's native ones
  return text
    .replaceAll('{nation_name}', nation.nation_name)
    .replaceAll('{leader_name}', nation.leader_name)
    .replaceAll('{nation}', nation.nation_name)
    .replaceAll('{leader}', nation.leader_name);
}

async function runScan(client) {
  const autoEnabled = Boolean(db.getSetting('autoRecruitEnabled'));

  let candidates;
  try {
    candidates = await pnw.getRecentUnalignedNations(50);
  } catch (err) {
    console.error('❌ New-nation scan failed to fetch nations:', err.message);
    return;
  }

  // Only look at nations we haven't seen before.
  const freshNations = candidates.filter((n) => !db.isKnownNation(n.id));

  if (freshNations.length === 0) {
    return; // nothing new, nothing to do
  }

  const logChannelId = db.getMailLogChannelId();
  const logChannel = logChannelId ? await client.channels.fetch(logChannelId).catch(() => null) : null;

  let sentCount = 0;

  for (const nation of freshNations) {
    // Mark it known immediately, regardless of whether we mail it, so we
    // never process the same nation twice even if something fails below.
    db.markNationKnown(nation.id);

    if (!autoEnabled) continue;
    if (sentCount >= MAX_PER_RUN) continue;

    const template = db.getRandomTemplate('initial');
    if (!template) continue; // no templates saved yet, nothing to send

    const subject = fillTemplate(template.subject, nation);
    const body = fillTemplate(template.body, nation);

    try {
      await pnw.sendMail(nation.id, subject, body);
    } catch (err) {
      console.error(`❌ Auto-recruit mail failed for nation #${nation.id}:`, err.message);
      continue;
    }

    db.addMailLog({
      nationId: nation.id,
      direction: 'outgoing',
      subject,
      message: body,
      sentBy: 'auto-recruit-system',
    });
    db.touchLastContacted(nation.id);
    db.setInitialAttributionIfMissing(nation.id, template.id, 'auto-recruit-system');
    sentCount++;

    if (logChannel) {
      try {
        const thread = await getOrCreateRecruitThread(client, nation.id, nation.nation_name);
        const embed = new EmbedBuilder()
          .setTitle('🎯 NEW PLAYER AUTO-RECRUITED')
          .addFields(
            { name: 'Nation', value: `${nation.nation_name} (#${nation.id})` },
            { name: 'Template Used', value: template.id },
            { name: 'Mail Status', value: '✅ Success' }
          )
          .setColor(0xf1c40f)
          .setTimestamp();
        await thread.send({ embeds: [embed] });
        await thread.send({ content: truncateForDiscord(body, '**Message:**\n') });
      } catch (err) {
        console.error('❌ Could not post auto-recruit log to thread:', err.message);
      }
    }

    await sleep(DELAY_BETWEEN_SENDS_MS);
  }

  if (sentCount > 0) {
    console.log(`✅ Auto-recruit run complete: mailed ${sentCount} new nation(s).`);
  }
}

function startNewNationScanner(client) {
  // Runs at minute 0, 5, 10, 15... of every hour.
  cron.schedule('*/5 * * * *', () => {
    runScan(client).catch((err) => console.error('❌ Scanner crashed:', err));
  });
  console.log('🔄 New-nation scanner started (checks every 5 minutes).');
}

module.exports = { startNewNationScanner, runScan };
