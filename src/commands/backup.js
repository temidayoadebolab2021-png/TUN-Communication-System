// /backup export  - sends the current data/bot.json as a Discord file attachment
// /backup restore - accepts a backup file attachment and restores it immediately
// Admin only for both.

const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'bot.json');
const DB_DIR = path.dirname(DB_PATH);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Backup and restore all bot data (Admin only)')
    .addSubcommand((sub) =>
      sub
        .setName('export')
        .setDescription('Download a backup of all bot configuration and data')
    )
    .addSubcommand((sub) =>
      sub
        .setName('restore')
        .setDescription('Restore bot data from a previously exported backup file')
        .addAttachmentOption((opt) =>
          opt
            .setName('file')
            .setDescription('The .json backup file from /backup export')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    const sub = interaction.options.getSubcommand();

    // ---------- /backup export ----------
    if (sub === 'export') {
      if (!fs.existsSync(DB_PATH)) {
        return interaction.reply({
          content: '❌ No data file found yet — the bot hasn\'t saved anything yet. Try again after using the bot for a bit.',
          flags: 64,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `tun-bot-backup-${timestamp}.json`;
      const attachment = new AttachmentBuilder(DB_PATH, { name: filename });

      return interaction.reply({
        content:
          `📦 **Bot Backup — ${new Date().toUTCString()}**\n\n` +
          `This file contains all your bot data: templates, configured messages, recruit history, alliance settings, and personal API keys.\n\n` +
          `⚠️ **Keep this file private** — it contains sensitive data including API keys.\n\n` +
          `To restore: use \`/backup restore\` and attach this file.`,
        files: [attachment],
        flags: 64,
      });
    }

    // ---------- /backup restore ----------
    if (sub === 'restore') {
      await interaction.deferReply({ flags: 64 });

      const attachment = interaction.options.getAttachment('file');

      // Download the backup file from Discord's CDN
      let raw;
      try {
        const response = await fetch(attachment.url);
        raw = await response.text();
      } catch (err) {
        return interaction.editReply(`❌ Could not download the backup file: ${err.message}`);
      }

      // Validate it's proper JSON before touching anything
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return interaction.editReply(
          '❌ The file is not valid JSON — it may be corrupted or is not a bot backup file. No changes were made.'
        );
      }

      // Light validation — check it looks like a real bot backup
      const expectedKeys = ['recruits', 'templates', 'settings'];
      const missingKeys = expectedKeys.filter((k) => !(k in parsed));
      if (missingKeys.length > 0) {
        return interaction.editReply(
          `❌ This doesn't look like a valid bot backup — missing fields: ${missingKeys.join(', ')}. No changes were made.`
        );
      }

      // Back up the CURRENT data before overwriting it, just in case
      const safetyBackupPath = DB_PATH + '.pre-restore.' + Date.now();
      try {
        if (fs.existsSync(DB_PATH)) {
          fs.copyFileSync(DB_PATH, safetyBackupPath);
        }
      } catch (err) {
        console.warn('⚠️ Could not create pre-restore safety backup:', err.message);
      }

      // Write atomically (temp file + rename = never half-written)
      const tmpPath = DB_PATH + '.tmp';
      try {
        if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2));
        fs.renameSync(tmpPath, DB_PATH);
      } catch (err) {
        return interaction.editReply(`❌ Failed to write the restored data: ${err.message}`);
      }

      // Count what was restored so the confirmation is informative
      const templateCount = Object.keys(parsed.templates || {}).length;
      const recruitCount = Object.keys(parsed.recruits || {}).length;
      const blacklistCount = Object.keys(parsed.blacklist || {}).length;
      const campaignCount = Object.keys(parsed.engagementCampaigns || {}).length;

      return interaction.editReply(
        `✅ **Restore complete.** The bot is now using the restored data.\n\n` +
          `📋 Templates restored: **${templateCount}**\n` +
          `👥 Recruits restored: **${recruitCount}**\n` +
          `🚫 Blacklist entries: **${blacklistCount}**\n` +
          `📚 Engagement campaigns: **${campaignCount}**\n\n` +
          `A safety copy of your previous data was saved on disk as \`bot.json.pre-restore.${Date.now()}\` in case you need to undo this.`
      );
    }
  },
};
