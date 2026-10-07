'use strict';
/**
 * Config for the SECOND, independent automated news pipeline (OpenRouter).
 * Deliberately a separate file from config.js (the Groq pipeline's config) so
 * you can tune feeds/limits/style for this pipeline without touching the other
 * one. Right now it mirrors config.js closely -- same vetted RSS sources, same
 * house style -- but every value below is independently editable.
 */
module.exports = {
  // ---- RSS sources -------------------------------------------------------
  // Same vetted, high-quality feeds as the Groq pipeline. Add/remove feeds here
  // freely -- this list is NOT shared with config.js, so changes here never
  // affect the Groq pipeline and vice versa.
  feeds: [
    { name: 'BBC Sport',        url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',  weight: 3, enabled: true },
    { name: 'Sky Sports',       url: 'https://www.skysports.com/rss/12040',              weight: 3, enabled: true },
    { name: 'The Guardian',     url: 'https://www.theguardian.com/football/rss',         weight: 3, enabled: true },
    { name: 'ESPN FC',          url: 'https://www.espn.com/espn/rss/soccer/news',        weight: 2, enabled: true },
    { name: 'Goal.com Top News',url: 'https://www.goal.com/en/feeds/news?fmt=rss',       weight: 4, enabled: true },
    { name: 'Football Espana',  url: 'https://www.football-espana.net/feed',             weight: 3, enabled: true },
    { name: 'Marca English',    url: 'https://e00-marca.uecdn.es/rss/en/index.xml',     weight: 3, enabled: true },
  ],

  fetch: {
    timeoutMs: 10000,
    userAgent: 'Mozilla/5.0 (compatible; FootballStoriesBot/1.0; +https://example.com)',
    maxItemsPerFeed: 40,
  },

  // ---- Candidate collection / cost control ---------------------------------
  maxAgeHours: 36,
  maxCandidates: 25,
  snippetChars: 300,
  maxArticlesPerRun: 3,     // this pipeline's own hard cap per run
  maxPublishedPerDay: 3,    // this pipeline's own daily cap (tracked separately via the `pipeline` column)
  dedupeLookbackDays: 14,
  useSourceImages: true,
  upgradeImages: true,
  minImageWidth: 900,
  imageTimeoutMs: 5000,

  // ---- Editorial Categories --------------------------------------------------
  categories: [
    'Transfers', 'Injuries', 'Managers', 'Business', 'Controversy', 'International',
    'Champions League', 'Europa League', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
    'Saudi Pro League', 'MLS', "Ballon d'Or",
  ],
  allowClubAsCategory: true,

  // Keywords used to rank candidates before the AI call -- tuned for exactly
  // what was asked for: top European leagues, biggest clubs, star players,
  // and major transfer/match storylines.
  priorityKeywords: [
    'champions league', 'europa league', 'premier league', 'la liga', 'serie a', 'bundesliga', 'ligue 1',
    'saudi pro league', 'mls', 'world cup', 'nations league', 'qualifier', 'transfer', 'signs', 'signing',
    'deal', 'agree', 'ronaldo', 'messi', 'mbappe', 'vinicius', 'bellingham', 'haaland', 'sacked',
    'manager', 'head coach', 'controversy', 'ban', 'suspended', 'ballon d\'or', 'derby', 'final', 'contract',
  ],

  // Global Superstars & Big Clubs given priority during candidate selection
  bigClubs: [
    'ronaldo', 'messi', 'inter miami', 'al nassr', 'al hilal', 'al ittihad',
    'real madrid', 'barcelona', 'atletico', 'manchester city', 'manchester united', 'liverpool', 'arsenal',
    'chelsea', 'tottenham', 'bayern', 'dortmund', 'psg', 'paris saint-germain', 'juventus', 'inter', 'milan',
    'napoli', 'roma', 'newcastle', 'aston villa', 'leverkusen',
  ],

  // Candidates matching these are dropped before the AI sees them -- this is
  // the "no random/low-quality feed noise" guard-rail: quizzes, betting tips,
  // galleries, academy/youth news, etc. never reach the editor.
  excludePatterns: [
    /\bquiz\b/i, /\bpodcast\b/i, /\bbetting\b/i, /\btips?:/i, /\bpredictions?\b/i, /\bfantasy\b/i,
    /\blive[:\s-]/i, /\bwatch:/i, /\bgallery\b/i, /\bin pictures\b/i, /\bunder-?(1[0-9]|2[0-3])s?\b/i,
    /\bwomen'?s? (super league|championship)\b/i, /\bacademy\b/i, /\bvideo\b/i,
  ],

  // Same house style as the Groq pipeline, so articles from both pipelines
  // read identically to a site visitor.
  style: {
    title:      { minWords: 4, maxWords: 12, maxChars: 90 },
    summary:    { minWords: 12, maxWords: 40 },
    paragraphs: { min: 3, max: 10, minWords: 4, maxWords: 60 },
    bodyWords:  { min: 70, max: 300 },
    highlight:  { minWords: 8, maxWords: 55 },
  },
};
