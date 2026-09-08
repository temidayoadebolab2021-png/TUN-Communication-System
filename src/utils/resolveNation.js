// Lets staff type a nation ID, a nation name (any capitalization), or a full
// politicsandwar.com profile link into a single text field, and figures out
// which nation they mean.

const pnw = require('../pnwApi');

/**
 * Pulls a numeric nation ID out of a PnW profile URL, e.g.
 * "https://politicsandwar.com/nation/id=12345" -> 12345
 */
function extractIdFromUrl(text) {
  const match = text.match(/nation\/id=(\d+)/i);
  return match ? Number(match[1]) : null;
}

/**
 * Takes whatever the user typed (ID, name, or link) and returns the matching
 * nation object from the PnW API, or null if nothing was found.
 */
async function resolveNation(input) {
  const trimmed = input.trim();

  // Case 1: plain number -> treat as nation ID directly.
  if (/^\d+$/.test(trimmed)) {
    return pnw.getNation(Number(trimmed));
  }

  // Case 2: a profile link -> pull the ID out of it.
  const idFromUrl = extractIdFromUrl(trimmed);
  if (idFromUrl) {
    return pnw.getNation(idFromUrl);
  }

  // Case 3: treat it as a nation name and search (case-insensitive).
  return pnw.getNationByName(trimmed);
}

module.exports = { resolveNation, extractIdFromUrl };
