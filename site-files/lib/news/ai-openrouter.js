'use strict';
/**
 * ONE OpenRouter API call: same editorial job as lib/news/ai.js (Groq), just
 * pointed at a different provider. We deliberately reuse systemPrompt/userPrompt
 * from ./ai.js instead of re-writing them here, so the two pipelines can never
 * drift into writing in a different "voice" by accident.
 */
const { systemPrompt, userPrompt } = require('./ai');

async function requestOpenRouter(modelName, candidates, recentTitles, cfg, apiKey, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);

  const url = 'https://openrouter.ai/api/v1/chat/completions';

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // OpenRouter asks for these two (optional, but recommended) so usage
        // shows up correctly on your OpenRouter dashboard instead of as "unknown".
        'HTTP-Referer': process.env.SITE_URL || 'https://football-stories.vercel.app',
        'X-Title': 'Football Stories - automated news (OpenRouter)',
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

async function editorialCall(candidates, recentTitles, cfg, { fetchImpl = fetch, apiKey = process.env.OPENROUTER_API_KEY } = {}) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  // Override via OPENROUTER_MODEL in Vercel's env vars any time without a redeploy
  // of this file. Pick any chat-completions model available on openrouter.ai/models.
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await requestOpenRouter(model, candidates, recentTitles, cfg, apiKey, fetchImpl);

      if ((res.status === 503 || res.status === 429) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`OpenRouter HTTP ${res.status}: ${detail}`);
      }

      const data = await res.json();

      // Unlike Groq, OpenRouter can return HTTP 200 with an `error` field when
      // the underlying model fails (quota, content policy, etc.) -- guard for it.
      if (data.error) {
        throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      let content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenRouter returned no content');

      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new Error('OpenRouter returned invalid JSON');
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

  throw lastError || new Error('OpenRouter API call failed');
}

module.exports = { editorialCall };
