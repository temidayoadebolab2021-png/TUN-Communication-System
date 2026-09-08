// Shared permission check used by the mail-sending commands.
// If an admin has set a "recruiter role" (via /config recruiter-role),
// only Administrators and members with that role can send recruitment mail.
// If no recruiter role has ever been set, everyone can use these commands -
// same as how the bot behaved before this feature existed, so nothing
// breaks for alliances that don't want this restriction.

const { PermissionsBitField } = require('discord.js');
const db = require('../database');

function canSendRecruitmentMail(interaction) {
  const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (isAdmin) return true;

  const recruiterRoleId = db.getRecruiterRoleId();
  if (!recruiterRoleId) return true; // no restriction configured - open to everyone

  return interaction.member.roles.cache.has(recruiterRoleId);
}

module.exports = { canSendRecruitmentMail };
