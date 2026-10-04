'use strict';
/**
 * Central configuration for the automated news system.
 * Edit this file to add/remove RSS sources, change limits, categories or the editorial style.
 * (Secrets are NEVER stored here — they come from environment variables.)
 */
module.exports = {
  // ---- RSS sources -------------------------------------------------------
  // weight: how much the editor trusts / prefers the source (used for ranking and for choosing the
  // "primary" source credited on the article). enabled:false switches a feed off without deleting it.
  feeds: [
    { name: 'BBC Sport',    url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',  weight: 3, enabled: true },
    { name: 'Sky Sports',   url: 'https://www.skysports.com/rss/12040',              weight: 3, enabled: true },
    { name: 'The Guardian', url: 'https://www.theguardian.com/football/rss',         weight: 3, enabled: true },
    { name: 'ESPN FC',      url: 'https://www.espn.com/espn/rss/soccer/news',        weight: 2, enabled: true },
  ],

  fetch: {
    timeoutMs: 10000,
    userAgent: 'Mozilla/5.0 (compatible; FootballStoriesBot/1.0; +https://example.com)',
    maxItemsPerFeed: 40,
  },

  // ---- Candidate collection / cost control ---------------------------------
  maxAgeHours: 36,          // ignore RSS items older than this
  maxCandidates: 25,        // compact batch sent to the AI (after dedupe + filtering)
  snippetChars: 220,        // max characters of each source snippet sent to the AI
  maxArticlesPerRun: 3,     // hard cap, enforced in code (not only in the prompt)
  maxPublishedPerDay: 3,    // hard daily cap: stops double-triggers from spending credits
  dedupeLookbackDays: 14,   // compare against articles published in the last N days
  useSourceImages: true,    // use the image the RSS item provides (see README on image rights)

  // ---- Editorial -------------------------------------------------------------
  // Categories seen on the existing site: Business, Transfers, Ballon d'Or, Real Madrid
  // (i.e. a topic OR the club the story is mainly about). Extend freely.
  categories: [
    'Transfers', 'Injuries', 'Managers', 'Business', 'Controversy', 'International',
    'Champions League', 'Europa League', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
    "Ballon d'Or",
  ],
  allowClubAsCategory: true, // lets the AI use a club name (e.g. "Real Madrid") like the existing articles

  // Keywords used ONLY to rank candidates before the AI call (cheap pre-filter, not a hard gate).
  priorityKeywords: [
    'champions league', 'europa league', 'premier league', 'la liga', 'serie a', 'bundesliga', 'ligue 1',
    'world cup', 'euro 2028', 'nations league', 'qualifier', 'transfer', 'signs', 'signing', 'deal', 'agree',
    'injury', 'injured', 'ruled out', 'sacked', 'appointed', 'manager', 'head coach', 'resign', 'ban',
    'suspended', 'charged', 'investigation', 'ballon', 'derby', 'final', 'contract',
  ],
  bigClubs: [
    'real madrid', 'barcelona', 'atletico', 'manchester city', 'manchester united', 'liverpool', 'arsenal',
    'chelsea', 'tottenham', 'bayern', 'dortmund', 'psg', 'paris saint-germain', 'juventus', 'inter', 'milan',
    'napoli', 'roma', 'newcastle', 'aston villa', 'leverkusen',
  ],
  // Candidates matching these are dropped before the AI sees them.
  excludePatterns: [
    /\bquiz\b/i, /\bpodcast\b/i, /\bbetting\b/i, /\btips?:/i, /\bpredictions?\b/i, /\bfantasy\b/i,
    /\blive[:\s-]/i, /\bwatch:/i, /\bgallery\b/i, /\bin pictures\b/i, /\bunder-?(1[0-9]|2[0-3])s?\b/i,
    /\bwomen'?s? (super league|championship)\b/i, /\bacademy\b/i, /\bvideo\b/i,
  ],

  /**
   * Style card derived from the articles already on the site (measured, not copied):
   * 5 samples -> title 6-9 words, dek 21-27 words, 9-12 one/two-sentence paragraphs,
   * 175-260 body words, closing "Highlight" box of 17-42 words.
   */
  style: {
    title:      { minWords: 4, maxWords: 11, maxChars: 80 },
    summary:    { minWords: 14, maxWords: 38 },
    paragraphs: { min: 6, max: 12, minWords: 4, maxWords: 55 },
    bodyWords:  { min: 120, max: 300 },
    highlight:  { minWords: 10, maxWords: 55 },
  },
};
