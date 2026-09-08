// /recruit template create/list/delete - manage recruitment message templates
// /recruit auto on/off - turn automatic new-nation recruiting on or off
// /recruit status - see current auto-recruit settings
// /recruit stage - set a recruit's pipeline stage
// /recruit profile - view a recruit's full CRM profile
// /recruit assign - assign a recruit to a staff member
// /recruit stats - recruitment statistics dashboard
// /recruit bulk - mail many nations at once matching filters (dry-run by default)

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const pnw = require('../pnwApi');
const { resolveNation } = require('../utils/resolveNation');
const { getOrCreateRecruitThread } = require('../utils/threads');
const { calculateRecruitScore } = require('../utils/recruitScore');
const { truncateForDiscord } = require('../utils/discordText');
const { canSendRecruitmentMail } = require('../utils/permissions');

const VALID_STAGES = ['New', 'Interested', 'Interviewing', 'Invited', 'Joined', 'Rejected', 'Blacklisted'];

// Safety caps for bulk sending - see Module 13 in the original spec.
const BULK_MAX_SEND = 30;
const BULK_DELAY_MS = 2000;
const COOLDOWN_DAYS = 7; // never re-mail the same nation within this many days

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
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Recruitment automation and tracking')
    .addSubcommandGroup((group) =>
      group
        .setName('template')
        .setDescription('Manage recruitment message templates')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a new recruitment template')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Short unique ID, e.g. "friendly1"').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('Mail subject line').setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('body')
                .setDescription('Message body. Use {nation_name} and {leader_name} as placeholders.')
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('type')
                .setDescription('When this template is used (default: initial)')
                .setRequired(false)
                .addChoices(
                  { name: 'initial (first contact - new nations/bulk recruiting)', value: 'initial' },
                  { name: 'followup1 (sent ~3 days after first contact)', value: 'followup1' },
                  { name: 'followup2 (sent ~7 days after first contact)', value: 'followup2' },
                  { name: 'followup3 (final follow-up, ~14 days)', value: 'followup3' },
                  { name: 'departure (sent to nations who left an alliance)', value: 'departure' }
                )
            )
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List all saved templates'))
        .addSubcommand((sub) =>
          sub.setName('stats').setDescription('A/B testing report: which templates lead to the most joins')
        )
        .addSubcommand((sub) =>
          sub
            .setName('edit')
            .setDescription('Edit an existing template (only fill in the fields you want to change)')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Template ID to edit').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('New subject line (leave blank to keep current)').setRequired(false)
            )
            .addStringOption((opt) =>
              opt.setName('body').setDescription('New message body (leave blank to keep current)').setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('type')
                .setDescription('Change the template type (leave blank to keep current)')
                .setRequired(false)
                .addChoices(
                  { name: 'initial (first contact)', value: 'initial' },
                  { name: 'followup1 (~3 days)', value: 'followup1' },
                  { name: 'followup2 (~7 days)', value: 'followup2' },
                  { name: 'followup3 (final, ~14 days)', value: 'followup3' },
                  { name: 'departure (left an alliance)', value: 'departure' }
                )
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Delete a template')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Template ID to delete').setRequired(true)
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('auto')
        .setDescription('Turn automatic new-nation recruiting on or off')
        .addStringOption((opt) =>
          opt
            .setName('state')
            .setDescription('on or off')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
        )
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show auto-recruit status and stats'))
    .addSubcommand((sub) =>
      sub
        .setName('stage')
        .setDescription("Set a recruit's pipeline stage")
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('stage')
            .setDescription('New stage')
            .setRequired(true)
            .addChoices(...VALID_STAGES.map((s) => ({ name: s, value: s })))
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription("View a recruit's full profile")
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('score')
        .setDescription("See a recruit's quality score and why it was scored that way")
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('assign')
        .setDescription('Assign a recruit to a staff member')
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
        .addUserOption((opt) =>
          opt.setName('staff').setDescription('Staff member to assign').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('note')
        .setDescription('Add or update notes on a recruit')
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
        .addStringOption((opt) => opt.setName('text').setDescription('Note text').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('stats').setDescription('Recruitment statistics dashboard'))
    .addSubcommand((sub) =>
      sub.setName('attribution').setDescription('See which template/sender brought in each joined recruit')
    )
    .addSubcommand((sub) =>
      sub
        .setName('bulk')
        .setDescription('Mail many unaligned nations at once matching filters (dry-run by default)')
        .addIntegerOption((opt) => opt.setName('score-min').setDescription('Minimum score').setRequired(false))
        .addIntegerOption((opt) => opt.setName('score-max').setDescription('Maximum score').setRequired(false))
        .addIntegerOption((opt) => opt.setName('cities-min').setDescription('Minimum city count').setRequired(false))
        .addIntegerOption((opt) => opt.setName('cities-max').setDescription('Maximum city count').setRequired(false))
        .addBooleanOption((opt) =>
          opt
            .setName('exclude-vacation-mode')
            .setDescription('Skip nations currently in vacation mode (default: true)')
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt.setName('confirm').setDescription('Set to true to actually send (default: dry-run only)').setRequired(false)
        )
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ---------- /recruit template ... ----------
    if (group === 'template') {
      if (sub === 'create') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const subject = interaction.options.getString('subject');
        const body = interaction.options.getString('body');
        const type = interaction.options.getString('type') || 'initial';

        if (db.getTemplate(id)) {
          return interaction.reply({
            content: `❌ A template with ID "${id}" already exists. Delete it first or use a different ID.`,
            flags: 64,
          });
        }

        db.addTemplate(id, { name: id, subject, body, type });
        const usageHint =
          type === 'initial'
            ? 'It will now be included in the random rotation for new-nation recruiting and bulk sends.'
            : type === 'departure'
            ? 'It will be sent automatically to nations detected as having recently left an alliance.'
            : `It will be sent automatically as the "${type}" follow-up to recruits who haven't moved past the "New" stage.`;
        return interaction.reply({
          content: `✅ Template "${id}" created (type: ${type}). ${usageHint}`,
          flags: 64,
        });
      }

      if (sub === 'list') {
        const templates = db.getAllTemplates();
        if (templates.length === 0) {
          return interaction.reply({
            content: 'No templates yet. Create one with `/recruit template create`.',
            flags: 64,
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 Recruitment Templates')
          .setColor(0x9b59b6)
          .setDescription(
            templates
              .map(
                (t) =>
                  `**${t.id}** _(${t.type || 'initial'})_\nSubject: ${t.subject}\nBody: ${t.body.slice(0, 150)}${t.body.length > 150 ? '...' : ''}`
              )
              .join('\n\n')
          );


        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (sub === 'edit') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const existing = db.getTemplate(id);

        if (!existing) {
          return interaction.reply({
            content: `❌ No template found with ID "${id}". Use \`/recruit template list\` to see all template IDs.`,
            flags: 64,
          });
        }

        // Only update the fields the user actually provided - leave everything
        // else exactly as it was. This way staff can fix just the subject line
        // without having to retype the entire body, for example.
        const newSubject = interaction.options.getString('subject');
        const newBody = interaction.options.getString('body');
        const newType = interaction.options.getString('type');

        if (!newSubject && !newBody && !newType) {
          return interaction.reply({
            content: `You didn't provide anything to change. Supply at least one of: \`subject\`, \`body\`, or \`type\`.`,
            flags: 64,
          });
        }

        const updated = {
          ...existing,
          subject: newSubject || existing.subject,
          body: newBody || existing.body,
          type: newType || existing.type || 'initial',
        };

        db.addTemplate(id, updated); // addTemplate overwrites if the ID already exists

        const changes = [
          newSubject ? `subject → "${newSubject}"` : null,
          newBody ? `body updated` : null,
          newType ? `type → "${newType}"` : null,
        ]
          .filter(Boolean)
          .join(', ');

        return interaction.reply({
          content: `✅ Template "${id}" updated (${changes}).`,
          flags: 64,
        });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const existed = db.deleteTemplate(id);
        return interaction.reply({
          content: existed ? `✅ Template "${id}" deleted.` : `❌ No template found with ID "${id}".`,
          flags: 64,
        });
      }

      if (sub === 'stats') {
        const stats = db.getTemplateStats();
        if (stats.length === 0) {
          return interaction.reply({ content: 'No templates yet, so no A/B data to show.', flags: 64 });
        }

        // Sort best-converting first, so the winner is obvious at a glance.
        stats.sort((a, b) => Number(b.conversionRate) - Number(a.conversionRate));

        const embed = new EmbedBuilder()
          .setTitle('🧪 Template A/B Testing Report')
          .setColor(0x1abc9c)
          .setDescription(
            stats
              .map(
                (s) =>
                  `**${s.templateId}** _(${s.type})_\nFirst-contacted: ${s.sentAsFirstContact} | Joined: ${s.joins} | Conversion: ${s.conversionRate}%`
              )
              .join('\n\n')
          );

        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }

    // ---------- /recruit auto on|off ----------
    if (sub === 'auto') {
      const state = interaction.options.getString('state');
      const enabled = state === 'on';

      if (enabled && db.getAllTemplates().length === 0) {
        return interaction.reply({
          content: '❌ You need at least one recruitment template before turning auto-recruit on. Use `/recruit template create` first.',
          flags: 64,
        });
      }

      db.setSetting('autoRecruitEnabled', enabled);
      return interaction.reply({
        content: enabled
          ? '✅ Auto-recruit is now **ON**.'
          : '🛑 Auto-recruit is now **OFF**.',
        flags: 64,
      });
    }

    // ---------- /recruit status ----------
    if (sub === 'status') {
      const enabled = Boolean(db.getSetting('autoRecruitEnabled'));
      const templateCount = db.getAllTemplates().length;
      const recruitCount = db.getAllRecruits().length;

      const embed = new EmbedBuilder()
        .setTitle('🎯 Recruitment Status')
        .setColor(enabled ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: 'Auto-Recruit', value: enabled ? '✅ ON' : '🛑 OFF', inline: true },
          { name: 'Templates Saved', value: String(templateCount), inline: true },
          { name: 'Total Recruits Tracked', value: String(recruitCount), inline: true }
        );

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ---------- /recruit stage ----------
    if (sub === 'stage') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');
      const stage = interaction.options.getString('stage');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${input}".`);

      db.upsertRecruit(nation.id, { nation_name: nation.nation_name, stage });
      return interaction.editReply(`✅ ${nation.nation_name} (#${nation.id}) set to stage **${stage}**.`);
    }

    // ---------- /recruit profile ----------
    if (sub === 'profile') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${input}".`);

      const recruit = db.getRecruit(nation.id);
      const mailCount = db.getMailLog(nation.id).length;
      const blacklisted = db.isBlacklisted(nation.id);
      const quality = calculateRecruitScore(nation);

      const embed = new EmbedBuilder()
        .setTitle(`📇 ${nation.nation_name} (#${nation.id})`)
        .setColor(blacklisted ? 0xe74c3c : 0x3498db)
        .addFields(
          { name: 'Leader', value: nation.leader_name || 'Unknown', inline: true },
          { name: 'War Score (in-game)', value: String(nation.score ?? 'Unknown'), inline: true },
          { name: 'Cities', value: String(nation.num_cities ?? 'Unknown'), inline: true },
          { name: 'Recruit Quality', value: `${quality.total}/100 (${quality.tier})`, inline: true },
          { name: 'Stage', value: recruit?.stage || 'Not tracked yet', inline: true },
          { name: 'Assigned Staff', value: recruit?.assigned_staff_id ? `<@${recruit.assigned_staff_id}>` : 'None', inline: true },
          { name: 'Mails Sent', value: String(mailCount), inline: true },
          { name: 'Last Contacted', value: recruit?.last_contacted_at || 'Never', inline: true },
          { name: 'Blacklisted', value: blacklisted ? '🚫 Yes' : 'No', inline: true },
          { name: 'Notes', value: recruit?.notes || 'None' }
        );

      return interaction.editReply({ embeds: [embed] });
    }

    // ---------- /recruit score ----------
    if (sub === 'score') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${input}".`);

      const quality = calculateRecruitScore(nation);
      const tierEmoji = { High: '🟢', Medium: '🟡', Low: '🔴' }[quality.tier];

      const embed = new EmbedBuilder()
        .setTitle(`${tierEmoji} ${nation.nation_name} (#${nation.id}) — ${quality.total}/100 (${quality.tier})`)
        .setColor(quality.tier === 'High' ? 0x2ecc71 : quality.tier === 'Medium' ? 0xf1c40f : 0xe74c3c)
        .setDescription('This is a heuristic to help triage candidates, not a guarantee of how someone will respond.')
        .addFields(
          { name: 'Activity', value: `${quality.breakdown.activity}/35`, inline: true },
          { name: 'Cities', value: `${quality.breakdown.cities}/25`, inline: true },
          { name: 'Infrastructure', value: `${quality.breakdown.infrastructure}/20`, inline: true },
          { name: 'Nation Age', value: `${quality.breakdown.age}/12`, inline: true },
          { name: 'War Activity', value: `${quality.breakdown.warActivity}/8`, inline: true }
        );

      return interaction.editReply({ embeds: [embed] });
    }

    // ---------- /recruit assign ----------
    if (sub === 'assign') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');
      const staffUser = interaction.options.getUser('staff');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${input}".`);

      db.upsertRecruit(nation.id, { nation_name: nation.nation_name, assigned_staff_id: staffUser.id });
      return interaction.editReply(`✅ ${nation.nation_name} (#${nation.id}) assigned to <@${staffUser.id}>.`);
    }

    // ---------- /recruit note ----------
    if (sub === 'note') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');
      const text = interaction.options.getString('text');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${input}".`);

      db.upsertRecruit(nation.id, { nation_name: nation.nation_name, notes: text });
      return interaction.editReply(`✅ Note saved for ${nation.nation_name} (#${nation.id}).`);
    }

    // ---------- /recruit stats ----------
    if (sub === 'stats') {
      const stats = db.getStats();
      const stageLines = Object.entries(stats.byStage)
        .map(([stage, count]) => `${stage}: ${count}`)
        .join('\n') || 'No recruits tracked yet';

      const embed = new EmbedBuilder()
        .setTitle('📊 Recruitment Dashboard')
        .setColor(0xf39c12)
        .addFields(
          { name: 'Total Mails Sent', value: String(stats.mailsSent), inline: true },
          { name: 'Total Recruits Tracked', value: String(stats.totalRecruitsTracked), inline: true },
          { name: 'Conversion Rate', value: `${stats.conversionRate}%`, inline: true },
          { name: 'By Stage', value: stageLines }
        );

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ---------- /recruit attribution ----------
    if (sub === 'attribution') {
      const joined = db.getJoinAttribution();
      if (joined.length === 0) {
        return interaction.reply({
          content: 'No recruits are currently marked "Joined" yet. Use `/recruit stage` to update a recruit\'s stage as they progress.',
          flags: 64,
        });
      }

      const lines = joined.map((j) => {
        const sender = j.initialSentBy === 'auto-recruit-system' ? 'Auto-Recruit System' : `<@${j.initialSentBy}>`;
        const template = j.initialTemplateId || '(manual, no template)';
        const staff = j.assignedStaffId ? `<@${j.assignedStaffId}>` : 'Unassigned';
        return `**${j.nationName}** (#${j.nationId})\nFirst contacted by: ${sender} | Template: ${template} | Assigned staff: ${staff}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 Join Attribution Report')
        .setColor(0x2ecc71)
        .setDescription(lines.join('\n\n').slice(0, 4000));

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ---------- /recruit bulk ----------
    if (sub === 'bulk') {
      if (!canSendRecruitmentMail(interaction)) {
        return interaction.reply({
          content: '❌ You don\'t have permission to send recruitment mail. Ask an admin about the recruiter role.',
          flags: 64,
        });
      }

      await interaction.deferReply({ flags: 64 });

      const scoreMin = interaction.options.getInteger('score-min') ?? undefined;
      const scoreMax = interaction.options.getInteger('score-max') ?? undefined;
      const citiesMin = interaction.options.getInteger('cities-min') ?? undefined;
      const citiesMax = interaction.options.getInteger('cities-max') ?? undefined;
      const excludeVacationMode = interaction.options.getBoolean('exclude-vacation-mode') ?? true;
      const confirm = interaction.options.getBoolean('confirm') ?? false;

      if (confirm && db.getAllTemplates().length === 0) {
        return interaction.editReply('❌ You need at least one recruitment template first. Use `/recruit template create`.');
      }

      let candidates;
      try {
        candidates = await pnw.searchUnalignedNations({ scoreMin, scoreMax, citiesMin, citiesMax, excludeVacationMode, maxPages: 10 });
      } catch (err) {
        return interaction.editReply(`❌ Search failed: ${err.message}`);
      }

      // Skip blacklisted nations and anyone mailed within the cooldown window.
      const eligible = candidates.filter((n) => {
        if (db.isBlacklisted(n.id)) return false;
        const recruit = db.getRecruit(n.id);
        if (recruit && daysSince(recruit.last_contacted_at) < COOLDOWN_DAYS) return false;
        return true;
      });

      // Score every eligible candidate and sort best-first, so when the safety
      // cap kicks in, the highest-quality recruits get mailed before lower ones.
      const scored = eligible
        .map((n) => ({ nation: n, quality: calculateRecruitScore(n) }))
        .sort((a, b) => b.quality.total - a.quality.total);

      const avgScore =
        scored.length > 0
          ? Math.round(scored.reduce((sum, s) => sum + s.quality.total, 0) / scored.length)
          : 0;

      if (!confirm) {
        return interaction.editReply(
          `🔍 **Dry run** — found **${candidates.length}** matching nation(s), **${eligible.length}** eligible to mail ` +
            `(after skipping blacklisted/recently-contacted).\n\n` +
            `📊 Average recruit quality score: **${avgScore}/100**. The bot will prioritize the highest-scoring ` +
            `nations first when sending.\n\n` +
            `✅ Safety check: every result above has **no alliance** (alliance_id = 0). Nations belonging to ` +
            `any other alliance — including their applicants — are never included, so this cannot count as poaching.\n\n` +
            `This will send at most **${Math.min(eligible.length, BULK_MAX_SEND)}** mails per run (safety cap), ` +
            `with a short delay between each.\n\n` +
            `Re-run this same command with \`confirm:true\` to actually send.`
        );
      }

      const toSend = scored.slice(0, BULK_MAX_SEND).map((s) => s.nation);
      const personalKey = db.getPersonalApiKey(interaction.user.id);
      let sentCount = 0;
      const failures = [];

      for (const nation of toSend) {
        const template = db.getRandomTemplate('initial');
        if (!template) break;

        const subject = fillTemplate(template.subject, nation);
        const body = fillTemplate(template.body, nation);

        try {
          await pnw.sendMail(nation.id, subject, body, personalKey);
        } catch (err) {
          failures.push(`#${nation.id}: ${err.message}`);
          continue;
        }

        db.addMailLog({ nationId: nation.id, direction: 'outgoing', subject, message: body, sentBy: interaction.user.id });
        db.touchLastContacted(nation.id);
        db.setInitialAttributionIfMissing(nation.id, template.id, interaction.user.id);
        sentCount++;

        try {
          const thread = await getOrCreateRecruitThread(interaction.client, nation.id, nation.nation_name);
          const embed = new EmbedBuilder()
            .setTitle('🎯 BULK RECRUIT MAIL SENT')
            .addFields(
              { name: 'Nation', value: `${nation.nation_name} (#${nation.id})` },
              { name: 'Template Used', value: template.id },
              { name: 'Sent By', value: `<@${interaction.user.id}>` }
            )
            .setColor(0xf1c40f)
            .setTimestamp();
          await thread.send({ embeds: [embed] });
          await thread.send({ content: truncateForDiscord(body, '**Message:**\n') });
        } catch (err) {
          console.error('Could not log bulk mail to thread:', err.message);
        }

        await sleep(BULK_DELAY_MS);
      }

      let resultMsg = `✅ Bulk send complete. Mailed **${sentCount}** nation(s) from ${personalKey ? 'your own nation' : "the alliance's shared nation"}.`;
      if (eligible.length > BULK_MAX_SEND) {
        resultMsg += `\n${eligible.length - BULK_MAX_SEND} more eligible nation(s) were left for the next run (safety cap of ${BULK_MAX_SEND} per command).`;
      }
      if (failures.length > 0) {
        resultMsg += `\n⚠️ ${failures.length} failed: ${failures.slice(0, 5).join('; ')}`;
      }

      return interaction.editReply(resultMsg);
    }
  },
};
