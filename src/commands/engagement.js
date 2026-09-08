// /engagement - Full engagement campaign management system.
//
// /engagement campaign create/list/enable/disable/delete
// /engagement message add/list/delete
// /engagement preview   - dry-run: who would receive what and why
// /engagement run       - manually trigger a campaign now
// /engagement history   - recent send history for a campaign
// /engagement status    - global status of all campaigns
// /engagement toggle    - global on/off switch (emergency stop)

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const eng = require('../engagementDb');
const pnw = require('../pnwApi');
const { runCampaign } = require('../scheduler/engagementScanner');

const VALID_SCHEDULE_PRESETS = [
  { name: 'Every day (24h)', value: '24' },
  { name: 'Every 2 days (48h)', value: '48' },
  { name: 'Every 3 days (72h)', value: '72' },
  { name: 'Every week (168h)', value: '168' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('engagement')
    .setDescription('Automated member engagement & training campaign system (Admin only)')

    // ----- CAMPAIGN GROUP -----
    .addSubcommandGroup((group) =>
      group
        .setName('campaign')
        .setDescription('Manage engagement campaigns')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a new engagement campaign')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Short unique ID, e.g. "rn-beginner"').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('name').setDescription('Human-readable name, e.g. "RN Beginner Training"').setRequired(true)
            )
            .addIntegerOption((opt) =>
              opt.setName('alliance-id').setDescription('PnW alliance ID to target').setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('schedule-hours')
                .setDescription('How often to run (hours between each run)')
                .setRequired(true)
                .addChoices(...VALID_SCHEDULE_PRESETS)
            )
            .addIntegerOption((opt) =>
              opt.setName('cooldown-hours').setDescription('Minimum hours between messages to the same nation (default: 48)').setRequired(false)
            )
            .addIntegerOption((opt) =>
              opt.setName('max-messages').setDescription('Max total messages per member before they complete the campaign (default: 20)').setRequired(false)
            )
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List all campaigns and their current status'))
        .addSubcommand((sub) =>
          sub
            .setName('enable')
            .setDescription('Enable a campaign so it runs on schedule')
            .addStringOption((opt) => opt.setName('id').setDescription('Campaign ID').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('disable')
            .setDescription('Disable a campaign (stops it from running on schedule)')
            .addStringOption((opt) => opt.setName('id').setDescription('Campaign ID').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Permanently delete a campaign and all its messages and member state')
            .addStringOption((opt) => opt.setName('id').setDescription('Campaign ID').setRequired(true))
        )
    )

    // ----- MESSAGE GROUP -----
    .addSubcommandGroup((group) =>
      group
        .setName('message')
        .setDescription('Manage messages within a campaign')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a message to a campaign')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Unique message ID, e.g. "rn-beginner-001"').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('campaign').setDescription('Campaign ID this message belongs to').setRequired(true)
            )
            .addIntegerOption((opt) =>
              opt.setName('sequence').setDescription('Order in the sequence (1 = first, 2 = second, etc.)').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('Mail subject line').setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('body')
                .setDescription('Message body (max 4000 chars - use /engagement message edit for longer HTML bodies)')
                .setRequired(true)
            )
            .addIntegerOption((opt) => opt.setName('min-cities').setDescription('Minimum city count to receive this message').setRequired(false))
            .addIntegerOption((opt) => opt.setName('max-cities').setDescription('Maximum city count to receive this message').setRequired(false))
            .addIntegerOption((opt) => opt.setName('min-membership-days').setDescription('Minimum days as a member to receive this message').setRequired(false))
            .addIntegerOption((opt) => opt.setName('max-membership-days').setDescription('Maximum days as a member to receive this message').setRequired(false))
            .addIntegerOption((opt) => opt.setName('min-nation-age-days').setDescription('Minimum nation age in days').setRequired(false))
            .addIntegerOption((opt) => opt.setName('max-nation-age-days').setDescription('Maximum nation age in days').setRequired(false))
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List all messages in a campaign')
            .addStringOption((opt) => opt.setName('campaign').setDescription('Campaign ID').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Delete a message from a campaign')
            .addStringOption((opt) => opt.setName('id').setDescription('Message ID').setRequired(true))
        )
    )

    // ----- TOP-LEVEL SUBCOMMANDS -----
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Dry-run: see who would receive what message and why, without sending anything')
        .addStringOption((opt) => opt.setName('campaign').setDescription('Campaign ID').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Manually trigger a campaign to run right now (respects all safety limits)')
        .addStringOption((opt) => opt.setName('campaign').setDescription('Campaign ID').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Show recent engagement history for a campaign')
        .addStringOption((opt) => opt.setName('campaign').setDescription('Campaign ID').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show global status of all campaigns and the engagement system')
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Emergency switch: turn ALL engagement campaigns on or off globally')
        .addStringOption((opt) =>
          opt
            .setName('state')
            .setDescription('on or off')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
        )
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ==================== CAMPAIGN COMMANDS ====================

    if (group === 'campaign') {
      if (sub === 'create') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const name = interaction.options.getString('name');
        const allianceId = interaction.options.getInteger('alliance-id');
        const scheduleHours = Number(interaction.options.getString('schedule-hours'));
        const cooldownHours = interaction.options.getInteger('cooldown-hours') ?? 48;
        const maxMessages = interaction.options.getInteger('max-messages') ?? 20;

        try {
          eng.createCampaign({ id, name, allianceId, scheduleHours, cooldownHours, maxMessagesPerMember: maxMessages });
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
        }

        return interaction.reply({
          content:
            `✅ Campaign **"${name}"** (ID: \`${id}\`) created.\n\n` +
            `⚙️ Settings: alliance **#${allianceId}** | runs every **${scheduleHours}h** | cooldown **${cooldownHours}h** | max **${maxMessages}** messages/member\n\n` +
            `🛑 Campaign starts **disabled** — add messages first with \`/engagement message add\`, then enable with \`/engagement campaign enable id:${id}\`.`,
          flags: 64,
        });
      }

      if (sub === 'list') {
        const campaigns = eng.getAllCampaigns();
        if (campaigns.length === 0) {
          return interaction.reply({ content: 'No campaigns yet. Create one with `/engagement campaign create`.', flags: 64 });
        }

        const embed = new EmbedBuilder()
          .setTitle('📚 Engagement Campaigns')
          .setColor(0x3498db)
          .setDescription(
            campaigns
              .map((c) => {
                const msgs = eng.getMessagesForCampaign(c.id).length;
                const states = eng.getAllMemberStatesForCampaign(c.id);
                const completed = states.filter((s) => s.completed).length;
                return (
                  `**${c.name}** (\`${c.id}\`) — ${c.enabled ? '✅ Enabled' : '🛑 Disabled'}\n` +
                  `Alliance: #${c.allianceId} | Schedule: every ${c.scheduleHours}h | Cooldown: ${c.cooldownHours}h\n` +
                  `Messages: ${msgs} | Members tracked: ${states.length} | Completed: ${completed}\n` +
                  `Last run: ${c.lastRunAt ? new Date(c.lastRunAt).toUTCString() : 'Never'}`
                );
              })
              .join('\n\n')
              .slice(0, 4000)
          );

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (sub === 'enable') {
        const id = interaction.options.getString('id');
        const campaign = eng.getCampaign(id);
        if (!campaign) return interaction.reply({ content: `❌ Campaign "${id}" not found.`, flags: 64 });

        const msgCount = eng.getMessagesForCampaign(id).length;
        if (msgCount === 0) {
          return interaction.reply({ content: `❌ Cannot enable "${id}" — it has no messages yet. Add some with \`/engagement message add campaign:${id}\`.`, flags: 64 });
        }

        eng.setCampaignEnabled(id, true);
        return interaction.reply({ content: `✅ Campaign **"${campaign.name}"** enabled. It will run every **${campaign.scheduleHours}h** automatically.`, flags: 64 });
      }

      if (sub === 'disable') {
        const id = interaction.options.getString('id');
        const campaign = eng.getCampaign(id);
        if (!campaign) return interaction.reply({ content: `❌ Campaign "${id}" not found.`, flags: 64 });
        eng.setCampaignEnabled(id, false);
        return interaction.reply({ content: `🛑 Campaign **"${campaign.name}"** disabled.`, flags: 64 });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id');
        const campaign = eng.getCampaign(id);
        if (!campaign) return interaction.reply({ content: `❌ Campaign "${id}" not found.`, flags: 64 });
        eng.deleteCampaign(id);
        return interaction.reply({ content: `🗑️ Campaign **"${campaign.name}"** and all its messages and member state have been permanently deleted.`, flags: 64 });
      }
    }

    // ==================== MESSAGE COMMANDS ====================

    if (group === 'message') {
      if (sub === 'add') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const campaignId = interaction.options.getString('campaign');
        const sequence = interaction.options.getInteger('sequence');
        const subject = interaction.options.getString('subject');
        const body = interaction.options.getString('body');
        const minCities = interaction.options.getInteger('min-cities') ?? null;
        const maxCities = interaction.options.getInteger('max-cities') ?? null;
        const minMemberDays = interaction.options.getInteger('min-membership-days') ?? null;
        const maxMemberDays = interaction.options.getInteger('max-membership-days') ?? null;
        const minNationAge = interaction.options.getInteger('min-nation-age-days') ?? null;
        const maxNationAge = interaction.options.getInteger('max-nation-age-days') ?? null;

        try {
          eng.addEngagementMessage({
            id, campaignId, subject, body, sequenceOrder: sequence,
            minCities, maxCities, minMembershipDays: minMemberDays,
            maxMembershipDays: maxMemberDays, minNationAgeDays: minNationAge, maxNationAgeDays: maxNationAge,
          });
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
        }

        const conditions = [
          minCities != null && `cities ≥ ${minCities}`,
          maxCities != null && `cities ≤ ${maxCities}`,
          minMemberDays != null && `membership ≥ ${minMemberDays}d`,
          maxMemberDays != null && `membership ≤ ${maxMemberDays}d`,
          minNationAge != null && `nation age ≥ ${minNationAge}d`,
          maxNationAge != null && `nation age ≤ ${maxNationAge}d`,
        ].filter(Boolean);

        return interaction.reply({
          content:
            `✅ Message \`${id}\` added to campaign \`${campaignId}\` at sequence position **#${sequence}**.\n` +
            `Subject: *${subject}*\n` +
            (conditions.length > 0 ? `Eligibility conditions: ${conditions.join(', ')}` : 'No eligibility conditions — will send to all members.'),
          flags: 64,
        });
      }

      if (sub === 'list') {
        const campaignId = interaction.options.getString('campaign');
        const campaign = eng.getCampaign(campaignId);
        if (!campaign) return interaction.reply({ content: `❌ Campaign "${campaignId}" not found.`, flags: 64 });

        const messages = eng.getMessagesForCampaign(campaignId);
        if (messages.length === 0) {
          return interaction.reply({ content: `No messages in campaign \`${campaignId}\` yet. Add one with \`/engagement message add campaign:${campaignId}\`.`, flags: 64 });
        }

        const embed = new EmbedBuilder()
          .setTitle(`📋 Messages — ${campaign.name}`)
          .setColor(0x9b59b6)
          .setDescription(
            messages
              .map((m) => {
                const conditions = [
                  m.minCities != null && `cities ≥ ${m.minCities}`,
                  m.maxCities != null && `cities ≤ ${m.maxCities}`,
                  m.minMembershipDays != null && `membership ≥ ${m.minMembershipDays}d`,
                  m.maxMembershipDays != null && `membership ≤ ${m.maxMembershipDays}d`,
                ].filter(Boolean);
                return (
                  `**#${m.sequenceOrder}** \`${m.id}\`\n` +
                  `Subject: *${m.subject}*\n` +
                  (conditions.length > 0 ? `Conditions: ${conditions.join(', ')}` : 'No conditions')
                );
              })
              .join('\n\n')
              .slice(0, 4000)
          );

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id');
        const existed = eng.deleteEngagementMessage(id);
        return interaction.reply({ content: existed ? `✅ Message \`${id}\` deleted.` : `❌ Message \`${id}\` not found.`, flags: 64 });
      }
    }

    // ==================== TOP-LEVEL COMMANDS ====================

    if (sub === 'preview') {
      await interaction.deferReply({ flags: 64 });
      const campaignId = interaction.options.getString('campaign');
      const campaign = eng.getCampaign(campaignId);
      if (!campaign) return interaction.editReply(`❌ Campaign "${campaignId}" not found.`);

      const messages = eng.getMessagesForCampaign(campaignId);
      if (messages.length === 0) return interaction.editReply(`No messages in this campaign yet.`);

      await interaction.editReply(`🔍 Fetching current member list for alliance #${campaign.allianceId}...`);

      let members;
      try { members = await pnw.getAllianceMembers(campaign.allianceId); }
      catch (err) { return interaction.editReply(`❌ Could not fetch members: ${err.message}`); }

      const rows = [];
      let wouldSend = 0;
      let wouldSkip = 0;
      let wouldComplete = 0;

      for (const nation of members.slice(0, 50)) { // preview first 50 only
        const state = eng.getMemberState(campaignId, nation.id);

        if (state?.completed) { wouldComplete++; continue; }
        if (state && eng.daysSince(state.lastMessageAt) * 24 < campaign.cooldownHours) { wouldSkip++; continue; }
        if (state && state.totalSent >= campaign.maxMessagesPerMember) { wouldComplete++; continue; }

        const next = eng.getNextMessageForMember(campaignId, nation, state);

        if (!next) {
          rows.push(`⏭️ **${nation.nation_name}** — no eligible message (cities: ${nation.num_cities}, new member: ${state ? 'no' : 'yes'})`);
        } else {
          rows.push(`📨 **${nation.nation_name}** (C${nation.num_cities}) → Seq #${next.message.sequenceOrder}: *"${next.message.subject}"*`);
          wouldSend++;
        }
      }

      const preview = rows.slice(0, 20).join('\n');
      const truncated = members.length > 50 ? `\n\n*(Preview limited to first 50 members. Alliance has ${members.length} total.)*` : '';

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Preview — ${campaign.name}`)
        .setColor(0xf1c40f)
        .addFields(
          { name: 'Would send', value: String(wouldSend), inline: true },
          { name: 'In cooldown / already completed', value: String(wouldSkip + wouldComplete), inline: true },
          { name: 'Total members', value: String(members.length), inline: true },
          { name: 'Sample (first 20 eligible)', value: (preview || 'None') + truncated },
        );

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'run') {
      await interaction.deferReply({ flags: 64 });
      const campaignId = interaction.options.getString('campaign');
      const campaign = eng.getCampaign(campaignId);
      if (!campaign) return interaction.editReply(`❌ Campaign "${campaignId}" not found.`);

      await interaction.editReply(`🚀 Manually running campaign **"${campaign.name}"**...`);

      try {
        await runCampaign(campaign, interaction.client);
      } catch (err) {
        return interaction.editReply(`❌ Campaign run failed: ${err.message}`);
      }

      const recent = eng.getEngagementHistory({ campaignId, limit: 10 });
      const sentCount = recent.filter((h) => h.status === 'sent').length;

      return interaction.editReply(`✅ Manual run of **"${campaign.name}"** complete. Sent **${sentCount}** message(s) this run. Use \`/engagement history campaign:${campaignId}\` for full details.`);
    }

    if (sub === 'history') {
      const campaignId = interaction.options.getString('campaign');
      const campaign = eng.getCampaign(campaignId);
      if (!campaign) return interaction.reply({ content: `❌ Campaign "${campaignId}" not found.`, flags: 64 });

      const history = eng.getEngagementHistory({ campaignId, limit: 30 });
      if (history.length === 0) {
        return interaction.reply({ content: `No history yet for campaign \`${campaignId}\`.`, flags: 64 });
      }

      const statusEmoji = { sent: '📨', skipped: '⏭️', error: '❌', cooldown: '⏳', completed: '✅', ineligible: '🚫' };
      const lines = history.map((h) =>
        `${statusEmoji[h.status] || '•'} **${h.nationName}** — ${h.status}${h.reason ? ': ' + h.reason : ''} *(${h.sentAt.slice(0, 10)})*`
      );

      const embed = new EmbedBuilder()
        .setTitle(`📜 History — ${campaign.name}`)
        .setColor(0x95a5a6)
        .setDescription(lines.join('\n').slice(0, 4000));

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    if (sub === 'status') {
      const globalEnabled = eng.isEngagementEnabled();
      const campaigns = eng.getAllCampaigns();
      const enabled = campaigns.filter((c) => c.enabled);
      const disabled = campaigns.filter((c) => !c.enabled);

      const embed = new EmbedBuilder()
        .setTitle('📊 Engagement System Status')
        .setColor(globalEnabled ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: 'Global Switch', value: globalEnabled ? '✅ ON — campaigns are running' : '🛑 OFF — ALL campaigns paused (emergency stop)', inline: false },
          { name: 'Active Campaigns', value: enabled.length > 0 ? enabled.map((c) => `**${c.name}** — every ${c.scheduleHours}h`).join('\n') : 'None', inline: false },
          { name: 'Disabled Campaigns', value: disabled.length > 0 ? disabled.map((c) => c.name).join(', ') : 'None', inline: false },
        );

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    if (sub === 'toggle') {
      const state = interaction.options.getString('state') === 'on';
      eng.setEngagementEnabled(state);
      return interaction.reply({
        content: state
          ? '✅ Engagement system is now **ON**. All enabled campaigns will run on their schedules.'
          : '🛑 Engagement system is now **OFF**. ALL campaigns are paused globally. Re-enable with `/engagement toggle state:on`.',
        flags: 64,
      });
    }
  },
};
