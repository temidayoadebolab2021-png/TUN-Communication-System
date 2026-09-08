// This is the file you run to start the bot: node src/index.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { startNewNationScanner } = require('./scheduler/newNationScanner');
const { startFollowUpScanner } = require('./scheduler/followUpScanner');
const { startAllianceExitScanner } = require('./scheduler/allianceExitScanner');
const { startApplicantScanner } = require('./scheduler/applicantScanner');
const { startEngagementScheduler } = require('./scheduler/engagementScanner');

// Make sure required settings exist before we even try to start.
const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'PNW_API_KEY'];
for (const key of required) {
  if (!process.env[key] || process.env[key].startsWith('paste_')) {
    console.error(`❌ Missing or unfilled setting: ${key}. Check your .env file.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection();

// Load every command file in src/commands/
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Load every event file in src/events/
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

async function deployCommands() {
  const commands = [...client.commands.values()].map((cmd) => cmd.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    if (process.env.DISCORD_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} slash command(s) to guild ${process.env.DISCORD_GUILD_ID}.`);
    } else {
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
      console.log(`✅ Registered ${commands.length} slash command(s) globally.`);
    }
  } catch (err) {
    console.error('⚠️ Failed to register slash commands:', err.message);
  }
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Bot is online in ${client.guilds.cache.size} server(s).`);

  await deployCommands();

  startNewNationScanner(client);
  startFollowUpScanner(client);
  startAllianceExitScanner(client);
  startApplicantScanner(client);
  startEngagementScheduler(client);
});

client.login(process.env.DISCORD_TOKEN);
