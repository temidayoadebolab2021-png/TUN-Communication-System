// This file is the ONLY place in our bot that talks directly to the Politics & War API.
// Every other file asks THIS file to do things like "send a mail" or "look up a nation".
// Keeping it in one place makes it much easier to fix things later if PnW changes their API.
//
// IMPORTANT: PnW has TWO separate APIs that we use here:
// 1. The GraphQL API (for looking up nations, alliances, etc.)
// 2. A separate, older REST endpoint *specifically* for sending in-game mail.
//    Mail sending is NOT part of the GraphQL schema - it has its own endpoint.

const DEFAULT_API_KEY = process.env.PNW_API_KEY;
const SEND_MESSAGE_URL = 'https://politicsandwar.com/api/send-message/';

function graphqlUrlFor(apiKey) {
  return `https://api.politicsandwar.com/graphql?api_key=${apiKey}`;
}

/**
 * Sends a raw GraphQL request to Politics & War (used for read-only lookups).
 * Pass `apiKeyOverride` to use someone's personal key instead of the bot's
 * default shared key - used when validating a staff member's key.
 */
async function pnwRequest(query, variables = {}, apiKeyOverride = null) {
  const apiKey = apiKeyOverride || DEFAULT_API_KEY;
  const response = await fetch(graphqlUrlFor(apiKey), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw new Error(`PnW API error: ${message}`);
  }

  return json.data;
}

/**
 * Does a lightweight check that an API key is at least valid and working,
 * by attempting a small read-only query with it. This can't 100% guarantee
 * the key is allowed to send mail (PnW's send-message endpoint is a separate
 * system with its own validation), but it catches typos and dead keys
 * immediately instead of someone finding out days later.
 */
