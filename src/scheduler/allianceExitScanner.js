// Alliance-Exit Recruiting (Module 3 from the original spec).
//
// IMPORTANT - read this before trusting what this does:
// Politics & War's API has no "alliance history" field anywhere - there is
// no way to directly ask "who left an alliance in the last day". This
// scanner works entirely by INFERENCE instead: every day, it looks at all
// established (not brand-new) nations with no alliance, and compares that
// list to what it saw yesterday. Anyone NEW on that list - who wasn't there
// before - is assumed to have just left an alliance, since the only way an
// established nation becomes unaligned is by leaving (or being kicked from,
// or having disbanded) one.
//
// This means it CANNOT tell you why someone left, and it CANNOT catch
// someone who left and immediately joined a different alliance before the
// next daily check runs - they'd never show up as unaligned in our data at all.
//
// The very first time this ever runs, EVERY currently-unaligned established
// nation would look "new" - so the first run is a silent "backfill" that
// just records who's currently unaligned without mailing anyone. Only runs
// AFTER that first one can meaningfully detect real departures.

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');
const { getOrCreateRecruitThread } = require('../utils/threads');
const { truncateForDiscord } = require('../utils/discordText');

// Only consider nations at least this many days old, so we never overlap
// with the new-nation scanner (which already handles genuinely brand-new
// accounts on its own 5-minute cycle).
const MIN_AGE_DAYS = 3;

const MAX_PER_RUN = 20;
const DELAY_BETWEEN_SENDS_MS = 2000;
const SEARCH_MAX_PAGES = 15;

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
  if (!isoString) return 0;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

async function runAllianceExitScan(client) {
  let pool;
  try {
    // No score/city filters - we want every established unaligned nation,
    // regardless of size, since we don't know in advance who's "worth" recruiting.
    pool = await pnw.searchUnalignedNations({ excludeVacationMode: true, maxPages: SEARCH_MAX_PAGES });
  } catch (err) {
    console.error('❌ Alliance-exit scan failed to fetch nations:', err.message);
    return;
  }

  const established = pool.filter((n) => daysSince(n.date) >= MIN_AGE_DAYS);

  // ---------- First-ever run: silent backfill, no mailing ----------
  if (!db.isDepartureBackfillDone()) {
    for (const nation of established) {
      db.markDepartureKnown(nation.id);
    }
    db.setDepartureBackfillDone();
    console.log(
      `🔄 Alliance-exit scanner: completed initial backfill of ${established.length} existing unaligned nation(s). ` +
        `No mail sent this run - future runs will detect real departures from here.`
    );
    return;
  }

  // ---------- Normal run: anyone NEW in this pool is a likely departure ----------
  const newlyUnaligned = established.filter((n) => !db.isKnownDeparture(n.id));

  if (newlyUnaligned.length === 0) return;

  const autoEnabled = Boolean(db.getSetting('autoRecruitEnabled'));
  const logChannelId = db.getMailLogChannelId();
  const logChannel = logChannelId ? await client.channels.fetch(logChannelId).catch(() => null) : null;

  let sentCount = 0;

  for (const nation of newlyUnaligned) {
    db.markDepartureKnown(nation.id);

    if (!autoEnabled) continue;
    if (db.isBlacklisted(nation.id)) continue;
    if (sentCount >= MAX_PER_RUN) continue;

    const existingRecruit = db.getRecruit(nation.id);
    if (existingRecruit && daysSince(existingRecruit.last_contacted_at) < 7) continue; // cooldown

    const template = db.getRandomTemplate('departure') || db.getRandomTemplate('initial');
    if (!template) continue; // no usable template exists at all yet

    const subject = fillTemplate(template.subject, nation);
    const body = fillTemplate(template.body, nation);

    try {
      await pnw.sendMail(nation.id, subject, body);
    } catch (err) {
      console.error(`❌ Alliance-exit mail failed for nation #${nation.id}:`, err.message);
      continue;
    }

    db.addMailLog({
      nationId: nation.id,
      direction: 'outgoing',
      subject,
      message: body,
      sentBy: 'alliance-exit-system',
    });
    db.touchLastContacted(nation.id);
    db.setInitialAttributionIfMissing(nation.id, template.id, 'alliance-exit-system');
    sentCount++;

    if (logChannel) {
      try {
        const thread = await getOrCreateRecruitThread(client, nation.id, nation.nation_name);
        const embed = new EmbedBuilder()
          .setTitle('🚪 LIKELY ALLIANCE DEPARTURE - RECRUITED')
          .addFields(
            { name: 'Nation', value: `${nation.nation_name} (#${nation.id})` },
            { name: 'Template Used', value: template.id },
            {
              name: 'Note',
              value: 'Detected as newly unaligned (inferred departure - PnW\'s API cannot confirm the actual reason).',
            }
          )
          .setColor(0xe67e22)
          .setTimestamp();
        await thread.send({ embeds: [embed] });
        await thread.send({ content: truncateForDiscord(body, '**Message:**\n') });
      } catch (err) {
        console.error('❌ Could not post alliance-exit log to thread:', err.message);
      }
    }

    await sleep(DELAY_BETWEEN_SENDS_MS);
  }

  if (sentCount > 0) {
    console.log(`✅ Alliance-exit scan complete: mailed ${sentCount} likely departure(s).`);
  }
}

function startAllianceExitScanner(client) {
  // Runs once a day at 10:00 (server time) - offset from the other daily
  // scanner (follow-ups at 09:00) so they don't compete for API calls at once.
  cron.schedule('0 10 * * *', () => {
    runAllianceExitScan(client).catch((err) => console.error('❌ Alliance-exit scanner crashed:', err));
  });
  console.log('🔄 Alliance-exit scanner started (checks once daily).');
}

module.exports = { startAllianceExitScanner, runAllianceExitScan };
