// Engagement Campaign Scheduler
//
// Runs every 30 minutes. For each enabled campaign, checks whether it's
// time to run based on the campaign's scheduleHours setting and lastRunAt
// timestamp. When it's time, fetches the current member list fresh from PnW,
// evaluates each member's eligibility, and sends the next appropriate message.
//
// Key design decisions:
// - Eligibility is ALWAYS re-evaluated using live nation data, never cached.
//   A C4 member who grew to C7 since the last run will automatically stop
//   receiving C1-C5 messages.
// - Member state (which messages have been sent, where they are in the
//   sequence) is stored per-campaign per-nation and persists across runs.
// - The global engagementEnabled switch stops ALL campaigns immediately.

const cron = require('node-cron');
const pnw = require('../pnwApi');
const eng = require('../engagementDb');
const { truncateForDiscord } = require('../utils/discordText');

const MAX_PER_CAMPAIGN_RUN = 30;   // safety cap per campaign per run
const DELAY_MS = 2500;             // pause between sends

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fillTemplate(text, nation) {
  return text
    .replaceAll('{nation_name}', nation.nation_name)
    .replaceAll('{leader_name}', nation.leader_name)
    .replaceAll('{nation}', nation.nation_name)
    .replaceAll('{leader}', nation.leader_name);
}

function hoursSince(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60);
}

async function runCampaign(campaign, client) {
  const logChannelId = process.env.MAIL_LOG_CHANNEL_ID;
  const logChannel = logChannelId
    ? await client.channels.fetch(logChannelId).catch(() => null)
    : null;

  // Fetch fresh member list from PnW
  let members;
  try {
    members = await pnw.getAllianceMembers(campaign.allianceId);
  } catch (err) {
    console.error(`❌ Engagement [${campaign.name}]: failed to fetch members: ${err.message}`);
    return;
  }

  if (members.length === 0) {
    console.log(`⚠️ Engagement [${campaign.name}]: alliance has no members, skipping.`);
    return;
  }

  const messages = eng.getMessagesForCampaign(campaign.id);
  if (messages.length === 0) {
    console.log(`⚠️ Engagement [${campaign.name}]: no enabled messages configured, skipping.`);
    return;
  }

  let sent = 0;
  let skipped = 0;
  let ineligible = 0;
  let errors = 0;

  for (const nation of members) {
    if (sent >= MAX_PER_CAMPAIGN_RUN) break;

    // Init or get member state (firstSeenAt is set here if first time we see this member)
    const state = eng.initMemberState(campaign.id, nation.id);

    // Already completed this campaign
    if (state.completed) { skipped++; continue; }

    // Reached max messages for this member
    if (state.totalSent >= campaign.maxMessagesPerMember) {
      eng.updateMemberState(campaign.id, nation.id, { completed: true });
      eng.logEngagementHistory({ campaignId: campaign.id, nationId: nation.id, nationName: nation.nation_name, status: 'completed', reason: 'Reached max messages per member' });
      skipped++;
      continue;
    }

    // In cooldown
    if (state.lastMessageAt && hoursSince(state.lastMessageAt) < campaign.cooldownHours) {
      skipped++;
      continue;
    }

    // Find next eligible message (re-evaluated with live nation data)
    const next = eng.getNextMessageForMember(campaign.id, nation, state);

    if (!next) {
      // Check if they've exhausted all messages (completed)
      const allSent = messages.every((m) => state.messagesSent.includes(m.id));
      if (allSent) {
        eng.updateMemberState(campaign.id, nation.id, { completed: true });
        eng.logEngagementHistory({ campaignId: campaign.id, nationId: nation.id, nationName: nation.nation_name, status: 'completed', reason: 'All eligible messages sent' });
      } else {
        eng.logEngagementHistory({ campaignId: campaign.id, nationId: nation.id, nationName: nation.nation_name, status: 'ineligible', reason: 'No eligible messages match current nation state' });
        ineligible++;
      }
      continue;
    }

    const { message } = next;
    const subject = fillTemplate(message.subject, nation);
    const body = fillTemplate(message.body, nation);

    try {
      await pnw.sendMail(nation.id, subject, body);
    } catch (err) {
      console.error(`❌ Engagement [${campaign.name}] failed for #${nation.id}: ${err.message}`);
      eng.logEngagementHistory({ campaignId: campaign.id, messageId: message.id, nationId: nation.id, nationName: nation.nation_name, status: 'error', reason: err.message });
      errors++;
      continue;
    }

    // Update member state
    eng.updateMemberState(campaign.id, nation.id, {
      currentSequence: message.sequenceOrder,
      lastMessageAt: new Date().toISOString(),
      totalSent: state.totalSent + 1,
      messagesSent: [...state.messagesSent, message.id],
    });

    eng.logEngagementHistory({
      campaignId: campaign.id,
      messageId: message.id,
      nationId: nation.id,
      nationName: nation.nation_name,
      status: 'sent',
      reason: `Seq #${message.sequenceOrder}: "${message.subject}"`,
    });

    sent++;
    await sleep(DELAY_MS);
  }

  // Update lastRunAt
  eng.setCampaignLastRunAt(campaign.id, new Date().toISOString());

  const summary = `✅ Engagement [${campaign.name}]: sent ${sent}, skipped ${skipped}, ineligible ${ineligible}, errors ${errors}.`;
  console.log(summary);

  if (logChannel && sent > 0) {
    await logChannel.send(
      `📚 **Engagement Campaign Run: ${campaign.name}**\n` +
        `Sent: **${sent}** | Skipped: **${skipped}** | Ineligible: **${ineligible}** | Errors: **${errors}**`
    ).catch(() => {});
  }
}

async function runEngagementScheduler(client) {
  if (!eng.isEngagementEnabled()) return;

  const campaigns = eng.getAllCampaigns().filter((c) => c.enabled);
  if (campaigns.length === 0) return;

  for (const campaign of campaigns) {
    const hoursSinceLastRun = campaign.lastRunAt ? hoursSince(campaign.lastRunAt) : Infinity;
    if (hoursSinceLastRun < campaign.scheduleHours) continue; // not time yet

    console.log(`🔄 Engagement: running campaign "${campaign.name}"...`);
    await runCampaign(campaign, client).catch((err) =>
      console.error(`❌ Engagement campaign "${campaign.name}" crashed:`, err.message)
    );
  }
}

function startEngagementScheduler(client) {
  // Checks every 30 minutes whether any campaign is due to run
  cron.schedule('*/30 * * * *', () => {
    runEngagementScheduler(client).catch((err) =>
      console.error('❌ Engagement scheduler error:', err.message)
    );
  });
  console.log('🔄 Engagement campaign scheduler started (checks every 30 minutes).');
}

module.exports = { startEngagementScheduler, runEngagementScheduler, runCampaign };
