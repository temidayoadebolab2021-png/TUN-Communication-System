// /reply message:"..."
// Used INSIDE a recruit's thread (e.g. #recruit-12345-arrow-kingdom).
// The bot figures out which nation the thread belongs to automatically.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');
const { truncateForDiscord } = require('../utils/discordText');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Reply to a recruit (must be used inside their recruitment thread)')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Your reply message').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const allRecruits = db.getAllRecruits();
    const recruit = allRecruits.find(
      (r) => r.discord_thread_id === interaction.channelId
    );

    if (!recruit) {
      return interaction.editReply(
        '❌ This command must be used inside a recruit thread (e.g. #recruit-12345-nation-name). I could not match this channel to a recruit.'
      );
    }

    const message = interaction.options.getString('message');
    const subject = 'RE: Union of Nations';

    try {
      await pnw.sendMail(recruit.nation_id, subject, message);
    } catch (err) {
      return interaction.editReply(`❌ Failed to send reply: ${err.message}`);
    }

    db.addMailLog({
      nationId: recruit.nation_id,
      direction: 'outgoing',
      subject,
      message,
      sentBy: interaction.user.id,
    });
    db.touchLastContacted(recruit.nation_id);

    const embed = new EmbedBuilder()
      .setTitle('📨 REPLY SENT')
      .addFields({ name: 'Sent By', value: `<@${interaction.user.id}>` })
      .setColor(0x2ecc71)
      .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });
    await interaction.channel.send({ content: truncateForDiscord(message, '**Message:**\n') });

    return interaction.editReply('✅ Reply sent.');
  },
};
