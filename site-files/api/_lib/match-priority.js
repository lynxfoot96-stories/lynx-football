'use strict';
/**
 * Which matches get a "match details" page (lineups / events / stats / ratings).
 *
 * This is the real API-budget control: match.js refuses to call API-Football for
 * any match that was not picked here, so an unpicked match costs nothing.
 *
 * HOW IT WORKS
 *   TODAY (server UTC day):
 *     1. Go down MATCH_DETAIL_PRIORITY from the top. For each club, take its match(es)
 *        of the day. A club with no match is skipped -- no gap, the next club moves up.
 *     2. A match between two listed clubs is ONE match (it takes one slot, and the
 *        next club down fills the other).
 *     3. Stop at MATCH_DETAIL_DAILY_CAP matches.
 *     4. A picked match gets its link only once it is finished (FT / AET / PEN).
 *        Picks are made from the WHOLE day's fixtures, so they don't shuffle as
 *        results come in.
 *   OTHER DAYS (e.g. yesterday): same picks, but a match is clickable ONLY if it was
 *     already opened on its own day (its data is already cached). Nothing new is ever
 *     fetched for yesterday, so the 5-per-day cap can't be exceeded.
 *
 * TO EDIT: reorder / add / remove lines in MATCH_DETAIL_PRIORITY. The order IS the rank.
 *   Line format:  [ 'Club name', domesticLeagueId, ['other names the API may use'] ]
 *     domesticLeagueId: 39 Premier League, 140 La Liga, 135 Serie A, 78 Bundesliga,
 *       61 Ligue 1, 94 Primeira Liga, 71 Brasileirao, or 0 if the club's league isn't
 *       on the site. A club is matched in its own league + Champions/Europa League only
 *       (this keeps e.g. Vitoria of Portugal and Vitoria of Brazil apart).
 *     Names are matched exactly (ignoring accents, case, "FC"/"CF"/"AC"-style words),
 *       so "Inter" never matches "Inter Miami" and "Barcelona" never matches "Barcelona W".
 *       If a club never gets a link, check how the API spells it and add that name.
 */
const { cacheSet, cacheGet } = require('./cache');

const MATCH_DETAIL_DAILY_CAP = 5;

