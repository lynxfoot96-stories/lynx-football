'use strict';
/**
 * ONE Groq API call: the model acts as editor — picks up to 3 stories from the compact candidate list
 * and writes the finished articles in the site's house style.
 */
const { truncate } = require('./text');

function systemPrompt(cfg) {
  const s = cfg.style;
  return `You are the editor-in-chief of "Football Stories", a premium global football news website.
From a numbered list of candidate stories, choose AT MOST ${cfg.maxArticlesPerRun} top stories and write original articles for them.
If no major news exists in the candidates, return {"articles": []}.

SELECTION PRIORITY (STRICT)
1. GLOBAL SUPERSTARS & MAJOR LEAGUES: Give highest priority to stories involving Cristiano Ronaldo (Saudi/Portugal), Lionel Messi (MLS/Argentina), Kylian Mbappé, Erling Haaland, Vinícius Jr, Jude Bellingham, and major Top 5 European League clubs (Real Madrid, Barcelona, Man City, Liverpool, Arsenal, Bayern Munich, PSG, Juventus, etc.).
2. BIG EVENTS: Champions League, major controversies/polemics, big international windows (Nations League, World Cup qualifiers), major transfers, or high-profile managerial changes.
3. IGNORE LOW-LEVEL NEWS: Ignore niche squad updates, mid-table/relegation squad news for lesser-known players, or minor local league stories.

FACT ACCURACY & LENGTH
- Use ONLY facts present in the provided snippets.
- DO NOT invent numbers, contract years, or background facts not found in the source text.
- Article body MUST contain between 80 and 200 words spread across ${s.paragraphs.min}-${s.paragraphs.max} paragraphs. Expand on the provided details smoothly without adding fake facts.

HOUSE STYLE
- title: clear, engaging sentence-case headline (${s.title.minWords}-${s.title.maxWords} words).
- summary: 1-2 sentence overview (${s.summary.minWords}-${s.summary.maxWords} words).
- body: array of short paragraph strings totaling 80-200 words.
- highlight: 1 sentence takeaway at the end (${s.highlight.minWords}-${s.highlight.maxWords} words).
- category: one of [${cfg.categories.join(', ')}] or the main club/star involved.

Respond strictly with a valid JSON object matching:
{
  "articles": [
    {
      "candidate_ids": [1],
      "title": "Example Headline Here",
      "summary": "Example summary sentence.",
      "body": ["First paragraph here.", "Second paragraph here."],
      "highlight": "Closing takeaway sentence.",
      "category": "La Liga"
    }
  ]
}`;
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

async function requestGroq(modelName, candidates, recentTitles, cfg, apiKey, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);

  const url = 'https://api.groq.com/openai/v1/chat/completions';

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt(cfg) },
          { role: 'user', content: userPrompt(candidates, recentTitles, cfg) }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 3000
      }),
    });

    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function editorialCall(candidates, recentTitles, cfg, { fetchImpl = fetch, apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await requestGroq(model, candidates, recentTitles, cfg, apiKey, fetchImpl);

      if ((res.status === 503 || res.status === 429) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`Groq HTTP ${res.status}: ${detail}`);
      }

      const data = await res.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Groq returned no content');

      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new Error('Groq returned invalid JSON');
      }

      return {
        articles: Array.isArray(parsed.articles) ? parsed.articles : [],
        model,
        usage: data.usage || null
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Groq API call failed');
}

module.exports = { editorialCall, systemPrompt, userPrompt };