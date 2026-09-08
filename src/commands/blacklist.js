// /blacklist add/remove/list
// Keeps a list of nations the bot should never recruit (hostile players, trolls,
// spies, previous rejects). Bulk recruiting automatically skips anyone on this list.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { resolveNation } = require('../utils/resolveNation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Manage the recruitment blacklist')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a nation to the blacklist')
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Why this nation is blacklisted').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a nation from the blacklist')
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show all blacklisted nations')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');
      const reason = interaction.options.getString('reason');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) {
        return interaction.editReply(`❌ No nation found matching "${input}".`);
      }

      db.addToBlacklist(nation.id, reason, interaction.user.id);
      return interaction.editReply(
        `🚫 ${nation.nation_name} (#${nation.id}) added to the blacklist${reason ? ` — reason: ${reason}` : ''}. Bulk recruiting will skip this nation.`
      );
    }

    if (sub === 'remove') {
      await interaction.deferReply({ flags: 64 });
      const input = interaction.options.getString('nation');

      let nation;
      try {
        nation = await resolveNation(input);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) {
        return interaction.editReply(`❌ No nation found matching "${input}".`);
      }

      const existed = db.removeFromBlacklist(nation.id);
      return interaction.editReply(
        existed
          ? `✅ ${nation.nation_name} (#${nation.id}) removed from the blacklist.`
          : `That nation wasn't on the blacklist.`
      );
    }

    if (sub === 'list') {
      const entries = db.getAllBlacklisted();
      if (entries.length === 0) {
        return interaction.reply({ content: 'The blacklist is empty.', flags: 64 });
      }

      const embed = new EmbedBuilder()
        .setTitle('🚫 Blacklisted Nations')
        .setColor(0xe74c3c)
        .setDescription(
          entries
            .map((e) => `Nation #${e.nation_id}${e.reason ? ` — ${e.reason}` : ''} (added by <@${e.added_by}>)`)
            .join('\n')
            .slice(0, 4000)
        );

      return interaction.reply({ embeds: [embed], flags: 64 });
    }
  },
};
