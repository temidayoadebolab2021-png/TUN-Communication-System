// Run this file ONCE (and again whenever you add/change a command) with:
//   node src/deployCommands.js
// It tells Discord which slash commands your bot has, so they show up when typing "/" in your server.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s)...`);

    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );

    console.log('✅ Slash commands registered successfully. Check your Discord server!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
