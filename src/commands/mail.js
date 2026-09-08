// /mail send    - send to one nation (ID, name, or link)
// /mail multi   - send to multiple nations (comma-separated IDs/names/links)
// /mail alliance - send to ALL members of an alliance (name or ID), with optional city filter
// /mail history  - view mail history with a nation

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pnw = require('../pnwApi');
const db = require('../database');
const { getOrCreateRecruitThread } = require('../utils/threads');
const { resolveNation } = require('../utils/resolveNation');
const { truncateForDiscord } = require('../utils/discordText');
const { canSendRecruitmentMail } = require('../utils/permissions');

// Safety caps for multi/alliance sends
const DELAY_MS = 2000;
const MAX_PER_RUN = 50;

function fillTemplate(text, nation) {
  return text
    .replaceAll('{nation_name}', nation.nation_name)
    .replaceAll('{leader_name}', nation.leader_name)
    .replaceAll('{nation}', nation.nation_name)
    .replaceAll('{leader}', nation.leader_name);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendToList(nations, rawSubject, rawMessage, interaction, label) {
  const personalKey = db.getPersonalApiKey(interaction.user.id);
  let sent = 0;
  let skipped = 0;
  const failures = [];

  for (const nation of nations) {
    if (sent >= MAX_PER_RUN) break;

    if (db.isBlacklisted(nation.id)) {
      skipped++;
      continue;
    }

    const subject = fillTemplate(rawSubject, nation);
    const message = fillTemplate(rawMessage, nation);

    try {
      await pnw.sendMail(nation.id, subject, message, personalKey);
    } catch (err) {
      failures.push(`${nation.nation_name} (#${nation.id}): ${err.message}`);
      continue;
    }

    db.addMailLog({
      nationId: nation.id,
      direction: 'outgoing',
      subject,
      message,
      sentBy: interaction.user.id,
    });
    db.touchLastContacted(nation.id);
    db.setInitialAttributionIfMissing(nation.id, null, interaction.user.id);

    try {
      const thread = await getOrCreateRecruitThread(interaction.client, nation.id, nation.nation_name);
      const embed = new EmbedBuilder()
        .setTitle(`📨 ${label}`)
        .addFields(
          { name: 'Nation', value: `${nation.nation_name} (#${nation.id})` },
          { name: 'Subject', value: subject },
          { name: 'Sent By', value: `<@${interaction.user.id}>` }
        )
        .setColor(0x3498db)
        .setTimestamp();
      await thread.send({ embeds: [embed] });
      await thread.send({ content: truncateForDiscord(message, '**Message:**\n') });
    } catch (err) {
      console.error(`Could not log mail thread for #${nation.id}:`, err.message);
    }

    sent++;
    await sleep(DELAY_MS);
  }

  let result = `✅ Done. Sent **${sent}** mail(s) from ${personalKey ? 'your nation' : "the alliance's shared nation"}.`;
  if (skipped > 0) result += ` Skipped **${skipped}** blacklisted nation(s).`;
  if (nations.length > MAX_PER_RUN) result += ` ⚠️ Only the first ${MAX_PER_RUN} were mailed (safety cap) — run the command again for the rest.`;
  if (failures.length > 0) result += `\n⚠️ ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '...' : ''}`;

  return result;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mail')
    .setDescription('In-game mail bridge')
    .addSubcommand((sub) =>
      sub
        .setName('send')
        .setDescription('Send in-game mail to a single nation')
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, name, or profile link').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('subject').setDescription('Mail subject').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Mail message').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('multi')
        .setDescription('Send the same mail to multiple nations (comma-separated IDs, names, or links)')
        .addStringOption((opt) =>
          opt
            .setName('nations')
            .setDescription('e.g. 12345, Arrow Kingdom, https://politicsandwar.com/nation/id=99')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('subject').setDescription('Mail subject').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Mail message. Use {nation}, {leader} as placeholders.').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('alliance')
        .setDescription('Send mail to members of an alliance, with optional city count filter')
        .addStringOption((opt) =>
          opt.setName('alliance').setDescription('Alliance name or numeric ID').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('subject').setDescription('Mail subject').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Mail message. Use {nation}, {leader} as placeholders.').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('cities-min').setDescription('Only mail members with at least this many cities').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('cities-max').setDescription('Only mail members with at most this many cities').setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('confirm')
            .setDescription('Set to true to actually send (default: dry-run only showing member count)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View mail history with a nation')
        .addStringOption((opt) =>
          opt.setName('nation').setDescription('Nation ID, nation name, or profile link').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ---------- /mail send ----------
    if (sub === 'send') {
      if (!canSendRecruitmentMail(interaction)) {
        return interaction.reply({
          content: '❌ You don\'t have permission to send recruitment mail. Ask an admin about the recruiter role.',
          flags: 64,
        });
      }

      await interaction.deferReply({ flags: 64 });
      const nationInput = interaction.options.getString('nation');

      let nation;
      try {
        nation = await resolveNation(nationInput);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${nationInput}". Check the spelling, ID, or link.`);

      const nationId = nation.id;
      const subject = fillTemplate(interaction.options.getString('subject'), nation);
      const message = fillTemplate(interaction.options.getString('message'), nation);

      if (db.isBlacklisted(nationId)) {
        const entry = db.getBlacklistEntry(nationId);
        return interaction.editReply(
          `🚫 ${nation.nation_name} (#${nationId}) is on the blacklist${entry?.reason ? ` (reason: ${entry.reason})` : ''}. ` +
            `Remove them first with \`/blacklist remove\` if you're sure.`
        );
      }

      const personalKey = db.getPersonalApiKey(interaction.user.id);
      try {
        await pnw.sendMail(nationId, subject, message, personalKey);
      } catch (err) {
        return interaction.editReply(`❌ Failed to send mail: ${err.message}`);
      }

      db.addMailLog({ nationId, direction: 'outgoing', subject, message, sentBy: interaction.user.id });
      db.touchLastContacted(nationId);
      db.setInitialAttributionIfMissing(nationId, null, interaction.user.id);

      const thread = await getOrCreateRecruitThread(interaction.client, nationId, nation.nation_name);
      const embed = new EmbedBuilder()
        .setTitle('📨 MAIL SENT')
        .addFields(
          { name: 'Nation', value: `${nation.nation_name} (#${nationId})` },
          { name: 'Subject', value: subject },
          { name: 'Sent By', value: `<@${interaction.user.id}>` }
        )
        .setColor(0x3498db)
        .setTimestamp();
      await thread.send({ embeds: [embed] });
      await thread.send({ content: truncateForDiscord(message, '**Message:**\n') });

      return interaction.editReply(
        `✅ Mail sent to ${nation.nation_name} (#${nationId}) from ${personalKey ? 'your own nation' : "the alliance's shared nation"}. See ${thread}.`
      );
    }

    // ---------- /mail multi ----------
    if (sub === 'multi') {
      if (!canSendRecruitmentMail(interaction)) {
        return interaction.reply({ content: '❌ You don\'t have permission to send recruitment mail.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });
      const rawSubject = interaction.options.getString('subject');
      const rawMessage = interaction.options.getString('message');

      const inputs = interaction.options
        .getString('nations')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (inputs.length === 0) return interaction.editReply('❌ No nations provided.');
      if (inputs.length > MAX_PER_RUN) {
        return interaction.editReply(`❌ Too many nations (${inputs.length}). Max ${MAX_PER_RUN} per command.`);
      }

      await interaction.editReply(`🔍 Looking up ${inputs.length} nation(s)...`);
      const resolved = await Promise.allSettled(inputs.map((i) => resolveNation(i)));

      const nations = [];
      const notFound = [];
      resolved.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value) nations.push(r.value);
        else notFound.push(inputs[idx]);
      });

      if (notFound.length > 0) {
        await interaction.editReply(
          `⚠️ Could not find ${notFound.length} nation(s): ${notFound.join(', ')}. Sending to the ${nations.length} found...`
        );
      }

      if (nations.length === 0) return interaction.editReply('❌ None of the nations could be found.');

      const result = await sendToList(nations, rawSubject, rawMessage, interaction, 'MULTI MAIL SENT');
      return interaction.editReply(result);
    }

    // ---------- /mail alliance ----------
    if (sub === 'alliance') {
      if (!canSendRecruitmentMail(interaction)) {
        return interaction.reply({ content: '❌ You don\'t have permission to send recruitment mail.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });
      const allianceInput = interaction.options.getString('alliance');
      const rawSubject = interaction.options.getString('subject');
      const rawMessage = interaction.options.getString('message');
      const citiesMin = interaction.options.getInteger('cities-min') ?? null;
      const citiesMax = interaction.options.getInteger('cities-max') ?? null;
      const confirm = interaction.options.getBoolean('confirm') ?? false;

      await interaction.editReply(`🔍 Looking up alliance "${allianceInput}"...`);

      let alliance;
      try {
        alliance = await pnw.getAlliance(allianceInput);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that alliance: ${err.message}`);
      }
      if (!alliance) return interaction.editReply(`❌ No alliance found matching "${allianceInput}".`);

      await interaction.editReply(`🔍 Found **${alliance.name}** (#${alliance.id}). Fetching member list...`);

      let members;
      try {
        members = await pnw.getAllianceMembers(alliance.id);
      } catch (err) {
        return interaction.editReply(`❌ Could not fetch members: ${err.message}`);
      }

      if (members.length === 0) return interaction.editReply(`That alliance has no members.`);

      // Apply city filter if specified
      let filtered = members;
      if (citiesMin !== null) filtered = filtered.filter((m) => Number(m.num_cities) >= citiesMin);
      if (citiesMax !== null) filtered = filtered.filter((m) => Number(m.num_cities) <= citiesMax);

      const blacklistedCount = filtered.filter((m) => db.isBlacklisted(m.id)).length;
      const eligible = filtered.filter((m) => !db.isBlacklisted(m.id));

      // Build a human-readable description of the city filter
      let cityFilterDesc = 'None (all cities)';
      if (citiesMin !== null && citiesMax !== null) cityFilterDesc = `${citiesMin}–${citiesMax} cities`;
      else if (citiesMin !== null) cityFilterDesc = `${citiesMin}+ cities`;
      else if (citiesMax !== null) cityFilterDesc = `up to ${citiesMax} cities`;

      if (!confirm) {
        return interaction.editReply(
          `🔍 **Dry run — ${alliance.name} (#${alliance.id})**\n\n` +
            `Total members: **${members.length}**\n` +
            `City filter: **${cityFilterDesc}** → **${filtered.length}** member(s) match\n` +
            `Blacklisted (would be skipped): **${blacklistedCount}**\n` +
            `Eligible to receive mail: **${eligible.length}**\n` +
            `Safety cap: **${MAX_PER_RUN}** per run (${eligible.length > MAX_PER_RUN ? `first ${MAX_PER_RUN} would be mailed, rest need another run` : 'all would be mailed in one run'})\n` +
            `Delay between each mail: **${DELAY_MS / 1000}s**\n\n` +
            `⚠️ This will mail members of **another alliance** — make sure this is intentional.\n\n` +
            `Re-run with \`confirm:true\` to actually send.`
        );
      }

      await interaction.editReply(
        `📨 Sending to ${eligible.length} member(s) of **${alliance.name}**${citiesMin !== null || citiesMax !== null ? ` (${cityFilterDesc})` : ''}... (this may take a while)`
      );

      const result = await sendToList(eligible, rawSubject, rawMessage, interaction, 'ALLIANCE MAIL SENT');
      return interaction.editReply(`**${alliance.name}** — ${result}`);
    }

    // ---------- /mail history ----------
    if (sub === 'history') {
      await interaction.deferReply({ flags: 64 });
      const nationInput = interaction.options.getString('nation');

      let nation;
      try {
        nation = await resolveNation(nationInput);
      } catch (err) {
        return interaction.editReply(`❌ Could not look up that nation: ${err.message}`);
      }
      if (!nation) return interaction.editReply(`❌ No nation found matching "${nationInput}".`);

      const rows = db.getMailLog(nation.id);
      if (rows.length === 0) return interaction.editReply(`No mail history found for ${nation.nation_name} (#${nation.id}).`);

      const lines = rows.map((row) => {
        const who = row.direction === 'outgoing' ? `Staff <@${row.sent_by}>` : 'Recruit';
        return `**[${row.created_at}] ${who} (${row.direction})**\n*${row.subject}*\n${row.message}\n`;
      });

      let text = lines.join('\n');
      if (text.length > 1900) text = text.slice(0, 1900) + '\n...(truncated)';
      return interaction.editReply(text);
    }
  },
};
