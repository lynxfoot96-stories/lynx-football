// /api/squad-photos.js
// Photos for the "Team" tab (squad cards) of every club page.
//
//   GET /api/squad-photos?team=Manchester%20City&names=Erling%20Haaland|Rico%20Lewis|...
//   -> { ok:true, photos:{ "Erling Haaland":"https://..." }, done:["Erling Haaland", ...], pending:3 }
//
// Reuses ./_lib/playerPhotos.js, the SAME pipeline the Key Players photos use:
// Redis cache -> curated player-photos.json -> Wikipedia (only accepted when it is
// clearly the same footballer). Results are cached per player (found 30 days,
// missing 3 days), so after the first visit a club page costs no lookups at all.
//
// `done`    = players that were looked up (found or not) -> the page stops asking for them.
// `pending` = players not reached inside the time budget -> the page asks again shortly.
// Players with no safe photo are simply absent from `photos`; the page keeps its initials circle.

const { getPhoto } = require("./_lib/playerPhotos");

const MAX_NAMES = 25;
const BUDGET_MS = 8000;   // keep under your Vercel function timeout (Hobby = 10s)
const CONCURRENCY = 8;

function slug(name) {
  return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

module.exports = async (req, res) => {
  try {
    const team = String(req.query.team || "").slice(0, 60) || null;
    const names = Array.from(new Set(String(req.query.names || "").split("|").map((n) => n.trim()).filter((n) => n && n.length <= 60))).slice(0, MAX_NAMES);
    if (!names.length) {
      res.status(400).json({ ok: false, error: "names is required (separate players with |)." });
      return;
    }

    const photos = {};
    const done = [];
    const queue = names.slice();
    const deadline = Date.now() + BUDGET_MS;

    async function worker() {
      while (queue.length && Date.now() < deadline) {
        const name = queue.shift();
        try {
          // The id is the Redis cache key (fd-photo:sq:<club>:<name>). The club is part of it so two
          // different players with the same name (e.g. Ederson / Éderson) never share a photo.
          const url = await getPhoto({ id: "sq:" + slug(team || "") + ":" + slug(name), name, team }, fetch);
          if (url) photos[name] = url;
          done.push(name);
        } catch (_) { /* one bad player never breaks the list */ }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const pending = queue.length;
    // Only let the CDN keep complete answers, never a partial one the page is about to re-ask.
    res.setHeader("Cache-Control", pending === 0 ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store");
    res.status(200).json({ ok: true, photos, done, pending });
  } catch (err) {
    console.error("[/api/squad-photos]", err.message);
    res.status(200).json({ ok: false, error: "Photos are temporarily unavailable." });
  }
};
