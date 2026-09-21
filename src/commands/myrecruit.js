// /myrecruit - Personal recruitment system for individual staff members.
//
// Each permitted staff member manages their OWN:
//   - Template pool (private, only used in their own auto-recruit)
//   - Auto-recruit toggle (on/off independently of other staff)
//   - Outgoing mail identity (sends from THEIR nation via their API key)
//
// Prerequisites for auto-recruit:
//   1. Staff member must have registered their API key via /apikey set
//   2. Must have the recruiter role (or be admin) — uses canSendRecruitmentMail
//   3. Must have at least one 'initial' type personal template

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const prDb = require('../personalRecruitDb');
const db = require('../database');
const { canSendRecruitmentMail } = require('../utils/permissions');

const VALID_TYPES = ['initial', 'followup1', 'followup2', 'followup3', 'departure'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrecruit')
    .setDescription('Manage your personal recruitment templates and auto-recruit')
    .addSubcommandGroup((group) =>
      group
        .setName('template')
        .setDescription('Manage your private recruitment templates')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a personal recruitment template')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Short unique ID e.g. "my-initial-1"').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('Mail subject').setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('body')
                .setDescription('Mail body. Use {nation}, {leader} as placeholders.')
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('type')
                .setDescription('Template type (default: initial)')
                .setRequired(false)
                .addChoices(
                  { name: 'initial (used by auto-recruit)', value: 'initial' },
                  { name: 'followup1 (~3 days)', value: 'followup1' },
                  { name: 'followup2 (~7 days)', value: 'followup2' },
                  { name: 'followup3 (~14 days, final)', value: 'followup3' },
                  { name: 'departure (left an alliance)', value: 'departure' }
                )
            )
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List all your personal templates'))
        .addSubcommand((sub) =>
          sub
            .setName('edit')
            .setDescription('Edit one of your personal templates')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Template ID to edit').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('New subject (leave blank to keep current)').setRequired(false)
            )
            .addStringOption((opt) =>
              opt.setName('body').setDescription('New body (leave blank to keep current)').setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('type')
                .setDescription('New type (leave blank to keep current)')
                .setRequired(false)
                .addChoices(
                  { name: 'initial', value: 'initial' },
                  { name: 'followup1', value: 'followup1' },
                  { name: 'followup2', value: 'followup2' },
                  { name: 'followup3', value: 'followup3' },
                  { name: 'departure', value: 'departure' }
                )
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Delete one of your personal templates')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('Template ID to delete').setRequired(true)
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('auto')
        .setDescription('Turn YOUR personal auto-recruit on or off')
        .addStringOption((opt) =>
          opt
            .setName('state')
            .setDescription('on or off')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check your personal auto-recruit status and template summary')
    ),

  async execute(interaction) {
    if (!canSendRecruitmentMail(interaction)) {
      return interaction.reply({
        content: '❌ You don\'t have permission to use recruitment features. Ask an admin about the recruiter role.',
        flags: 64,
      });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ==================== TEMPLATE COMMANDS ====================

    if (group === 'template') {
      if (sub === 'create') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const subject = interaction.options.getString('subject');
        const body = interaction.options.getString('body');
        const type = interaction.options.getString('type') || 'initial';

        try {
          prDb.addPersonalTemplate(userId, { id, subject, body, type });
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
        }

        const hint = type === 'initial'
          ? 'It will be used in your personal auto-recruit rotation.'
          : `It will be used as your personal "${type}" follow-up.`;

        return interaction.reply({
          content: `✅ Personal template "${id}" created (type: ${type}). ${hint}`,
          flags: 64,
        });
      }

      if (sub === 'list') {
        const templates = prDb.getAllPersonalTemplates(userId);
        if (templates.length === 0) {
          return interaction.reply({
            content: 'You have no personal templates yet. Create one with `/myrecruit template create`.',
            flags: 64,
          });
        }

        const byType = {};
        for (const t of templates) {
          const type = t.type || 'initial';
          if (!byType[type]) byType[type] = [];
          byType[type].push(t);
        }

        const embed = new EmbedBuilder()
          .setTitle(`📋 Your Personal Templates (${templates.length} total)`)
          .setColor(0xe67e22)
          .setDescription(
            Object.entries(byType)
              .map(([type, list]) =>
                `**${type}**\n` +
                list.map((t) => `• \`${t.id}\` — ${t.subject}`).join('\n')
              )
              .join('\n\n')
              .slice(0, 4000)
          );

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (sub === 'edit') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const newSubject = interaction.options.getString('subject');
        const newBody = interaction.options.getString('body');
        const newType = interaction.options.getString('type');

        if (!newSubject && !newBody && !newType) {
          return interaction.reply({
            content: 'You didn\'t provide anything to change. Supply at least one of: `subject`, `body`, or `type`.',
            flags: 64,
          });
        }

        const existing = prDb.getPersonalTemplate(userId, id);
        if (!existing) {
          return interaction.reply({ content: `❌ You don't have a template with ID "${id}".`, flags: 64 });
        }

        try {
          prDb.updatePersonalTemplate(userId, id, {
            subject: newSubject || existing.subject,
            body: newBody || existing.body,
            type: newType || existing.type || 'initial',
          });
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
        }

        const changes = [
          newSubject && `subject → "${newSubject}"`,
          newBody && 'body updated',
          newType && `type → "${newType}"`,
        ].filter(Boolean).join(', ');

        return interaction.reply({
          content: `✅ Template "${id}" updated (${changes}).`,
          flags: 64,
        });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const existed = prDb.deletePersonalTemplate(userId, id);
        return interaction.reply({
          content: existed
            ? `✅ Template "${id}" deleted.`
            : `❌ You don't have a template with ID "${id}".`,
          flags: 64,
        });
      }
    }

    // ==================== /myrecruit auto ====================

    if (sub === 'auto') {
      const enabled = interaction.options.getString('state') === 'on';

      if (enabled) {
        // Check prerequisites before turning on
        const apiKey = db.getPersonalApiKey(userId);
        if (!apiKey) {
          return interaction.reply({
            content:
              '❌ You need to register your personal PnW API key first.\n' +
              'Run `/apikey set key:<your key>` to register it, then try again.',
            flags: 64,
          });
        }

        const initials = prDb.getPersonalTemplatesByType(userId, 'initial');
        if (initials.length === 0) {
          return interaction.reply({
            content:
              '❌ You need at least one `initial` type personal template before turning on auto-recruit.\n' +
              'Create one with `/myrecruit template create type:initial`.',
            flags: 64,
          });
        }
      }

      prDb.setPersonalAutoRecruit(userId, enabled);

      return interaction.reply({
        content: enabled
          ? '✅ Your personal auto-recruit is now **ON**. New unaligned nations will be mailed from your nation every 5 minutes using your personal templates.'
          : '🛑 Your personal auto-recruit is now **OFF**.',
        flags: 64,
      });
    }

    // ==================== /myrecruit status ====================

    if (sub === 'status') {
      const profile = prDb.getProfile(userId);
      const apiKey = db.getPersonalApiKey(userId);
      const templates = prDb.getAllPersonalTemplates(userId);
      const initials = templates.filter((t) => (t.type || 'initial') === 'initial');
      const knownCount = Object.keys(profile?.knownNationIds || {}).length;
      const autoOn = Boolean(profile?.autoRecruitEnabled);

      const readyToRun = Boolean(apiKey) && initials.length > 0;

      const embed = new EmbedBuilder()
        .setTitle('🎯 Your Personal Auto-Recruit Status')
        .setColor(autoOn ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          {
            name: 'Auto-Recruit',
            value: autoOn ? '✅ ON — sending from your nation' : '🛑 OFF',
            inline: true,
          },
          {
            name: 'API Key',
            value: apiKey ? '✅ Registered' : '❌ Not set — use `/apikey set`',
            inline: true,
          },
          {
            name: 'Ready to Run',
            value: readyToRun ? '✅ Yes' : '❌ No — missing API key or initial templates',
            inline: true,
          },
          {
            name: 'Personal Templates',
            value:
              templates.length > 0
                ? `${templates.length} total (${initials.length} initial, ${templates.length - initials.length} follow-up/other)`
                : 'None yet — create one with `/myrecruit template create`',
            inline: false,
          },
          {
            name: 'Nations Already Contacted',
            value: `${knownCount} nation(s) in your personal history (will never be mailed again by your auto-recruit)`,
            inline: false,
          }
        );

      return interaction.reply({ embeds: [embed], flags: 64 });
    }
  },
};
