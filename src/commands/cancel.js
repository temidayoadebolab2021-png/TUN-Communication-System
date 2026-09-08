// /cancel - stops an in-progress /dm role mass-DM run.

const { SlashCommandBuilder } = require('discord.js');
const massDm = require('../state/massDm');

module.exports = {
  data: new SlashCommandBuilder().setName('cancel').setDescription('Cancel an ongoing mass DM'),

  async execute(interaction) {
    massDm.requestCancel();
    return interaction.reply({ content: '🛑 Mass DM will stop after the current member.', flags: 64 });
  },
};
