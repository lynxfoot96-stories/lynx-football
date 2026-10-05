'use strict';
/**
 * Central configuration for the automated news system.
 */
module.exports = {
  // ---- RSS sources -------------------------------------------------------
  feeds: [
    { name: 'BBC Sport',        url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',  weight: 3, enabled: true },
    { name: 'Sky Sports',       url: 'https://www.skysports.com/rss/12040',              weight: 3, enabled: true },
    { name: 'The Guardian',     url: 'https://www.theguardian.com/football/rss',         weight: 3, enabled: true },
    { name: 'ESPN FC',          url: 'https://www.espn.com/espn/rss/soccer/news',        weight: 3, enabled: true },
    // Added Top-tier Global & Star Feeds
    { name: 'Goal.com Top News',url: 'https://www.goal.com/feeds/en/news',               weight: 4, enabled: true },
    { name: 'Football Espana',  url: 'https://www.football-espana.net/feed',             weight: 3, enabled: true },
    { name: 'Marca English',    url: 'https://e00-marca.uecdn.es/rss/en/index.xml',     weight: 3, enabled: true },
  ],

  fetch: {
    timeoutMs: 10000,
    userAgent: 'Mozilla/5.0 (compatible; FootballStoriesBot/1.0; +https://example.com)',
    maxItemsPerFeed: 40,
  },

  // ---- Candidate collection / cost control ---------------------------------
  maxAgeHours: 36,          // ignore RSS items older than this
  maxCandidates: 25,        // compact batch sent to the AI (after dedupe + filtering)
  snippetChars: 300,        // extended snippet length to give AI enough context for 120+ words
  maxArticlesPerRun: 3,     // hard cap
  maxPublishedPerDay: 3,    // hard daily cap
  dedupeLookbackDays: 14,   // compare against articles published in the last N days
  useSourceImages: true,

  // ---- Editorial Categories --------------------------------------------------
  categories: [
    'Transfers', 'Injuries', 'Managers', 'Business', 'Controversy', 'International',
    'Champions League', 'Europa League', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
    'Saudi Pro League', 'MLS', "Ballon d'Or",
  ],
  allowClubAsCategory: true,

  // Keywords used to rank candidates before the AI call
  priorityKeywords: [
    'champions league', 'europa league', 'premier league', 'la liga', 'serie a', 'bundesliga', 'ligue 1',
    'saudi pro league', 'mls', 'world cup', 'nations league', 'qualifier', 'transfer', 'signs', 'signing',
    'deal', 'agree', 'ronaldo', 'messi', 'mbappe', 'vinicius', 'bellingham', 'haaland', 'sacked',
    'manager', 'head coach', 'controversy', 'ban', 'suspended', 'ballon d\'or', 'derby', 'final', 'contract',
  ],

  // Global Superstars & Big Clubs given priority during candidate selection
  bigClubs: [
    // Global Superstars & Key Teams
    'ronaldo', 'messi', 'inter miami', 'al nassr', 'al hilal', 'al ittihad',
    // European Giants
    'real madrid', 'barcelona', 'atletico', 'manchester city', 'manchester united', 'liverpool', 'arsenal',
    'chelsea', 'tottenham', 'bayern', 'dortmund', 'psg', 'paris saint-germain', 'juventus', 'inter', 'milan',
    'napoli', 'roma', 'newcastle', 'aston villa', 'leverkusen',
  ],

  // Candidates matching these are dropped before the AI sees them
  excludePatterns: [
    /\bquiz\b/i, /\bpodcast\b/i, /\bbetting\b/i, /\btips?:/i, /\bpredictions?\b/i, /\bfantasy\b/i,
    /\blive[:\s-]/i, /\bwatch:/i, /\bgallery\b/i, /\bin pictures\b/i, /\bunder-?(1[0-9]|2[0-3])s?\b/i,
    /\bwomen'?s? (super league|championship)\b/i, /\bacademy\b/i, /\bvideo\b/i,
  ],

  /**
   * Style card: Adjusted minimum body words to 80 so good concise stories are not rejected.
   */
  style: {
    title:      { minWords: 4, maxWords: 12, maxChars: 90 },
    summary:    { minWords: 12, maxWords: 40 },
    paragraphs: { min: 3, max: 10, minWords: 4, maxWords: 60 },
    bodyWords:  { min: 70, max: 300 }, // Lowered min threshold from 120 to 70 to stop rejections
    highlight:  { minWords: 8, maxWords: 55 },
  },
};