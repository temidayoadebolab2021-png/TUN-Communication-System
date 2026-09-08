// /config - Admin-only bot configuration commands.
// /config recruiter-role set/clear/status
// /config mail-log-channel set/clear/status
// /config alliance-id set/status
// /config applicant-message set/clear/status
// /config demotion-message set/clear/status

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot configuration (Administrator only)')
    .addSubcommandGroup((group) =>
      group
        .setName('recruiter-role')
        .setDescription('Control who can send recruitment mail through the bot')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Only Administrators and this role can use /mail send and /recruit bulk')
            .addRoleOption((opt) => opt.setName('role').setDescription('The recruiter role').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub.setName('clear').setDescription('Remove the restriction - everyone can send recruitment mail again')
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Show the current recruiter role setting'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('mail-log-channel')
        .setDescription('Set which channel mail logs and recruit threads are posted in')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set the mail log channel')
            .addChannelOption((opt) =>
              opt.setName('channel').setDescription('The channel to post mail logs in').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub.setName('clear').setDescription('Revert to the MAIL_LOG_CHANNEL_ID value in .env')
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Show the current mail log channel'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('alliance-id')
        .setDescription('Set your alliance ID (required for applicant/demotion detection)')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set your alliance numeric ID from PnW')
            .addIntegerOption((opt) =>
              opt.setName('id').setDescription('Your alliance ID (number in the URL on your alliance page)').setRequired(true)
            )
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Show the currently configured alliance ID'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('applicant-message')
        .setDescription('Message sent automatically to new applicants when they apply to your alliance')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set the subject and body of the applicant welcome message')
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('Mail subject. Use {nation}, {leader} as placeholders.').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('body').setDescription('Mail body. Use {nation}, {leader} as placeholders.').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub.setName('clear').setDescription('Disable the applicant welcome message')
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Show the current applicant message'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('demotion-message')
        .setDescription('Message sent automatically to members who get demoted to applicant')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set the subject and body of the demotion notification message')
            .addStringOption((opt) =>
              opt.setName('subject').setDescription('Mail subject. Use {nation}, {leader} as placeholders.').setRequired(true)
            )
            .addStringOption((opt) =>
              opt.setName('body').setDescription('Mail body. Use {nation}, {leader} as placeholders.').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub.setName('clear').setDescription('Disable the demotion notification message')
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Show the current demotion message'))
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You need Administrator permission to use this.', flags: 64 });
    }

    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    // ---------- /config recruiter-role ----------
    if (group === 'recruiter-role') {
      if (sub === 'set') {
        const role = interaction.options.getRole('role');
        db.setRecruiterRoleId(role.id);
        return interaction.reply({ content: `✅ Only Administrators and members with the **${role.name}** role can now use \`/mail send\` and \`/recruit bulk\`.`, flags: 64 });
      }
      if (sub === 'clear') {
        db.setRecruiterRoleId(null);
        return interaction.reply({ content: '✅ Recruiter role restriction removed.', flags: 64 });
      }
      if (sub === 'status') {
        const roleId = db.getRecruiterRoleId();
        return interaction.reply({ content: roleId ? `Current recruiter role: <@&${roleId}> (plus Administrators)` : 'No recruiter role set.', flags: 64 });
      }
    }

    // ---------- /config mail-log-channel ----------
    if (group === 'mail-log-channel') {
      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        db.setMailLogChannelId(channel.id);
        return interaction.reply({ content: `✅ Mail log channel set to ${channel}.`, flags: 64 });
      }
      if (sub === 'clear') {
        db.setMailLogChannelId(null);
        const fallback = process.env.MAIL_LOG_CHANNEL_ID;
        return interaction.reply({
          content: fallback
            ? `✅ Cleared. Reverted to .env value (<#${fallback}>).`
            : `✅ Cleared. Note: no MAIL_LOG_CHANNEL_ID in .env either — set one before mail logging will work.`,
          flags: 64,
        });
      }
      if (sub === 'status') {
        const dbChannel = db.getSetting('mailLogChannelId');
        const envChannel = process.env.MAIL_LOG_CHANNEL_ID;
        const active = dbChannel || envChannel;
        return interaction.reply({ content: active ? `Current mail log channel: <#${active}>${dbChannel ? ' (set via /config)' : ' (from .env)'}` : '❌ No mail log channel configured.', flags: 64 });
      }
    }

    // ---------- /config alliance-id ----------
    if (group === 'alliance-id') {
      if (sub === 'set') {
        const id = interaction.options.getInteger('id');
        db.setSetting('myAllianceId', id);
        // Reset backfill so the scanner re-snapshots fresh with the new alliance
        db.setSetting('applicantBackfillDone', false);
        return interaction.reply({
          content: `✅ Alliance ID set to **${id}**. The applicant/demotion scanner will start monitoring your alliance within 5 minutes.\n\nMake sure you've also configured the applicant and demotion messages with \`/config applicant-message set\` and \`/config demotion-message set\`.`,
          flags: 64,
        });
      }
      if (sub === 'status') {
        const id = db.getSetting('myAllianceId');
        return interaction.reply({ content: id ? `Current alliance ID: **${id}**` : '❌ Alliance ID not configured. Use `/config alliance-id set id:14124`.', flags: 64 });
      }
    }

    // ---------- /config applicant-message ----------
    if (group === 'applicant-message') {
      if (sub === 'set') {
        const subject = interaction.options.getString('subject');
        const body = interaction.options.getString('body');
        db.setApplicantMessage(subject, body);
        return interaction.reply({
          content: `✅ Applicant welcome message saved.\n**Subject:** ${subject}\n**Body preview:** ${body.slice(0, 100)}${body.length > 100 ? '...' : ''}`,
          flags: 64,
        });
      }
      if (sub === 'clear') {
        db.setApplicantMessage(null, null);
        return interaction.reply({ content: '✅ Applicant message cleared. New applicants will no longer be auto-mailed.', flags: 64 });
      }
      if (sub === 'status') {
        const msg = db.getApplicantMessage();
        return interaction.reply({
          content: msg.subject
            ? `**Applicant message:**\nSubject: ${msg.subject}\nBody: ${msg.body?.slice(0, 200)}${(msg.body?.length ?? 0) > 200 ? '...' : ''}`
            : '❌ No applicant message configured. Use `/config applicant-message set`.',
          flags: 64,
        });
      }
    }

    // ---------- /config demotion-message ----------
    if (group === 'demotion-message') {
      if (sub === 'set') {
        const subject = interaction.options.getString('subject');
        const body = interaction.options.getString('body');
        db.setDemotionMessage(subject, body);
        return interaction.reply({
          content: `✅ Demotion message saved.\n**Subject:** ${subject}\n**Body preview:** ${body.slice(0, 100)}${body.length > 100 ? '...' : ''}`,
          flags: 64,
        });
      }
      if (sub === 'clear') {
        db.setDemotionMessage(null, null);
        return interaction.reply({ content: '✅ Demotion message cleared. Demoted members will no longer be auto-mailed.', flags: 64 });
      }
      if (sub === 'status') {
        const msg = db.getDemotionMessage();
        return interaction.reply({
          content: msg.subject
            ? `**Demotion message:**\nSubject: ${msg.subject}\nBody: ${msg.body?.slice(0, 200)}${(msg.body?.length ?? 0) > 200 ? '...' : ''}`
            : '❌ No demotion message configured. Use `/config demotion-message set`.',
          flags: 64,
        });
      }
    }
  },
};
