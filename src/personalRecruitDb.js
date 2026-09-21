// Per-staff personal recruitment database module.
// Each staff member who registers their API key can have their own:
//   - Private template pool (only used in their own auto-recruit)
//   - Auto-recruit on/off toggle
//   - Schedule setting
//   - Known nation IDs (so they never double-mail the same nation)
//
// Data is stored in bot.json under `personalRecruitProfiles` keyed by
// Discord user ID. Completely separate from the shared alliance system.

const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'bot.json');

function loadData() {
  if (!fs.existsSync(dbPath)) return {};
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
  catch { return {}; }
}

function saveData(data) {
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dbPath);
}

function getProfile(userId) {
  const data = loadData();
  return data.personalRecruitProfiles?.[userId] || null;
}

function ensureProfile(userId) {
  const data = loadData();
  if (!data.personalRecruitProfiles) data.personalRecruitProfiles = {};
  if (!data.personalRecruitProfiles[userId]) {
    data.personalRecruitProfiles[userId] = {
      userId,
      autoRecruitEnabled: false,
      templates: {},
      knownNationIds: {},
      createdAt: new Date().toISOString(),
    };
    saveData(data);
  }
  return data.personalRecruitProfiles[userId];
}

function getAllProfiles() {
  const data = loadData();
  return Object.values(data.personalRecruitProfiles || {});
}

// ---------- Settings ----------

function setPersonalAutoRecruit(userId, enabled) {
  const data = loadData();
  ensureProfile(userId);
  data.personalRecruitProfiles[userId].autoRecruitEnabled = enabled;
  saveData(data);
}

// ---------- Personal templates ----------

function addPersonalTemplate(userId, { id, subject, body, type }) {
  const data = loadData();
  ensureProfile(userId);
  const profile = data.personalRecruitProfiles[userId];
  if (profile.templates[id]) throw new Error(`You already have a template with ID "${id}".`);
  profile.templates[id] = {
    id, subject, body,
    type: type || 'initial',
    createdAt: new Date().toISOString(),
  };
  saveData(data);
  return profile.templates[id];
}

function getPersonalTemplate(userId, id) {
  const profile = getProfile(userId);
  return profile?.templates?.[id] || null;
}

function getAllPersonalTemplates(userId) {
  const profile = getProfile(userId);
  return Object.values(profile?.templates || {});
}

function getPersonalTemplatesByType(userId, type) {
  return getAllPersonalTemplates(userId).filter((t) => (t.type || 'initial') === type);
}

function getRandomPersonalTemplate(userId, type = 'initial') {
  const pool = getPersonalTemplatesByType(userId, type);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function updatePersonalTemplate(userId, id, fields) {
  const data = loadData();
  ensureProfile(userId);
  const profile = data.personalRecruitProfiles[userId];
  if (!profile.templates[id]) throw new Error(`Template "${id}" not found.`);
  profile.templates[id] = { ...profile.templates[id], ...fields };
  saveData(data);
  return profile.templates[id];
}

function deletePersonalTemplate(userId, id) {
  const data = loadData();
  const profile = data.personalRecruitProfiles?.[userId];
  if (!profile) return false;
  const existed = Boolean(profile.templates[id]);
  delete profile.templates[id];
  saveData(data);
  return existed;
}

// ---------- Known nation IDs (per-staff dedup) ----------

function isPersonalKnownNation(userId, nationId) {
  const profile = getProfile(userId);
  return Boolean(profile?.knownNationIds?.[String(nationId)]);
}

function markPersonalNationKnown(userId, nationId) {
  const data = loadData();
  ensureProfile(userId);
  data.personalRecruitProfiles[userId].knownNationIds[String(nationId)] = new Date().toISOString();
  saveData(data);
}

module.exports = {
  getProfile,
  ensureProfile,
  getAllProfiles,
  setPersonalAutoRecruit,
  addPersonalTemplate,
  getPersonalTemplate,
  getAllPersonalTemplates,
  getPersonalTemplatesByType,
  getRandomPersonalTemplate,
  updatePersonalTemplate,
  deletePersonalTemplate,
  isPersonalKnownNation,
  markPersonalNationKnown,
};
