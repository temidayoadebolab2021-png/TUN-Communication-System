module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error running command ${interaction.commandName}:`, err);
      const errorMessage = '❌ There was an error executing that command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMessage).catch(() => {});
      } else {
        await interaction.reply({ content: errorMessage, flags: 64 }).catch(() => {});
      }
    }
  },
};