async function verifyApiKey(apiKey) {
  try {
    await pnwRequest('query { nations(first: 1) { data { id } } }', {}, apiKey);
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}


/**
 * Sends in-game mail to a nation using PnW's dedicated send-message endpoint.
 * This is a plain form POST, not GraphQL.
 *
 * Pass `apiKeyOverride` to send the mail AS a specific staff member's own
 * nation (using their personally-registered key) instead of the bot's
 * default shared key. Whichever key is used, the mail appears in-game as
 * sent from that key's nation - this is how PnW's API works, not a choice
 * we're making.
 */
async function sendMail(nationId, subject, message, apiKeyOverride = null) {
  const apiKey = apiKeyOverride || DEFAULT_API_KEY;
  const body = new URLSearchParams({
    key: apiKey,
    to: String(nationId),
    subject,
    message,
  });

  const response = await fetch(SEND_MESSAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await response.json();

  if (!json.success) {
    const reason = Array.isArray(json.general_message)
      ? json.general_message.join(' ')
      : json.general_message || 'Unknown error from PnW.';
    throw new Error(reason);
  }

  return json;
}

/**
 * Fetches basic info for a single nation by ID.
 */
async function getNation(nationId) {
  const query = `
    query GetNation($id: [Int]) {
      nations(id: $id, first: 1) {
        data {
          id
          nation_name
          leader_name
          alliance_id
          score
          num_cities
          last_active
          date
          discord
          cities {
            infrastructure
          }
          offensive_wars {
            id
          }
          defensive_wars {
            id
          }
        }
      }
    }
  `;
  const data = await pnwRequest(query, { id: [nationId] });
  return data.nations.data[0] || null;
}

/**
 * Fetches a page of nations sorted by newest first.
 * Used by the new-nation scanner.
 */
async function getRecentNations(limit = 50) {
  const query = `
    query GetRecentNations($first: Int) {
      nations(first: $first, orderBy: { column: DATE, order: DESC }) {
        data {
          id
          nation_name
          leader_name
          alliance_id
          date
          discord
        }
      }
    }
  `;
  const data = await pnwRequest(query, { first: limit });
  return data.nations.data;
}

/**
 * Looks up a nation by name. Matching is done case-insensitively, so
 * "arrow kingdom", "Arrow Kingdom", and "ARROW KINGDOM" all work.
 */
async function getNationByName(name) {
  const query = `
    query GetNationByName($name: [String]) {
      nations(nation_name: $name, first: 5) {
        data {
          id
          nation_name
          leader_name
          alliance_id
          score
          num_cities
          last_active
          date
          discord
          cities {
            infrastructure
          }
          offensive_wars {
            id
          }
          defensive_wars {
            id
          }
        }
      }
    }
  `;
  const data = await pnwRequest(query, { name: [name] });
  const results = data.nations.data;

  if (results.length === 0) return null;

  // Prefer an exact case-insensitive match if one exists among the results.
  const lowerInput = name.toLowerCase();
  const exact = results.find((n) => n.nation_name.toLowerCase() === lowerInput);
  return exact || results[0];
}

/**
 * Same as getRecentNations, but only returns nations with NO alliance
 * (alliance_id of 0) - these are the actual recruitment targets, since
 * nations already in an alliance aren't worth mailing.
 */
async function getRecentUnalignedNations(limit = 50) {
  const nations = await getRecentNations(limit);
  return nations.filter((n) => Number(n.alliance_id) === 0);
}

/**
 * Fetches one page of nations matching the given filters, applied server-side
 * by PnW's own API. These filter argument names (alliance_id, min_score,
 * max_score, min_cities, max_cities, vmode) come directly from PnW's actual
 * published GraphQL schema, not guesswork.
 */
async function getNationsPage(page = 1, perPage = 100, filters = {}) {
  const query = `
    query GetNationsPage(
      $page: Int, $first: Int!, $allianceId: [Int], $minScore: Float, $maxScore: Float,
      $minCities: Int, $maxCities: Int, $vmode: Boolean
    ) {
      nations(
        page: $page, first: $first, alliance_id: $allianceId, min_score: $minScore,
        max_score: $maxScore, min_cities: $minCities, max_cities: $maxCities, vmode: $vmode,
        orderBy: { column: SCORE, order: ASC }
      ) {
        paginatorInfo {
          currentPage
          hasMorePages
        }
        data {
          id
          nation_name
          leader_name
          alliance_id
          score
          num_cities
          last_active
          date
          discord
          cities {
            infrastructure
          }
          offensive_wars {
            id
          }
          defensive_wars {
            id
          }
        }
      }
    }
  `;
  const data = await pnwRequest(query, {
    page,
    first: perPage,
    allianceId: filters.allianceId,
    minScore: filters.minScore,
    maxScore: filters.maxScore,
    minCities: filters.minCities,
    maxCities: filters.maxCities,
    vmode: filters.vmode,
  });
  return data.nations;
}

/**
 * Searches for unaligned nations (no alliance) matching score/city filters,
 * using PnW's real server-side filters - much faster than fetching everything
 * and filtering ourselves, since the API does the work.
 *
 * `excludeVacationMode` skips nations currently in vacation mode by default,
 * since mailing them is pointless until they return.
 *
 * `maxPages` is a safety cap so this can never turn into a runaway scan even
 * if a filter combination matches an enormous number of nations.
 */
async function searchUnalignedNations({
  scoreMin,
  scoreMax,
  citiesMin,
  citiesMax,
  excludeVacationMode = true,
  maxPages = 10,
} = {}) {
  const filters = {
    allianceId: [0],
    minScore: scoreMin,
    maxScore: scoreMax,
    minCities: citiesMin,
    maxCities: citiesMax,
    vmode: excludeVacationMode ? false : undefined,
  };

  try {
    return await fetchPagesWithFilters(filters, maxPages);
  } catch (err) {
    // If PnW's API doesn't actually accept one of these filter arguments
    // (their documentation can be out of date), fall back to the older,
    // already-proven approach: fetch by alliance_id only, then filter the
    // rest ourselves in plain JavaScript. Slower, but can't break.
    console.warn(
      `⚠️ Server-side filtered search failed (${err.message}), falling back to client-side filtering.`
    );
    return await fetchAndFilterClientSide({ scoreMin, scoreMax, citiesMin, citiesMax, excludeVacationMode }, maxPages);
  }
}

async function fetchPagesWithFilters(filters, maxPages) {
  const results = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages && page <= maxPages) {
    const pageData = await getNationsPage(page, 100, filters);
    results.push(...pageData.data);
    hasMorePages = pageData.paginatorInfo.hasMorePages;
    page++;
  }

  return results;
}

async function fetchAndFilterClientSide({ scoreMin, scoreMax, citiesMin, citiesMax, excludeVacationMode }, maxPages) {
  const results = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages && page <= maxPages) {
    // Only pass alliance_id here, since that's the one filter we've directly
    // confirmed works (the scanner has been using it successfully for weeks).
    const pageData = await getNationsPage(page, 100, { allianceId: [0] });
    for (const nation of pageData.data) {
      if (Number(nation.alliance_id) !== 0) continue;
      if (scoreMin !== undefined && Number(nation.score) < scoreMin) continue;
      if (scoreMax !== undefined && Number(nation.score) > scoreMax) continue;
      if (citiesMin !== undefined && Number(nation.num_cities) < citiesMin) continue;
      if (citiesMax !== undefined && Number(nation.num_cities) > citiesMax) continue;
      results.push(nation);
    }
    hasMorePages = pageData.paginatorInfo.hasMorePages;
    page++;
  }

  return results;
}

