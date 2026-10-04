'use strict';
/**
 * ONE Gemini API call: the model acts as editor — picks up to 3 stories from the compact candidate list
 * and writes the finished articles in the site's house style. The API key is read from the
 * environment (GEMINI_API_KEY or OPENAI_API_KEY as fallback) and never leaves the server.
 */
const { truncate } = require('./text');

const SCHEMA = {
  type: 'object',
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['candidate_ids', 'title', 'summary', 'body', 'highlight', 'category'],
        properties: {
          candidate_ids: { type: 'array', items: { type: 'integer' } },
          title: { type: 'string' },
          summary: { type: 'string' },
          body: { type: 'array', items: { type: 'string' } },
          highlight: { type: 'string' },
          category: { type: 'string' },
        },
      },
    },
  },
  required: ['articles'],
};

function systemPrompt(cfg) {
  const s = cfg.style;
  return `You are the editor-in-chief and sole writer of "Football Stories", a football news website.
From a numbered list of candidate stories (taken from RSS feeds) you choose AT MOST ${cfg.maxArticlesPerRun} stories and write each as an original article.
If nothing is genuinely important, return {"articles": []}. Publishing nothing is better than publishing weak news.

SELECTION
- Prioritise: Champions League, Europa League, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, major international competitions, major transfers, major injuries, major managerial developments, major club developments, major controversies, and events involving globally important players.
- Prefer stories confirmed by several sources (the "sources" field lists them).
- Avoid: minor rumours, speculation-led stories, social-media chatter, low-level or youth stories, clickbait, opinion pieces and anything not clearly supported by the supplied text.
- Several candidates can describe the SAME event in different words (e.g. "scores twice" / "nets a brace"). Treat them as one story, write one article, and list every matching id in candidate_ids. Never write two articles about the same event.
- Do not select a story that repeats one of the RECENTLY PUBLISHED headlines you are given.

FACTS — STRICT
- Use ONLY information present in the supplied titles and snippets of the candidates you cite. If the snippets are thin, write a shorter article. Do not add background, statistics, scores, dates, ages, fees or names from your own memory.
- Never invent quotes and never use quotation marks. Report what someone said or did in your own words ("According to <source>...") only if the snippet says so.
- Rumours and reports must stay framed as reports ("according to BBC Sport", "reportedly"). Do not present them as confirmed.
- Do not copy sentences from the snippets; rewrite in your own words.

HOUSE STYLE (match the existing site articles)
- title: a short, plain, sentence-case news headline, ${s.title.minWords}-${s.title.maxWords} words (typically 6-9), no clickbait, no question marks, no exclamation marks, no trailing full stop.
- summary: the "dek" — 1-2 sentences, ${s.summary.minWords}-${s.summary.maxWords} words, stating the news and why it matters.
- body: ${s.paragraphs.min}-${s.paragraphs.max} short paragraphs (usually one or two sentences each, typically 15-30 words), about ${s.bodyWords.min + 40}-${s.bodyWords.max - 40} words in total. Open with the core news in the first paragraph, then context, then what comes next. No subheadings, no HTML.
- highlight: a closing 1-2 sentence takeaway (${s.highlight.minWords}-${s.highlight.maxWords} words) that sums up the significance without adding new facts.
- tone: professional football journalism — concise, readable, factual, engaging. International English.
- category: one of [${cfg.categories.join(', ')}]${cfg.allowClubAsCategory ? ', or the name of the single club the story is mainly about (e.g. "Real Madrid")' : ''}.

Return only valid JSON matching the requested response schema. Do not use Markdown formatting or code blocks.`;
}

function userPrompt(candidates, recentTitles, cfg) {
  const lines = candidates.map((c, idx) => {
    const id = idx + 1;
    const srcs = c.items.slice(0, 3).map(i => `[${i.source}] ${i.title}${i.snippet ? ' — ' + truncate(i.snippet, cfg.snippetChars) : ''}`);
    return `#${id} (sources: ${c.sources.join(', ')})\n${srcs.join('\n')}`;
  });
  const recent = recentTitles.length ? recentTitles.map(t => `- ${t}`).join('\n') : '(none)';
  return `RECENTLY PUBLISHED HEADLINES (do not repeat these stories):\n${recent}\n\nCANDIDATES:\n${lines.join('\n\n')}`;
}

async function requestGemini(modelName, candidates, recentTitles, cfg, apiKey, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt(cfg) }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt(candidates, recentTitles, cfg) }]
          }
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: SCHEMA,
          maxOutputTokens: 2500
        }
      }),
    });

    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function editorialCall(candidates, recentTitles, cfg, { fetchImpl = fetch, apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const modelsToTry = [
    process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    'gemini-1.5-flash'
  ];

  let lastError;
  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await requestGemini(model, candidates, recentTitles, cfg, apiKey, fetchImpl);

        if (res.status === 503 && attempt === 1) {
          // Wait 2 seconds before retrying on high demand
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          throw new Error(`Gemini HTTP ${res.status}: ${detail}`);
        }

        const data = await res.json();
        let content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) throw new Error('Gemini returned no content');

        content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          throw new Error('Gemini returned invalid JSON');
        }

        return {
          articles: Array.isArray(parsed.articles) ? parsed.articles : [],
          model,
          usage: data.usageMetadata || null
        };
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error('All Gemini model attempts failed');
}

module.exports = { editorialCall, systemPrompt, userPrompt, SCHEMA };