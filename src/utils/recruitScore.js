// Recruit Scoring System (Module 16 from the original spec).
// Scores a nation from 0-100 based on how promising a recruit they look like,
// using only data PnW's API actually gives us: activity, city count,
// infrastructure, war activity, and nation age.
//
// This is a heuristic, not a guarantee - it's meant to help you triage a long
// list of candidates, not replace judgment.

function hoursSince(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60);
}

function daysSince(isoString) {
  if (!isoString) return 0;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Scores how recently active the nation is. Active nations are far more
 * likely to actually read and respond to recruitment mail.
 * Max 35 points.
 */
function scoreActivity(nation) {
  const hours = hoursSince(nation.last_active);
  if (hours <= 24) return 35;
  if (hours <= 72) return 25;
  if (hours <= 168) return 12;
  return 0;
}

/**
 * Scores city count - more cities generally means a more invested, serious
 * player worth recruiting. Max 25 points.
 */
function scoreCities(nation) {
  const cities = Number(nation.num_cities) || 0;
  return Math.min(cities, 15) * (25 / 15);
}

/**
 * Scores average infrastructure per city - higher infrastructure suggests
 * an active, developing nation rather than an abandoned one. Max 20 points.
 */
function scoreInfrastructure(nation) {
  if (!Array.isArray(nation.cities) || nation.cities.length === 0) return 0;
  const totalInfra = nation.cities.reduce((sum, c) => sum + (Number(c.infrastructure) || 0), 0);
  const avgInfra = totalInfra / nation.cities.length;
  return Math.min(avgInfra / 1000, 1) * 20; // 1000+ avg infra per city = full marks
}

/**
 * Scores nation age - brand new nations (under 2 days) haven't proven
 * they'll stick around yet, and very old unaligned nations may be set in
 * their ways. A "sweet spot" of established-but-still-searching gets the
 * most points. Max 12 points.
 */
function scoreAge(nation) {
  const days = daysSince(nation.date);
  if (days < 2) return 4; // too new to know yet
  if (days <= 180) return 12; // sweet spot - settled in, still unaligned
  return 6; // long-term unaligned, lower but not zero
}

/**
 * Scores war activity - any recent war involvement suggests an engaged,
 * active player (as opposed to someone who logged in once and vanished).
 * Max 8 points.
 */
function scoreWarActivity(nation) {
  const offensive = Array.isArray(nation.offensive_wars) ? nation.offensive_wars.length : 0;
  const defensive = Array.isArray(nation.defensive_wars) ? nation.defensive_wars.length : 0;
  return offensive + defensive > 0 ? 8 : 0;
}

/**
 * Combines all factors into a single 0-100 score, plus a human-readable tier
 * and a breakdown so staff can see WHY a nation scored the way it did.
 */
function calculateRecruitScore(nation) {
  const breakdown = {
    activity: Math.round(scoreActivity(nation)),
    cities: Math.round(scoreCities(nation)),
    infrastructure: Math.round(scoreInfrastructure(nation)),
    age: Math.round(scoreAge(nation)),
    warActivity: Math.round(scoreWarActivity(nation)),
  };

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  let tier;
  if (total >= 60) tier = 'High';
  else if (total >= 35) tier = 'Medium';
  else tier = 'Low';

  return { total: Math.round(total), tier, breakdown };
}

module.exports = { calculateRecruitScore };
