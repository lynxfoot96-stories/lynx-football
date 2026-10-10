/*
 * news-topics.js — decides which clubs / leagues a news story is "about".
 *
 * HOW IT WORKS
 *   Every story's title + summary + category is searched for the aliases below
 *   (club names, nicknames, managers, star players, league names).
 *   A club hit  -> the story belongs to that club AND to that club's league.
 *   A club with ucl:true also puts the story in the Champions League (2).
 *   A league-name hit (e.g. "Premier League") -> that league.
 *   One story can belong to several clubs/leagues (e.g. "Real Madrid target McTominay
 *   as Napoli talks stall" -> Real Madrid, Napoli, La Liga, Serie A, Champions League).
 *
 * TO MAINTAIN: add a name to an `aliases` string (regex pieces separated by |, lowercase,
 * no accents) or add a new line to CLUBS. Player lists go stale after transfers — edit them
 * here, nowhere else. `ucl:true` = club plays in the 2026-27 Champions League league phase.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FSTopics = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var LEAGUES = {
    39:  { name: 'Premier League',        aliases: 'premier league|\\bepl\\b' },
    140: { name: 'La Liga',               aliases: 'la ?liga|spanish league' },
    135: { name: 'Serie A',               aliases: 'serie a|italian league' },
    78:  { name: 'Bundesliga',            aliases: 'bundesliga|german league' },
    61:  { name: 'Ligue 1',               aliases: 'ligue ?1|french league' },
    2:   { name: 'Champions League',      aliases: 'champions league|\\bucl\\b|european cup' },
    94:  { name: 'Primeira Liga',         aliases: 'primeira liga|liga portugal|portuguese league' },
    71:  { name: 'Brasileirão Série A',   aliases: 'brasileirao|brazilian league|campeonato brasileiro' }
  };

  // [slug, display name, league id, plays in Champions League 2026-27, aliases]
  var CLUBS = [
    // ---- Premier League
    ['arsenal',        'Arsenal',             39, true,  'arsenal|gunners|arteta|bukayo saka|\\bsaka\\b|odegaard|declan rice|saliba|gyokeres|emirates stadium'],
    ['man-city',       'Manchester City',     39, true,  'manchester city|man city|guardiola|haaland|phil foden|etihad|\\bcity(?:\'s)? (?:guilty|breach\\w*|verdict|charges|financial|case|titles?|owners)'],
    ['liverpool',      'Liverpool',           39, true,  'liverpool|arne slot|salah|van dijk|szoboszlai|anfield|wirtz|florian wirtz|alexander isak|\\bisak\\b'],
    ['man-united',     'Manchester United',   39, true,  'manchester united|man utd|man united|old trafford|bruno fernandes|amorim|mbeumo|sesko'],
    ['aston-villa',    'Aston Villa',         39, true,  'aston villa|unai emery|villa park|ollie watkins'],
    ['chelsea',        'Chelsea',             39, false, 'chelsea|maresca|cole palmer|stamford bridge'],
    ['tottenham',      'Tottenham',           39, false, 'tottenham|spurs|\\bthfc\\b'],
    ['newcastle',      'Newcastle United',    39, false, 'newcastle|eddie howe|st james.? park'],
    // ---- La Liga
    ['real-madrid',    'Real Madrid',        140, true,  'real madrid|los blancos|bernabeu|vinicius|rodrygo|mbappe|bellingham|valverde|endrick|courtois|camavinga|tchouameni|carlo ancelotti'],
    ['barcelona',      'FC Barcelona',       140, true,  'barcelona|\\bbarca\\b|hansi flick|lamine yamal|\\byamal\\b|raphinha|pedri|lewandowski|camp nou|ter stegen'],
    ['atletico-madrid','Atlético Madrid',    140, true,  'atletico|simeone|julian alvarez|griezmann|oblak|metropolitano'],
    ['villarreal',     'Villarreal',         140, true,  'villarreal'],
    ['real-betis',     'Real Betis',         140, true,  'real betis|\\bbetis\\b'],
    ['sevilla',        'Sevilla',            140, false, 'sevilla'],
    ['athletic-club',  'Athletic Club',      140, false, 'athletic club|athletic bilbao|nico williams'],
    // ---- Serie A
    ['inter',          'Inter Milan',        135, true,  'inter(?! miami)(?:nazionale| milan)?\\b|lautaro|chivu|barella'],
    ['ac-milan',       'AC Milan',           135, false, 'ac milan|rossoneri|allegri|rafael leao|\\bleao\\b|pulisic'],
    ['juventus',       'Juventus',           135, false, 'juventus|\\bjuve\\b|vlahovic|kenan yildiz'],
    ['napoli',         'Napoli',             135, true,  'napoli|mctominay|de bruyne|antonio conte'],
    ['roma',           'AS Roma',            135, true,  'as roma|giallorossi|dybala|gasperini'],
    ['como',           'Como',               135, true,  'como 1907|cesc fabregas|nico paz'],
    ['atalanta',       'Atalanta',           135, false, 'atalanta'],
    ['lazio',          'Lazio',              135, false, 'lazio'],
    // ---- Bundesliga
    ['bayern-munich',  'Bayern Munich',       78, true,  'bayern|kompany|harry kane|\\bkane\\b|musiala|michael olise|\\bolise\\b|neuer|luis diaz|allianz arena'],
    ['dortmund',       'Borussia Dortmund',   78, true,  'dortmund|\\bbvb\\b'],
    ['leipzig',        'RB Leipzig',          78, true,  'leipzig'],
    ['stuttgart',      'VfB Stuttgart',       78, true,  'stuttgart'],
    ['leverkusen',     'Bayer Leverkusen',    78, false, 'leverkusen'],
    ['frankfurt',      'Eintracht Frankfurt', 78, false, 'eintracht|frankfurt'],
    // ---- Ligue 1
    ['psg',            'Paris Saint-Germain', 61, true,  'paris saint.germain|\\bpsg\\b|luis enrique|dembele|barcola|vitinha|donnarumma|hakimi|kvaratskhelia|joao neves|parc des princes'],
    ['lille',          'Lille',               61, true,  'lille|\\blosc\\b'],
    ['lens',           'RC Lens',             61, true,  'rc lens|racing club de lens'],
    ['marseille',      'Marseille',           61, false, 'marseille|de zerbi'],
    ['lyon',           'Lyon',                61, false, 'olympique lyonnais|\\blyon\\b'],
    ['monaco',         'AS Monaco',           61, false, 'as monaco'],
    // ---- Primeira Liga
    ['porto',          'FC Porto',            94, true,  'fc porto|\\bporto\\b'],
    ['sporting-cp',    'Sporting CP',         94, true,  'sporting cp|sporting lisbon|sporting clube'],
    ['benfica',        'Benfica',             94, false, 'benfica'],
    ['braga',          'SC Braga',            94, false, 'sc braga'],
    // ---- Brasileirão
    ['flamengo',       'Flamengo',            71, false, 'flamengo'],
    ['palmeiras',      'Palmeiras',           71, false, 'palmeiras'],
    ['corinthians',    'Corinthians',         71, false, 'corinthians'],
    ['santos',         'Santos',              71, false, 'santos fc|neymar'],
    // ---- Champions League regulars outside the 8 leagues (tagged UCL only)
    ['psv',            'PSV Eindhoven',        0, true,  'psv eindhoven|\\bpsv\\b'],
    ['feyenoord',      'Feyenoord',            0, true,  'feyenoord'],
    ['club-brugge',    'Club Brugge',          0, true,  'club brugge'],
    ['galatasaray',    'Galatasaray',          0, true,  'galatasaray'],
    ['shakhtar',       'Shakhtar Donetsk',     0, true,  'shakhtar'],
    ['slavia-praha',   'Slavia Praha',         0, true,  'slavia praha|slavia prague']
  ].map(function (c) {
    return { slug: c[0], name: c[1], league: c[2], ucl: c[3], re: new RegExp('(?:^|[^a-z0-9])(?:' + c[4] + ')(?![a-z0-9])') };
  });

  var LEAGUE_RE = {};
  Object.keys(LEAGUES).forEach(function (id) {
    LEAGUE_RE[id] = new RegExp('(?:^|[^a-z0-9])(?:' + LEAGUES[id].aliases + ')(?![a-z0-9])');
  });

  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase().replace(/[‘’ʼ]/g, "'");
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/brasileirao serie a/g, 'brasileirao');
  }

  /** article: {title, dek, cat}  ->  {clubs:[slug], leagues:[id]} */
  function tag(article) {
    var text = norm([article.title, article.dek, article.cat].join(' . '));
    var clubs = [], leagues = {};
    CLUBS.forEach(function (c) {
      if (!c.re.test(text)) return;
      clubs.push(c.slug);
      if (c.league) leagues[c.league] = 1;
      if (c.ucl) leagues[2] = 1;
    });
    Object.keys(LEAGUE_RE).forEach(function (id) { if (LEAGUE_RE[id].test(text)) leagues[id] = 1; });
    return { clubs: clubs, leagues: Object.keys(leagues).map(Number) };
  }

  /** spec: {club:'real-madrid'} or {league:140} */
  function matches(tags, spec) {
    if (!tags || !spec) return false;
    if (spec.club) return tags.clubs.indexOf(spec.club) !== -1;
    if (spec.league != null) return tags.leagues.indexOf(Number(spec.league)) !== -1;
    return false;
  }

  function clubName(slug) {
    for (var i = 0; i < CLUBS.length; i++) if (CLUBS[i].slug === slug) return CLUBS[i].name;
    return slug;
  }

  return { LEAGUES: LEAGUES, CLUBS: CLUBS, tag: tag, matches: matches, clubName: clubName };
});
