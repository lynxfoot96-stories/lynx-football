'use strict';
/**
 * Which matches get a "match details" page (lineups / events / stats / ratings).
 *
 * This is the real API-budget control: match.js refuses to call API-Football for
 * any match that was not picked here, so an unpicked match costs nothing.
 *
 * HOW IT WORKS (once per day, per scores list):
 *   1. Go down MATCH_DETAIL_PRIORITY from the top.
 *   2. For each entry, take that team's match(es) of the day.
 *      An entry whose team isn't playing is skipped -- no gap is left, the next
 *      entry simply moves up.
 *   3. Stop at MATCH_DETAIL_DAILY_CAP matches.
 *   4. A picked match only gets its link once it is actually finished (FT/AET/PEN).
 *      Picks are made from the WHOLE day's fixtures, not only the finished ones, so
 *      they don't shuffle as results come in (a late Barcelona game still outranks an
 *      early Liverpool game).
 *
 * TO EDIT: just reorder / add / remove lines in MATCH_DETAIL_PRIORITY.
 *   ids      = API-Football team ids (most reliable)
 *   aliases  = exact team names, lower-case (fallback if an id is wrong/missing).
 *              Exact match on purpose: "inter" must not match "Inter Miami".
 */
const { cacheSet, cacheGet } = require('./cache');

const MATCH_DETAIL_DAILY_CAP = 5;

const MATCH_DETAIL_PRIORITY = [
  { name: 'Barcelona',         ids: [529], aliases: ['barcelona', 'fc barcelona'] },
  { name: 'Manchester City',   ids: [50],  aliases: ['manchester city'] },
  { name: 'Arsenal',           ids: [42],  aliases: ['arsenal'] },
  { name: 'PSG',               ids: [85],  aliases: ['paris saint germain', 'paris saint-germain', 'psg'] },
  { name: 'Real Madrid',       ids: [541], aliases: ['real madrid'] },
  { name: 'Bayern',            ids: [157], aliases: ['bayern munich', 'bayern münchen', 'bayern munchen', 'fc bayern münchen'] },
  { name: 'Liverpool',         ids: [40],  aliases: ['liverpool'] },
  { name: 'Chelsea',           ids: [49],  aliases: ['chelsea'] },
  { name: 'Inter',             ids: [505], aliases: ['inter', 'inter milan', 'internazionale'] },
  { name: 'AC Milan',          ids: [489], aliases: ['ac milan'] },
  { name: 'Borussia Dortmund', ids: [165], aliases: ['borussia dortmund'] },
  { name: 'Atletico Madrid',   ids: [530], aliases: ['atletico madrid', 'atlético madrid'] },
];

// A link is shown only for matches that were really played and are over.
// (PST/CANC/ABD/AWD/WO are "finished" for scoring purposes but have no lineups/stats
// worth spending 4-5 calls on, and they must not occupy one of the 5 slots either.)
const LINKABLE_STATUSES = new Set(['FT', 'AET', 'PEN']);
const NO_DATA_STATUSES = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

function teamMatches(entry, team) {
  if (!team) return false;
  if (team.id != null && entry.ids.indexOf(team.id) !== -1) return true;
  const n = String(team.name || '').trim().toLowerCase();
  return entry.aliases.indexOf(n) !== -1;
}

/** Returns a Set of fixture ids that should get a details link right now. */
function selectDetailLinks(fixtures) {
  const candidates = (fixtures || [])
    .filter(f => f && !NO_DATA_STATUSES.has(f.statusShort))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const picked = [];
  for (const entry of MATCH_DETAIL_PRIORITY) {
    for (const f of candidates) {
      if (picked.length >= MATCH_DETAIL_DAILY_CAP) break;
      if (picked.indexOf(f.id) !== -1) continue; // e.g. Barcelona v Man City fills only ONE slot
      if (teamMatches(entry, f.home) || teamMatches(entry, f.away)) picked.push(f.id);
    }
    if (picked.length >= MATCH_DETAIL_DAILY_CAP) break;
  }

  const linkable = new Set();
  for (const f of candidates) {
    if (picked.indexOf(f.id) !== -1 && LINKABLE_STATUSES.has(f.statusShort)) linkable.add(f.id);
  }
  return linkable;
}

// ---- shared "allowed" marks (scores.js writes, match.js reads) ---------------
const ALLOW_TTL_SECONDS = 36 * 60 * 60;
const allowKey = id => `detail-ok:${id}`;
const markedThisInstance = new Set(); // so one instance writes each id to Redis only once

async function allowDetails(ids) {
  for (const id of ids) {
    if (markedThisInstance.has(id)) continue;
    markedThisInstance.add(id);
    try { await cacheSet(allowKey(id), 1, ALLOW_TTL_SECONDS); } catch (e) { markedThisInstance.delete(id); }
  }
}

async function detailsAllowed(id) {
  return (await cacheGet(allowKey(id))) !== null;
}

module.exports = {
  MATCH_DETAIL_PRIORITY, MATCH_DETAIL_DAILY_CAP,
  selectDetailLinks, allowDetails, detailsAllowed,
};
