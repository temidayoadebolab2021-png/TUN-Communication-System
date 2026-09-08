// /apikey set key:<your key> - register your own PnW API key so YOUR mail
// sends from YOUR nation when you use /mail send or /recruit bulk.
// /apikey remove - delete your stored key
// /apikey status - check whether you have a key registered (never shows the key itself)

const { SlashCommandBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('apikey')
    .setDescription('Manage your personal Politics & War API key')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Register your own PnW API key so your mail sends from your own nation')
        .addStringOption((opt) =>
          opt.setName('key').setDescription('Your PnW API key (from politicsandwar.com Account Settings)').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove your stored API key'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Check whether you have a key registered'))
    .addSubcommand((sub) =>
      sub
        .setName('remove-for')
        .setDescription('(Admin only) Remove another staff member\'s stored API key')
        .addUserOption((opt) => opt.setName('user').setDescription('Whose key to remove').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // This command should ONLY ever be answered privately - it deals with secrets.
    if (sub === 'set') {
      const key = interaction.options.getString('key').trim();
      await interaction.deferReply({ flags: 64 });

      const result = await pnw.verifyApiKey(key);
      if (!result.valid) {
        return interaction.editReply(
          `❌ That key doesn't seem to work (${result.reason}). Double-check it's copied correctly from ` +
            `politicsandwar.com → Account Settings → API Key, with no extra spaces.`
        );
      }

      db.setPersonalApiKey(interaction.user.id, key);
      return interaction.editReply(
        `✅ Your API key has been saved. From now on, when YOU use \`/mail send\` or \`/recruit bulk\`, ` +
          `the mail will be sent from YOUR nation instead of the alliance's shared one.\n\n` +
          `⚠️ Security note: this key is stored in the bot's local data file, not specially encrypted. ` +
          `It's protected the same way the bot's other secrets are (never committed to GitHub, only accessible ` +
          `to whoever manages the bot's hosting). If you're not comfortable with that, you can remove it anytime ` +
          `with \`/apikey remove\`.`
      );
    }

    if (sub === 'remove') {
      const existed = db.removePersonalApiKey(interaction.user.id);
      return interaction.reply({
        content: existed
          ? '✅ Your API key has been removed. Your mail will now go through the alliance\'s shared key again.'
          : "You don't have a key registered.",
        flags: 64,
      });
    }

    if (sub === 'status') {
      const has = db.hasPersonalApiKey(interaction.user.id);
      return interaction.reply({
        content: has
          ? '✅ You have a personal API key registered. Your mail sends from your own nation.'
          : 'ℹ️ You don\'t have a personal key registered. Your mail currently sends through the alliance\'s shared key. Use `/apikey set` to register your own.',
        flags: 64,
      });
    }

    if (sub === 'remove-for') {
      const { PermissionsBitField } = require('discord.js');
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
      }

      const targetUser = interaction.options.getUser('user');
      const existed = db.removePersonalApiKey(targetUser.id);
      return interaction.reply({
        content: existed
          ? `✅ Removed ${targetUser.tag}'s stored API key. They'll use the alliance's shared key until they register a new one.`
          : `${targetUser.tag} didn't have a key registered.`,
        flags: 64,
      });
    }
  },
};
