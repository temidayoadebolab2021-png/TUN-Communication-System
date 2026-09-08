// /config-status
// Shows a complete overview of every bot configuration setting in one place.
// Admin only.

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config-status')
    .setDescription('View all current bot configuration settings (Admin only)'),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    // --- Gather all settings ---
    const mailLogChannelId = db.getMailLogChannelId();
    const recruiterRoleId = db.getRecruiterRoleId();
    const allianceId = db.getSetting('myAllianceId');
    const autoRecruit = db.getSetting('autoRecruitEnabled');
    const applicantMsg = db.getApplicantMessage();
    const demotionMsg = db.getDemotionMessage();
    const templates = db.getAllTemplates();
    const blacklisted = db.getAllBlacklisted();
    const protectedAlliances = db.getSetting('protectedAlliances') || [];
    const backfillDone = db.isApplicantBackfillDone();
    const departureDone = db.isDepartureBackfillDone();

    // Group templates by type
    const byType = {};
    for (const t of templates) {
      const type = t.type || 'initial';
      if (!byType[type]) byType[type] = [];
      byType[type].push(t.id);
    }

    const templateSummary = Object.entries(byType)
      .map(([type, ids]) => `${type}: ${ids.join(', ')}`)
      .join('\n') || 'None';

    // --- Build embeds (split across multiple since there's a lot) ---
    const embed1 = new EmbedBuilder()
      .setTitle('⚙️ Bot Configuration — Overview')
      .setColor(0x3498db)
      .setTimestamp()
      .addFields(
        {
          name: '📨 Mail Log Channel',
          value: mailLogChannelId ? `<#${mailLogChannelId}>` : '❌ Not configured — use `/config mail-log-channel set`',
          inline: false,
        },
        {
          name: '🎯 Auto-Recruit (new nations)',
          value: autoRecruit ? '✅ ON' : '🛑 OFF — use `/recruit auto state:on` to enable',
          inline: true,
        },
        {
          name: '👥 Recruiter Role',
          value: recruiterRoleId ? `<@&${recruiterRoleId}>` : 'None (everyone can send mail)',
          inline: true,
        },
        {
          name: '🏛️ Your Alliance ID',
          value: allianceId ? `**${allianceId}** (used for applicant/demotion detection)` : '❌ Not set — use `/config alliance-id set`',
          inline: false,
        },
        {
          name: '📥 Applicant Scanner',
          value: allianceId
            ? (backfillDone ? '✅ Active (backfill complete, detecting new applicants)' : '⏳ Waiting for first scan (backfill not yet done)')
            : '❌ Not running (no alliance ID configured)',
          inline: false,
        },
        {
          name: '⬇️ Demotion Scanner',
          value: allianceId
            ? (backfillDone ? '✅ Active (detecting demotions)' : '⏳ Waiting for first scan')
            : '❌ Not running (no alliance ID configured)',
          inline: false,
        },
        {
          name: '🚪 Alliance Exit Scanner',
          value: departureDone ? '✅ Active (detecting alliance departures)' : '⏳ Waiting for first scan (backfill not yet done)',
          inline: false,
        }
      );

    const embed2 = new EmbedBuilder()
      .setTitle('⚙️ Bot Configuration — Messages')
      .setColor(0x9b59b6)
      .addFields(
        {
          name: '📩 Applicant Welcome Message',
          value: applicantMsg.subject
            ? `**Subject:** ${applicantMsg.subject}\n**Body:** ${applicantMsg.body?.slice(0, 150)}${(applicantMsg.body?.length ?? 0) > 150 ? '...' : ''}`
            : '❌ Not configured — use `/config applicant-message set`',
          inline: false,
        },
        {
          name: '⬇️ Demotion Notification Message',
          value: demotionMsg.subject
            ? `**Subject:** ${demotionMsg.subject}\n**Body:** ${demotionMsg.body?.slice(0, 150)}${(demotionMsg.body?.length ?? 0) > 150 ? '...' : ''}`
            : '❌ Not configured — use `/config demotion-message set`',
          inline: false,
        }
      );

    const embed3 = new EmbedBuilder()
      .setTitle('⚙️ Bot Configuration — Templates & Safety')
      .setColor(0x2ecc71)
      .addFields(
        {
          name: `📋 Recruitment Templates (${templates.length} total)`,
          value: templateSummary.slice(0, 1024),
          inline: false,
        },
        {
          name: '🚫 Blacklisted Nations',
          value: blacklisted.length > 0
            ? `${blacklisted.length} nation(s) blacklisted — use \`/blacklist list\` to see them`
            : 'None',
          inline: false,
        },
        {
          name: '🛡️ Protected Alliances (coalition/treaty)',
          value: Array.isArray(protectedAlliances) && protectedAlliances.length > 0
            ? protectedAlliances.join(', ')
            : 'None configured',
          inline: false,
        }
      );

    return interaction.editReply({ embeds: [embed1, embed2, embed3] });
  },
};