const MATCH_DETAIL_PRIORITY = [
  ['Barcelona', 140],
  ['Manchester City', 39],
  ['Arsenal', 39],
  ['Paris Saint-Germain', 61, ['Paris Saint Germain', 'Paris Saint-Germain', 'PSG']],
  ['Real Madrid', 140],
  ['Bayern Munich', 78, ['Bayern München', 'Bayern Munich']],
  ['Liverpool', 39],
  ['Chelsea', 39],
  ['Inter Milan', 135, ['Inter', 'Internazionale']],
  ['AC Milan', 135],
  ['Borussia Dortmund', 78, ['Borussia Dortmund']],
  ['Atlético Madrid', 140, ['Atletico Madrid']],
  ['Manchester United', 39, ['Manchester United', 'Man United']],
  ['Juventus', 135],
  ['Tottenham Hotspur', 39, ['Tottenham']],
  ['Bayer Leverkusen', 78],
  ['Aston Villa', 39],
  ['Newcastle United', 39, ['Newcastle']],
  ['S.L. Benfica', 94, ['Benfica']],
  ['Sporting CP', 94],
  ['FC Porto', 94],
  ['CR Flamengo', 71, ['Flamengo']],
  ['SC Corinthians', 71, ['Corinthians']],
  ['AS Roma', 135],
  ['SSC Napoli', 135, ['Napoli']],
  ['AFC Ajax', 0, ['Ajax']],
  ['Olympique de Marseille', 61, ['Marseille']],
  ['Galatasaray', 0],
  ['Fenerbahçe', 0, ['Fenerbahce']],
  ['SE Palmeiras', 71, ['Palmeiras']],
  ['São Paulo FC', 71, ['Sao Paulo']],
  ['SS Lazio', 135],
  ['Sevilla FC', 140, ['Sevilla']],
  ['Athletic Club', 140],
  ['West Ham United', 39, ['West Ham']],
  ['Celtic FC', 0, ['Celtic']],
  ['Rangers FC', 0, ['Rangers']],
  ['Eintracht Frankfurt', 78, ['Eintracht Frankfurt']],
  ['RB Leipzig', 78, ['RB Leipzig']],
  ['Olympique Lyonnais', 61, ['Lyon']],
  ['Beşiktaş', 0, ['Besiktas']],
  ['Feyenoord', 0],
  ['PSV Eindhoven', 0, ['PSV Eindhoven', 'PSV']],
  ['Real Sociedad', 140],
  ['Real Betis', 140],
  ['AS Monaco', 61, ['Monaco']],
  ['Brighton & Hove Albion', 39, ['Brighton']],
  ['Wolverhampton Wanderers', 39, ['Wolves', 'Wolverhampton']],
  ['Everton', 39],
  ['Atalanta', 135],
  ['ACF Fiorentina', 135, ['Fiorentina']],
  ['Bologna FC', 135, ['Bologna']],
  ['Villarreal CF', 140, ['Villarreal']],
  ['Valencia CF', 140, ['Valencia']],
  ['VfB Stuttgart', 78],
  ['CR Vasco da Gama', 71, ['Vasco DA Gama', 'Vasco da Gama']],
  ['Grêmio', 71, ['Gremio']],
  ['SC Internacional', 71, ['Internacional']],
  ['Fluminense FC', 71, ['Fluminense']],
  ['Clube Atlético Mineiro', 71, ['Atletico-MG', 'Atletico Mineiro']],
  ['Cruzeiro', 71],
  ['Botafogo', 71],
  ['LOSC Lille', 61, ['Lille']],
  ['Borussia Mönchengladbach', 78, ['Borussia Monchengladbach']],
  ['Werder Bremen', 78],
  ['SC Freiburg', 78, ['SC Freiburg', 'Freiburg']],
  ['Crystal Palace', 39],
  ['Fulham', 39],
  ['AFC Bournemouth', 39, ['Bournemouth']],
  ['Brentford', 39],
  ['Nottingham Forest', 39],
  ['Leicester City', 39, ['Leicester']],
  ['Girona FC', 140, ['Girona']],
  ['RC Celta de Vigo', 140, ['Celta Vigo']],
  ['CA Osasuna', 140, ['Osasuna']],
  ['RCD Mallorca', 140, ['Mallorca']],
  ['Rayo Vallecano', 140],
  ['Getafe CF', 140, ['Getafe']],
  ['RCD Espanyol', 140, ['Espanyol']],
  ['Torino FC', 135, ['Torino']],
  ['Genoa CFC', 135, ['Genoa']],
  ['Parma Calcio', 135, ['Parma']],
  ['Como 1907', 135, ['Como']],
  ['Cagliari Calcio', 135, ['Cagliari']],
  ['Udinese Calcio', 135, ['Udinese']],
  ['Hellas Verona', 135, ['Verona']],
  ['U.S. Lecce', 135, ['Lecce']],
  ['Empoli FC', 135, ['Empoli']],
  ['AC Monza', 135, ['Monza']],
  ['Venezia FC', 135, ['Venezia']],
  ['Union Berlin', 78],
  ['FC St. Pauli', 78, ['FC St. Pauli', 'St. Pauli']],
  ['VfL Wolfsburg', 78, ['Wolfsburg']],
  ['FC Augsburg', 78, ['Augsburg']],
  ['Mainz 05', 78, ['FSV Mainz 05', 'Mainz']],
  ['TSG Hoffenheim', 78, ['1899 Hoffenheim', 'Hoffenheim']],
  ['1. FC Heidenheim', 78, ['FC Heidenheim', 'Heidenheim']],
  ['VfL Bochum', 78, ['Bochum']],
  ['Holstein Kiel', 78],
  ['Stade Rennais', 61, ['Rennes']],
  ['RC Lens', 61, ['Lens']],
  ['OGC Nice', 61, ['Nice']],
  ['Saint-Étienne', 61, ['Saint-Etienne', 'St Etienne']],
  ['FC Nantes', 61, ['Nantes']],
  ['Stade de Reims', 61, ['Reims']],
  ['Montpellier HSC', 61, ['Montpellier']],
  ['RC Strasbourg', 61, ['Strasbourg']],
  ['Toulouse FC', 61, ['Toulouse']],
  ['Stade Brestois 29', 61, ['Brest']],
  ['AJ Auxerre', 61, ['Auxerre']],
  ['Angers SCO', 61, ['Angers']],
  ['Le Havre AC', 61, ['Le Havre']],
  ['S.C. Braga', 94, ['SC Braga', 'Braga']],
  ['Vitória S.C.', 94, ['Vitoria Guimaraes', 'Vitoria SC']],
  ['Boavista FC', 94, ['Boavista']],
  ['FC Famalicão', 94, ['Famalicao']],
  ['Rio Ave FC', 94, ['Rio Ave']],
  ['Gil Vicente FC', 94, ['Gil Vicente']],
  ['Estoril Praia', 94, ['Estoril']],
  ['Casa Pia AC', 94, ['Casa Pia']],
  ['Moreirense FC', 94, ['Moreirense']],
  ['Santa Clara', 94],
  ['Estrela da Amadora', 94, ['Estrela']],
  ['FC Arouca', 94, ['Arouca']],
  ['CD Nacional', 94, ['Nacional']],
  ['SC Farense', 94, ['Farense']],
  ['AVS Futebol SAD', 94, ['AVS']],
  ['Fortaleza EC', 71, ['Fortaleza']],
  ['Esporte Clube Bahia', 71, ['Bahia']],
  ['Athletico Paranaense', 71, ['Athletico-PR', 'Athletico Paranaense']],
  ['Red Bull Bragantino', 71, ['RB Bragantino', 'Bragantino']],
  ['Esporte Clube Vitória', 71, ['EC Vitoria', 'Vitoria']],
  ['Juventude', 71],
  ['Criciúma EC', 71, ['Criciuma']],
  ['Cuiabá EC', 71, ['Cuiaba']],
  ['Atlético Goianiense', 71, ['Atletico Goianiense']],
  ['Southampton', 39],
  ['Ipswich Town', 39, ['Ipswich']],
  ['Deportivo Alavés', 140, ['Alaves']],
  ['Real Valladolid', 140, ['Valladolid']],
  ['Olympiacos', 0],
  ['Shakhtar Donetsk', 0, ['Shakhtar Donetsk']],
  ['Dynamo Kyiv', 0, ['Dynamo Kyiv']],
  ['Club Brugge', 0],
  ['Red Star Belgrade', 0, ['Crvena Zvezda', 'Red Star Belgrade']],
  ['Dinamo Zagreb', 0],
  ['Red Bull Salzburg', 0, ['RB Salzburg', 'Salzburg']],
  ['Young Boys', 0],
  ['Sparta Prague', 0],
  ['Slavia Prague', 0],
  ['PAOK', 0],
  ['Anderlecht', 0],
  ['FC Twente', 0, ['Twente']],
  ['AZ Alkmaar', 0],
  ['Bodø/Glimt', 0, ['Bodo/Glimt', 'Bodo Glimt']],
  ['Union Saint-Gilloise', 0, ['Union St. Gilloise', 'Union Saint-Gilloise']],
  ['Midtjylland', 0, ['FC Midtjylland']],
  ['Malmö FF', 0, ['Malmo FF']],
  ['Ferencváros', 0, ['Ferencvaros']],
  ['FCSB', 0],
  ['Viktoria Plzeň', 0, ['Viktoria Plzen']],
  ['SK Sturm Graz', 0, ['Sturm Graz']],
  ['Slovan Bratislava', 0],
  ['Ludogorets Razgrad', 0, ['Ludogorets']],
  ['Qarabağ FK', 0, ['Qarabag']],
  ['Maccabi Tel Aviv', 0],
  ['Leganés', 140, ['Leganes']],
  ['Las Palmas', 140],
  ['IF Elfsborg', 0, ['Elfsborg']],
  ['FK RFS', 0, ['RFS']],
];

