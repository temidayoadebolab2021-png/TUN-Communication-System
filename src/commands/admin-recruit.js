// /admin-recruit - Admin-only command for managing other staff members'
// personal recruitment templates.
//
// /admin-recruit template create user:@staff id:... subject:... body:... type:...
// /admin-recruit template edit   user:@staff id:... [subject] [body] [type]
// /admin-recruit template delete user:@staff id:...
// /admin-recruit template list   user:@staff
// /admin-recruit copy from-user:@staff to-user:@staff    (staff to staff)
// /admin-recruit copy from-user:@staff to-user:@staff id:... (single template)
// /admin-recruit import user:@staff   (copy ALL shared alliance templates → staff)
// /admin-recruit import user:@staff id:... (copy ONE shared template → staff)

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const prDb = require('../personalRecruitDb');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-recruit')
    .setDescription('Admin: manage other staff members\' personal recruitment templates')

    .addSubcommandGroup((group) =>
      group
        .setName('template')
        .setDescription('Create, edit, delete or list templates for a specific staff member')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a personal template for another staff member')
            .addUserOption((opt) => opt.setName('user').setDescription('Staff member').setRequired(true))
            .addStringOption((opt) => opt.setName('id').setDescription('Template ID').setRequired(true))
            .addStringOption((opt) => opt.setName('subject').setDescription('Mail subject').setRequired(true))
            .addStringOption((opt) => opt.setName('body').setDescription('Mail body. Use {nation}, {leader} as placeholders.').setRequired(true))
            .addStringOption((opt) =>
              opt.setName('type').setDescription('Template type (default: initial)').setRequired(false)
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
            .setName('edit')
            .setDescription('Edit a template belonging to a staff member')
            .addUserOption((opt) => opt.setName('user').setDescription('Staff member').setRequired(true))
            .addStringOption((opt) => opt.setName('id').setDescription('Template ID to edit').setRequired(true))
            .addStringOption((opt) => opt.setName('subject').setDescription('New subject (leave blank to keep)').setRequired(false))
            .addStringOption((opt) => opt.setName('body').setDescription('New body (leave blank to keep)').setRequired(false))
            .addStringOption((opt) =>
              opt.setName('type').setDescription('New type (leave blank to keep)').setRequired(false)
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
            .setDescription('Delete a template from a staff member\'s personal pool')
            .addUserOption((opt) => opt.setName('user').setDescription('Staff member').setRequired(true))
            .addStringOption((opt) => opt.setName('id').setDescription('Template ID to delete').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List all personal templates belonging to a staff member')
            .addUserOption((opt) => opt.setName('user').setDescription('Staff member').setRequired(true))
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName('copy')
        .setDescription('Copy templates from one staff member\'s pool to another\'s')
        .addUserOption((opt) => opt.setName('from-user').setDescription('Copy FROM this staff member').setRequired(true))
        .addUserOption((opt) => opt.setName('to-user').setDescription('Copy TO this staff member').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('id').setDescription('Specific template ID to copy (leave blank to copy ALL)').setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt.setName('overwrite').setDescription('Overwrite if template ID already exists in destination? (default: false)').setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName('import')
        .setDescription('Copy template(s) from the shared alliance pool into a staff member\'s personal pool')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to import into').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('id').setDescription('Specific shared template ID to import (leave blank to import ALL)').setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt.setName('overwrite').setDescription('Overwrite if template ID already exists? (default: false)').setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ==================== TEMPLATE GROUP ====================

    if (group === 'template') {
      const targetUser = interaction.options.getUser('user');
      const targetId = targetUser.id;

      if (sub === 'create') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const subject = interaction.options.getString('subject');
        const body = interaction.options.getString('body');
        const type = interaction.options.getString('type') || 'initial';

        try {
          prDb.addPersonalTemplate(targetId, { id, subject, body, type });
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
        }

        return interaction.reply({
          content: `✅ Template \`${id}\` (type: ${type}) created in ${targetUser.tag}'s personal pool.`,
          flags: 64,
        });
      }

      if (sub === 'edit') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const newSubject = interaction.options.getString('subject');
        const newBody = interaction.options.getString('body');
        const newType = interaction.options.getString('type');

        if (!newSubject && !newBody && !newType) {
          return interaction.reply({ content: 'Provide at least one of: `subject`, `body`, `type`.', flags: 64 });
        }

        const existing = prDb.getPersonalTemplate(targetId, id);
        if (!existing) {
          return interaction.reply({ content: `❌ ${targetUser.tag} doesn't have a template with ID "${id}".`, flags: 64 });
        }

        prDb.updatePersonalTemplate(targetId, id, {
          subject: newSubject || existing.subject,
          body: newBody || existing.body,
          type: newType || existing.type || 'initial',
        });

        const changes = [
          newSubject && `subject → "${newSubject}"`,
          newBody && 'body updated',
          newType && `type → "${newType}"`,
        ].filter(Boolean).join(', ');

        return interaction.reply({
          content: `✅ Updated \`${id}\` in ${targetUser.tag}'s personal pool (${changes}).`,
          flags: 64,
        });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
        const existed = prDb.deletePersonalTemplate(targetId, id);
        return interaction.reply({
          content: existed
            ? `✅ Deleted \`${id}\` from ${targetUser.tag}'s personal pool.`
            : `❌ ${targetUser.tag} doesn't have a template with ID "${id}".`,
          flags: 64,
        });
      }

      if (sub === 'list') {
        const templates = prDb.getAllPersonalTemplates(targetId);
        if (templates.length === 0) {
          return interaction.reply({
            content: `${targetUser.tag} has no personal templates yet.`,
            flags: 64,
          });
        }

        const byType = {};
        for (const t of templates) {
          const type = t.type || 'initial';
          if (!byType[type]) byType[type] = [];
          byType[type].push(t);
        }

        const autoOn = Boolean(prDb.getProfile(targetId)?.autoRecruitEnabled);
        const apiKey = Boolean(db.getPersonalApiKey(targetId));

        const embed = new EmbedBuilder()
          .setTitle(`📋 ${targetUser.tag}'s Personal Templates (${templates.length} total)`)
          .setColor(0xe67e22)
          .setDescription(
            `Auto-recruit: ${autoOn ? '✅ ON' : '🛑 OFF'} | API key: ${apiKey ? '✅ Set' : '❌ Not set'}\n\n` +
            Object.entries(byType)
              .map(([type, list]) =>
                `**${type}**\n` +
                list.map((t) => `• \`${t.id}\` — ${t.subject}`).join('\n')
              )
              .join('\n\n')
              .slice(0, 3800)
          );

        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }

    // ==================== /admin-recruit copy ====================

    if (sub === 'copy') {
      await interaction.deferReply({ flags: 64 });

      const fromUser = interaction.options.getUser('from-user');
      const toUser = interaction.options.getUser('to-user');
      const specificId = interaction.options.getString('id')?.toLowerCase().replace(/\s+/g, '-');
      const overwrite = interaction.options.getBoolean('overwrite') ?? false;

      if (fromUser.id === toUser.id) {
        return interaction.editReply('❌ Source and destination are the same person.');
      }

      const sourceTemplates = prDb.getAllPersonalTemplates(fromUser.id);
      if (sourceTemplates.length === 0) {
        return interaction.editReply(`❌ ${fromUser.tag} has no personal templates to copy from.`);
      }

      const toCopy = specificId
        ? sourceTemplates.filter((t) => t.id === specificId)
        : sourceTemplates;

      if (toCopy.length === 0) {
        return interaction.editReply(`❌ ${fromUser.tag} doesn't have a template with ID "${specificId}".`);
      }

      let copied = 0, skipped = 0;
      for (const t of toCopy) {
        const exists = Boolean(prDb.getPersonalTemplate(toUser.id, t.id));
        if (exists && !overwrite) { skipped++; continue; }
        if (exists) prDb.deletePersonalTemplate(toUser.id, t.id);
        prDb.addPersonalTemplate(toUser.id, { id: t.id, subject: t.subject, body: t.body, type: t.type || 'initial' });
        copied++;
      }

      let result = `✅ Copied **${copied}** template(s) from ${fromUser.tag} → ${toUser.tag}.`;
      if (skipped > 0) result += ` Skipped **${skipped}** (already existed — re-run with \`overwrite:true\` to replace).`;
      return interaction.editReply(result);
    }

    // ==================== /admin-recruit import ====================

    if (sub === 'import') {
      await interaction.deferReply({ flags: 64 });

      const toUser = interaction.options.getUser('user');
      const specificId = interaction.options.getString('id');
      const overwrite = interaction.options.getBoolean('overwrite') ?? false;

      const sharedTemplates = db.getAllTemplates();
      if (sharedTemplates.length === 0) {
        return interaction.editReply('❌ The shared alliance template pool is empty — nothing to import.');
      }

      const toImport = specificId
        ? sharedTemplates.filter((t) => t.id === specificId)
        : sharedTemplates;

      if (toImport.length === 0) {
        return interaction.editReply(`❌ No shared template found with ID "${specificId}".`);
      }

      let imported = 0, skipped = 0;
      for (const t of toImport) {
        const exists = Boolean(prDb.getPersonalTemplate(toUser.id, t.id));
        if (exists && !overwrite) { skipped++; continue; }
        if (exists) prDb.deletePersonalTemplate(toUser.id, t.id);
        prDb.addPersonalTemplate(toUser.id, { id: t.id, subject: t.subject, body: t.body, type: t.type || 'initial' });
        imported++;
      }

      let result = `✅ Imported **${imported}** shared template(s) into ${toUser.tag}'s personal pool.`;
      if (skipped > 0) result += ` Skipped **${skipped}** (already existed — re-run with \`overwrite:true\` to replace).`;
      return interaction.editReply(result);
    }
  },
};
