// /announce-edit
// Edits a message previously sent by the bot in any channel.
// Accepts either the message ID or a full Discord message link.
// Admin only.

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

/**
 * Extracts a message ID from either a plain ID or a Discord message link.
 * Link format: https://discord.com/channels/guildId/channelId/messageId
 */
function resolveMessageId(input) {
  const trimmed = input.trim();

  // Plain message ID (all digits)
  if (/^\d+$/.test(trimmed)) return { messageId: trimmed, channelId: null };

  // Discord message link
  const match = trimmed.match(/channels\/\d+\/(\d+)\/(\d+)/);
  if (match) return { channelId: match[1], messageId: match[2] };

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce-edit')
    .setDescription('Edit an announcement previously sent by the bot (Admin only)')
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('Message ID or Discord message link (right-click message → Copy Message Link)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('new-content').setDescription('The new message content').setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel the message is in (only needed if you provided a plain message ID, not a link)')
        .setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt.setName('new-image').setDescription('Replace the image attachment (optional)').setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const input = interaction.options.getString('message');
    const newContent = interaction.options.getString('new-content');
    const newImage = interaction.options.getAttachment('new-image');
    const channelOption = interaction.options.getChannel('channel');

    const resolved = resolveMessageId(input);
    if (!resolved) {
      return interaction.editReply(
        '❌ Could not parse that as a message ID or link. Right-click the message in Discord → **Copy Message Link**, then paste that here.'
      );
    }

    // Figure out which channel to look in
    let channel;
    try {
      const channelId = resolved.channelId || channelOption?.id;
      if (!channelId) {
        return interaction.editReply(
          '❌ You provided a plain message ID but no channel. Either paste the full message link instead, or add the `channel` option to tell me where the message is.'
        );
      }
      channel = await interaction.client.channels.fetch(channelId);
    } catch {
      return interaction.editReply('❌ Could not find that channel. Make sure the bot has access to it.');
    }

    // Fetch the target message
    let targetMessage;
    try {
      targetMessage = await channel.messages.fetch(resolved.messageId);
    } catch {
      return interaction.editReply(
        `❌ Could not find that message in ${channel}. Make sure the ID or link is correct and the bot has access to that channel.`
      );
    }

    // Only edit messages the bot itself sent
    if (targetMessage.author.id !== interaction.client.user.id) {
      return interaction.editReply(
        '❌ That message was not sent by this bot, so I cannot edit it.'
      );
    }

    // Build the edit payload
    const editPayload = { content: newContent };
    if (newImage) {
      editPayload.files = [newImage];
      editPayload.attachments = []; // clears any existing attachment
    }

    try {
      await targetMessage.edit(editPayload);
    } catch (err) {
      return interaction.editReply(`❌ Failed to edit the message: ${err.message}`);
    }

    return interaction.editReply(
      `✅ Message updated in ${channel}. [Jump to message](${targetMessage.url})`
    );
  },
};