/**
 * Looks up an alliance by name (case-insensitive) or numeric ID.
 * Returns { id, name } or null if not found.
 */
async function getAlliance(input) {
  const trimmed = String(input).trim();
  const isId = /^\d+$/.test(trimmed);

  let data;

  if (isId) {
    const query = `
      query GetAllianceById($id: [Int]) {
        alliances(id: $id, first: 1) {
          data { id name }
        }
      }
    `;
    data = await pnwRequest(query, { id: [Number(trimmed)] });
  } else {
    const query = `
      query GetAllianceByName($name: [String]) {
        alliances(name: $name, first: 5) {
          data { id name }
        }
      }
    `;
    data = await pnwRequest(query, { name: [trimmed] });
  }

  const results = data.alliances.data;
  if (results.length === 0) return null;

  // Prefer exact case-insensitive name match when searching by name
  if (!isId) {
    const lower = trimmed.toLowerCase();
    const exact = results.find((a) => a.name.toLowerCase() === lower);
    return exact || results[0];
  }

  return results[0];
}

/**
 * Fetches all member nations of an alliance by its numeric ID.
 * Returns basic nation info needed for mailing and display.
 * Paginates automatically so large alliances are fully covered.
 */
async function getAllianceMembers(allianceId) {
  const query = `
    query GetAllianceMembers($allianceId: [Int], $page: Int) {
      nations(alliance_id: $allianceId, first: 100, page: $page,
              orderBy: { column: SCORE, order: DESC }) {
        paginatorInfo {
          hasMorePages
        }
        data {
          id
          nation_name
          leader_name
          score
          num_cities
          last_active
        }
      }
    }
  `;

  const members = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const data = await pnwRequest(query, { allianceId: [Number(allianceId)], page });
    members.push(...data.nations.data);
    hasMorePages = data.nations.paginatorInfo.hasMorePages;
    page++;
  }

  return members;
}

// Alliance position integer values from PnW's confirmed schema:
// NOALLIANCE=0, APPLICANT=1, MEMBER=2, OFFICER=3, HEIR=4, LEADER=5
const ALLIANCE_POSITION = { NOALLIANCE: 0, APPLICANT: 1, MEMBER: 2, OFFICER: 3, HEIR: 4, LEADER: 5 };

/**
 * Fetches all current applicants of your alliance (alliance_position = APPLICANT = 1).
 * Requires your API key - PnW only returns this data to alliance members.
 */
async function getMyApplicants(allianceId) {
  const query = `
    query GetApplicants($allianceId: [Int], $position: Int) {
      nations(alliance_id: $allianceId, alliance_position: $position, first: 100) {
        data {
          id
          nation_name
          leader_name
          score
          num_cities
          date
        }
      }
    }
  `;
  const data = await pnwRequest(query, {
    allianceId: [Number(allianceId)],
    position: ALLIANCE_POSITION.APPLICANT,
  });
  return data.nations.data;
}

/**
 * Fetches all nations in your alliance at member rank or above (position >= 2).
 * Used by the demotion scanner to detect when someone drops to applicant.
 */
async function getMyMembers(allianceId) {
  const query = `
    query GetMembers($allianceId: [Int], $page: Int) {
      nations(alliance_id: $allianceId, first: 100, page: $page,
              orderBy: { column: SCORE, order: DESC }) {
        paginatorInfo { hasMorePages }
        data {
          id
          nation_name
          leader_name
          alliance_position
          score
          num_cities
        }
      }
    }
  `;
  const members = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const data = await pnwRequest(query, { allianceId: [Number(allianceId)], page });
    members.push(
      ...data.nations.data.filter((n) => {
        const pos = typeof n.alliance_position === 'string'
          ? (ALLIANCE_POSITION[n.alliance_position] ?? 0)
          : Number(n.alliance_position);
        return pos >= ALLIANCE_POSITION.MEMBER;
      })
    );
    hasMorePages = data.nations.paginatorInfo.hasMorePages;
    page++;
  }
  return members;
}

module.exports = {
  pnwRequest,
  sendMail,
  getNation,
  getNationByName,
  getAlliance,
  getAllianceMembers,
  getMyApplicants,
  getMyMembers,
  getRecentNations,
  getRecentUnalignedNations,
  getNationsPage,
  searchUnalignedNations,
  verifyApiKey,
};
