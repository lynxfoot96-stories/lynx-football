'use strict';
/**
 * The 8 competitions supported by the Top Scorers / Top Assists feature.
 * Kept in one place so IDs aren't scattered across files. This is intentionally
 * a NEW, separate list from the LEAGUES map already hardcoded in scores.js and
 * the LEAGUE_ID_TO_FD_CODE map in standings.js -- those two are untouched, per
 * "don't modify existing functionality unless necessary". If you ever want to
 * consolidate all three into one shared source later, this file is the
 * natural place to grow into that, but that's a separate, deliberate change.
 */
module.exports = [
  { id: 39,  name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78,  name: 'Bundesliga' },
  { id: 61,  name: 'Ligue 1' },
  { id: 2,   name: 'UEFA Champions League' },
  { id: 94,  name: 'Primeira Liga' },
  { id: 71,  name: 'Brasileirão Série A' },
];
