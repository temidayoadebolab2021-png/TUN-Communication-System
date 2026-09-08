// Engagement system database functions.
// This is a SEPARATE module from database.js to keep things clean.
// It uses the same bot.json file via the same loadData/saveData pattern,
// but only touches the engagement-specific fields.

const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'bot.json');

function loadData() {
  if (!fs.existsSync(dbPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  const tmpPath = dbPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, dbPath);
}

function ensureEngagementFields(data) {
  if (!data.engagementCampaigns) data.engagementCampaigns = {};
  if (!data.engagementMessages) data.engagementMessages = {};
  if (!data.engagementMemberState) data.engagementMemberState = {};
  if (!data.engagementHistory) data.engagementHistory = [];
  if (!data.engagementEnabled) data.engagementEnabled = true;
  return data;
}

// ---------- Global switch ----------

function isEngagementEnabled() {
  const data = loadData();
  // Default to true if never set
  return data.engagementEnabled !== false;
}

function setEngagementEnabled(val) {
  const data = ensureEngagementFields(loadData());
  data.engagementEnabled = val;
  saveData(data);
}

// ---------- Campaigns ----------

function createCampaign({ id, name, allianceId, scheduleHours, cooldownHours, maxMessagesPerMember }) {
  const data = ensureEngagementFields(loadData());
  if (data.engagementCampaigns[id]) throw new Error(`Campaign "${id}" already exists.`);
  data.engagementCampaigns[id] = {
    id,
    name,
    allianceId: Number(allianceId),
    enabled: false, // always starts disabled — must be explicitly enabled
    scheduleHours: Number(scheduleHours) || 48,
    cooldownHours: Number(cooldownHours) || 48,
    maxMessagesPerMember: Number(maxMessagesPerMember) || 20,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
  };
  saveData(data);
  return data.engagementCampaigns[id];
}

function getCampaign(id) {
  const data = loadData();
  return data.engagementCampaigns?.[id] || null;
}

function getAllCampaigns() {
  const data = loadData();
  return Object.values(data.engagementCampaigns || {});
}

function updateCampaign(id, fields) {
  const data = ensureEngagementFields(loadData());
  if (!data.engagementCampaigns[id]) throw new Error(`Campaign "${id}" not found.`);
  data.engagementCampaigns[id] = { ...data.engagementCampaigns[id], ...fields };
  saveData(data);
  return data.engagementCampaigns[id];
}

function deleteCampaign(id) {
  const data = ensureEngagementFields(loadData());
  const existed = Boolean(data.engagementCampaigns[id]);
  delete data.engagementCampaigns[id];
  // Also delete all messages and state for this campaign
  for (const msgId of Object.keys(data.engagementMessages || {})) {
    if (data.engagementMessages[msgId].campaignId === id) {
      delete data.engagementMessages[msgId];
    }
  }
  delete data.engagementMemberState[id];
  saveData(data);
  return existed;
}

function setCampaignEnabled(id, enabled) {
  return updateCampaign(id, { enabled });
}

function setCampaignLastRunAt(id, timestamp) {
  return updateCampaign(id, { lastRunAt: timestamp });
}

// ---------- Engagement messages ----------

function addEngagementMessage({
  id, campaignId, subject, body, sequenceOrder,
  minCities, maxCities, minMembershipDays, maxMembershipDays,
  minNationAgeDays, maxNationAgeDays,
}) {
  const data = ensureEngagementFields(loadData());
  if (!data.engagementCampaigns[campaignId]) throw new Error(`Campaign "${campaignId}" not found.`);
  if (data.engagementMessages[id]) throw new Error(`Message "${id}" already exists.`);
  data.engagementMessages[id] = {
    id,
    campaignId,
    subject,
    body,
    sequenceOrder: Number(sequenceOrder) || 1,
    minCities: minCities != null ? Number(minCities) : null,
    maxCities: maxCities != null ? Number(maxCities) : null,
    minMembershipDays: minMembershipDays != null ? Number(minMembershipDays) : null,
    maxMembershipDays: maxMembershipDays != null ? Number(maxMembershipDays) : null,
    minNationAgeDays: minNationAgeDays != null ? Number(minNationAgeDays) : null,
    maxNationAgeDays: maxNationAgeDays != null ? Number(maxNationAgeDays) : null,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  saveData(data);
  return data.engagementMessages[id];
}

function getEngagementMessage(id) {
  const data = loadData();
  return data.engagementMessages?.[id] || null;
}

function getMessagesForCampaign(campaignId) {
  const data = loadData();
  return Object.values(data.engagementMessages || {})
    .filter((m) => m.campaignId === campaignId && m.enabled !== false)
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
}

function deleteEngagementMessage(id) {
  const data = ensureEngagementFields(loadData());
  const existed = Boolean(data.engagementMessages[id]);
  delete data.engagementMessages[id];
  saveData(data);
  return existed;
}

function updateEngagementMessage(id, fields) {
  const data = ensureEngagementFields(loadData());
  if (!data.engagementMessages[id]) throw new Error(`Message "${id}" not found.`);
  data.engagementMessages[id] = { ...data.engagementMessages[id], ...fields };
  saveData(data);
  return data.engagementMessages[id];
}

// ---------- Member state ----------

function getMemberState(campaignId, nationId) {
  const data = loadData();
  return data.engagementMemberState?.[campaignId]?.[String(nationId)] || null;
}

function initMemberState(campaignId, nationId) {
  const data = ensureEngagementFields(loadData());
  if (!data.engagementMemberState[campaignId]) data.engagementMemberState[campaignId] = {};
  const key = String(nationId);
  if (!data.engagementMemberState[campaignId][key]) {
    data.engagementMemberState[campaignId][key] = {
      nationId: Number(nationId),
      campaignId,
      currentSequence: 0,   // index of last message sent (0 = none sent yet)
      firstSeenAt: new Date().toISOString(),
      lastMessageAt: null,
      totalSent: 0,
      completed: false,
      messagesSent: [],     // IDs of messages already sent to this member
    };
    saveData(data);
  }
  return data.engagementMemberState[campaignId][key];
}

function updateMemberState(campaignId, nationId, fields) {
  const data = ensureEngagementFields(loadData());
  if (!data.engagementMemberState[campaignId]) data.engagementMemberState[campaignId] = {};
  const key = String(nationId);
  const existing = data.engagementMemberState[campaignId][key] || {};
  data.engagementMemberState[campaignId][key] = { ...existing, ...fields };
  saveData(data);
  return data.engagementMemberState[campaignId][key];
}

function getAllMemberStatesForCampaign(campaignId) {
  const data = loadData();
  return Object.values(data.engagementMemberState?.[campaignId] || {});
}

// ---------- History ----------

function logEngagementHistory({ campaignId, messageId, nationId, nationName, status, reason }) {
  const data = ensureEngagementFields(loadData());
  data.engagementHistory.push({
    campaignId,
    messageId: messageId || null,
    nationId,
    nationName: nationName || String(nationId),
    status,   // 'sent', 'skipped', 'error', 'cooldown', 'completed', 'ineligible'
    reason: reason || null,
    sentAt: new Date().toISOString(),
  });
  // Cap history at 2000 entries to prevent unbounded growth
  if (data.engagementHistory.length > 2000) {
    data.engagementHistory = data.engagementHistory.slice(-2000);
  }
  saveData(data);
}

function getEngagementHistory({ campaignId, limit } = {}) {
  const data = loadData();
  let history = data.engagementHistory || [];
  if (campaignId) history = history.filter((h) => h.campaignId === campaignId);
  return history.slice(-Math.min(limit || 50, 200)).reverse();
}

// ---------- Eligibility check ----------
// Central function so the scanner and preview command use identical logic.

function daysSince(isoString) {
  if (!isoString) return 0;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Checks whether a message's eligibility conditions match a nation's current data.
 * nation: the API response object (num_cities, date, etc.)
 * memberState: the member's state for this campaign (firstSeenAt)
 */
function messageMatchesNation(message, nation, memberState) {
  const cities = Number(nation.num_cities) || 0;
  const nationAgeDays = daysSince(nation.date);
  const membershipDays = memberState ? daysSince(memberState.firstSeenAt) : 0;

  if (message.minCities != null && cities < message.minCities) return { eligible: false, reason: `cities ${cities} < min ${message.minCities}` };
  if (message.maxCities != null && cities > message.maxCities) return { eligible: false, reason: `cities ${cities} > max ${message.maxCities}` };
  if (message.minNationAgeDays != null && nationAgeDays < message.minNationAgeDays) return { eligible: false, reason: `nation age ${nationAgeDays.toFixed(0)}d < min ${message.minNationAgeDays}d` };
  if (message.maxNationAgeDays != null && nationAgeDays > message.maxNationAgeDays) return { eligible: false, reason: `nation age ${nationAgeDays.toFixed(0)}d > max ${message.maxNationAgeDays}d` };
  if (message.minMembershipDays != null && membershipDays < message.minMembershipDays) return { eligible: false, reason: `membership ${membershipDays.toFixed(0)}d < min ${message.minMembershipDays}d` };
  if (message.maxMembershipDays != null && membershipDays > message.maxMembershipDays) return { eligible: false, reason: `membership ${membershipDays.toFixed(0)}d > max ${message.maxMembershipDays}d` };

  return { eligible: true };
}

/**
 * Given a nation and their campaign state, returns the next message they
 * should receive, or null if there's nothing appropriate.
 */
function getNextMessageForMember(campaignId, nation, memberState) {
  const messages = getMessagesForCampaign(campaignId);
  if (messages.length === 0) return null;

  const alreadySent = new Set(memberState?.messagesSent || []);
  const currentSeq = memberState?.currentSequence || 0;

  // Go through messages in sequence order, find the next one after currentSeq
  // that:
  // a) hasn't been sent yet
  // b) matches this nation's current eligibility
  for (const msg of messages) {
    if (msg.sequenceOrder <= currentSeq) continue; // already passed this in sequence
    if (alreadySent.has(msg.id)) continue;         // already sent this specific message
    const check = messageMatchesNation(msg, nation, memberState);
    if (check.eligible) return { message: msg, eligibilityReason: null };
  }

  return null;
}

module.exports = {
  isEngagementEnabled,
  setEngagementEnabled,
  createCampaign,
  getCampaign,
  getAllCampaigns,
  updateCampaign,
  deleteCampaign,
  setCampaignEnabled,
  setCampaignLastRunAt,
  addEngagementMessage,
  getEngagementMessage,
  getMessagesForCampaign,
  deleteEngagementMessage,
  updateEngagementMessage,
  getMemberState,
  initMemberState,
  updateMemberState,
  getAllMemberStatesForCampaign,
  logEngagementHistory,
  getEngagementHistory,
  messageMatchesNation,
  getNextMessageForMember,
  daysSince,
};
