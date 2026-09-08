// /dm user target:<user> message:"..." - DM a single person
// /dm role target:<role> message:"..." - mass-DM everyone with a role
// Merged in from the separate mailing/announcement bot.

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const massDm = require('../state/massDm');

const DELAY_BETWEEN_DMS_MS = 1200;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send DMs to users or roles')
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('DM a user')
        .addUserOption((opt) => opt.setName('target').setDescription('User').setRequired(true))
        .addStringOption((opt) => opt.setName('message').setDescription('Message').setRequired(true).setMaxLength(2000))
        .addAttachmentOption((opt) => opt.setName('image').setDescription('Optional image'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('DM everyone with a role')
        .addRoleOption((opt) => opt.setName('target').setDescription('Role').setRequired(true))
        .addStringOption((opt) => opt.setName('message').setDescription('Message').setRequired(true).setMaxLength(2000))
        .addAttachmentOption((opt) => opt.setName('image').setDescription('Optional image'))
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    const sub = interaction.options.getSubcommand();
    const message = interaction.options.getString('message');
    const image = interaction.options.getAttachment('image');
    const payload = image ? { content: message, files: [image] } : { content: message };

    // ---------- /dm user ----------
    if (sub === 'user') {
      const user = interaction.options.getUser('target');
      await interaction.deferReply({ flags: 64 });

      try {
        await user.send(payload);
        return interaction.editReply(`✅ DM sent to ${user.tag}.`);
      } catch {
        return interaction.editReply(
          `❌ Failed to DM ${user.tag}. They may have DMs disabled or have blocked the bot.`
        );
      }
    }

    // ---------- /dm role ----------
    if (sub === 'role') {
      const role = interaction.options.getRole('target');
      await interaction.deferReply({ flags: 64 });

      massDm.resetCancel();

      const members = await interaction.guild.members.fetch();
      const targets = members.filter((m) => m.roles.cache.has(role.id));
      const total = targets.size;

      if (total === 0) {
        return interaction.editReply(`No members found with the role ${role.name}.`);
      }

      let sent = 0;
      let failed = 0;
      let processed = 0;

      for (const member of targets.values()) {
        if (massDm.isCancelled()) {
          return interaction.editReply(`🛑 Cancelled at ${processed}/${total} (Sent: ${sent}, Failed: ${failed}).`);
        }

        try {
          await member.send(payload);
          sent++;
        } catch {
          failed++;
        }

        processed++;

        if (processed % 5 === 0) {
          await interaction.editReply(
            `📨 Sending DMs...\nProgress: ${processed}/${total}\nSent: ${sent} | Failed: ${failed}\n(Use /cancel to stop)`
          );
        }

        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_DMS_MS));
      }

      return interaction.editReply(`✅ Done!\nSent: ${sent}\nFailed: ${failed}`);
    }
  },
};