// ---- matching ----------------------------------------------------------------
const UEFA_LEAGUES = [2, 3]; // Champions League, Europa League
const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ss', 'ssc', 'us', 'sk', 'fk', 'cd', 'rc', 'rcd', 'ca', 'ec', 'sad', 'calcio', 'club', 'clube', 'de', 'da', 'do']);

function key(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(w => w && !STOP.has(w)).join(' ');
}

const ENTRIES = MATCH_DETAIL_PRIORITY.map(([name, league, extra]) => ({
  keys: new Set([name].concat(extra || []).map(key).filter(Boolean)),
  leagues: new Set((league ? [league] : []).concat(UEFA_LEAGUES)),
}));

function teamMatches(entry, team, leagueId) {
  return !!team && entry.leagues.has(leagueId) && entry.keys.has(key(team.name));
}

// A link is shown only for matches that were really played and are over.
// (PST/CANC/ABD/AWD/WO count as "finished" elsewhere but have no lineups/stats worth
// spending calls on, and they must not occupy one of the slots either.)
const LINKABLE_STATUSES = new Set(['FT', 'AET', 'PEN']);
const NO_DATA_STATUSES = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

/** Returns a Set of fixture ids of the day's picks that are finished (link-eligible). */
function selectDetailLinks(fixtures) {
  const candidates = (fixtures || [])
    .filter(f => f && !NO_DATA_STATUSES.has(f.statusShort))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const picked = [];
  for (const entry of ENTRIES) {
    for (const f of candidates) {
      if (picked.length >= MATCH_DETAIL_DAILY_CAP) break;
      if (picked.indexOf(f.id) !== -1) continue; // both clubs listed -> still ONE match
      const lid = f.league && f.league.id;
      if (teamMatches(entry, f.home, lid) || teamMatches(entry, f.away, lid)) picked.push(f.id);
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
const summaryKey = id => `summary:${id}`; // same key match.js caches the summary under
const markedThisInstance = new Set();     // one instance writes each id to Redis only once

async function allowDetails(ids) {
  for (const id of ids) {
    if (markedThisInstance.has(id)) continue;
    markedThisInstance.add(id);
    try { await cacheSet(allowKey(id), 1, ALLOW_TTL_SECONDS); } catch (e) { markedThisInstance.delete(id); }
  }
}

/** Of these ids, the ones whose match was already opened (summary cached) -- costs nothing. */
async function filterAlreadyOpened(ids) {
  const out = new Set();
  for (const id of ids) {
    if ((await cacheGet(summaryKey(id))) !== null) out.add(id);
  }
  return out;
}

/** May match.js call the API for this match? Only if it was picked today, or already opened. */
async function detailsAllowed(id) {
  if ((await cacheGet(allowKey(id))) !== null) return true;
  return (await cacheGet(summaryKey(id))) !== null;
}

module.exports = {
  MATCH_DETAIL_PRIORITY, MATCH_DETAIL_DAILY_CAP,
  selectDetailLinks, allowDetails, filterAlreadyOpened, detailsAllowed,
};
