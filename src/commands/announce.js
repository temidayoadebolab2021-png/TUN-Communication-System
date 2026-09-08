// /announce channel:<channel> message:"..." [image] - post an announcement
// Merged in from the separate mailing/announcement bot.

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement to a channel')
    .addChannelOption((opt) => opt.setName('channel').setDescription('Channel').setRequired(true))
    .addStringOption((opt) => opt.setName('message').setDescription('Message').setRequired(true).setMaxLength(2000))
    .addAttachmentOption((opt) => opt.setName('image').setDescription('Optional image')),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const image = interaction.options.getAttachment('image');
    const payload = image ? { content: message, files: [image] } : { content: message };

    await channel.send(payload);

    return interaction.reply({ content: `✅ Announcement sent to ${channel}.`, flags: 64 });
  },
};
