// /api/_lib/cache.js
// Shared cache + daily-counter helper used by every /api/*.js endpoint
// that talks to an upstream sports API (scores.js, match.js, and -- once
// you apply the same pattern there -- standings.js).
//
// WHY THIS EXISTS
// Plain `const cache = new Map()` inside a serverless function only lives
// as long as THAT ONE instance stays warm, and Vercel can run several
// instances of the same function at once (or recycle one mid-session).
// Two requests seconds apart can land on two different instances, each
// with an empty cache -- so a 25-minute TTL never actually holds in
// practice, and your daily request budget resets randomly instead of
// once a day. That's the real cause of counts jumping fast even though
// the TTL/budget numbers in the code look conservative.
//
// This file fixes that by backing the cache and the daily counter with
// Upstash Redis (via its plain HTTPS REST API -- no SDK/dependency to
// install), which is a single shared store every instance talks to.
//
// SETUP REQUIRED (one-time, ~2 minutes):
//   1. Go to https://console.upstash.com and create a free Redis database.
//   2. On that database's page, copy "REST URL" and "REST TOKEN".
//   3. In your Vercel project: Settings -> Environment Variables, add:
//        UPSTASH_REDIS_REST_URL   = <the REST URL>
//        UPSTASH_REDIS_REST_TOKEN = <the REST TOKEN>
//   4. Redeploy.
//
// UNTIL YOU DO THAT: every function below quietly falls back to a local
// in-memory Map (same behavior you have today -- not worse, just not
// fixed yet). Nothing will error or break in the meantime.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function upstashConfigured() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function redisCommand(parts) {
  if (!upstashConfigured()) return null;
  try {
    const url = `${UPSTASH_URL}/${parts.map(encodeURIComponent).join("/")}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result;
  } catch (e) {
    console.error("[cache] Upstash request failed:", e.message);
    return null;
  }
}

// ---- Local, per-instance fallback (used when Upstash isn't configured,
// or as a first check to avoid a network round-trip when it is) --------
const localCache = new Map(); // key -> { value, expiresAt }

function localGet(key) {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(key);
    return null;
  }
  return entry.value;
}

function localSet(key, value, ttlSeconds) {
  localCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ---- Public: response cache ---------------------------------------------
// Checks the fast local cache first, then Redis (if configured). A Redis
// hit also warms the local cache so this instance doesn't need another
// network round-trip for the same key until its TTL passes.

async function cacheGet(key) {
  const local = localGet(key);
  if (local !== null) return local;
  if (!upstashConfigured()) return null;

  const raw = await redisCommand(["get", key]);
  if (raw === null || raw === undefined) return null;
  try {
    const value = JSON.parse(raw);
    // Warm the local cache too. We don't know the original TTL here, so
    // use a short 60s local re-check window -- Redis stays the source of
    // truth for the real TTL either way.
    localSet(key, value, 60);
    return value;
  } catch (e) {
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  localSet(key, value, ttlSeconds);
  if (!upstashConfigured()) return;
  const raw = JSON.stringify(value);
  await redisCommand(["set", key, raw]);
  await redisCommand(["expire", key, String(ttlSeconds)]);
}

// ---- Public: daily counter -----------------------------------------------
// Increments a counter that expires automatically at the next UTC
// midnight, so it resets exactly once a day, shared across every
// instance -- unlike a plain in-memory `callsToday` variable. Returns the
// new count after incrementing, or null if Upstash isn't configured (in
// which case callers should fall back to a local-only counter, which is
// what the per-file DAILY_BUDGET logic already does today).

function secondsUntilNextUtcMidnight() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  );
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

async function incrementDailyCounter(counterName) {
  if (!upstashConfigured()) return null;
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${counterName}:${today}`;
  const count = await redisCommand(["incr", key]);
  if (count === 1) {
    // First hit today for this counter -- make sure it expires at
    // midnight UTC so it self-resets without any extra scheduled job.
    await redisCommand(["expire", key, String(secondsUntilNextUtcMidnight())]);
  }
  return count;
}

module.exports = {
  upstashConfigured,
  cacheGet,
  cacheSet,
  incrementDailyCounter,
};
