-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Adds the player-database feature. Does NOT touch public.news_articles or any
-- existing table -- this is a brand new table, safe to run alongside schema.sql.
--
-- Stores player data fetched on-demand from the Transfermarkt community API
-- (https://transfermarkt-api.fly.dev), so a player is only ever fetched once
-- and every later visitor reads this cached row instead of hitting the
-- upstream API again. Market values are Transfermarkt's own estimates, never
-- treated as exact/verified figures.

create table if not exists public.players (
  id                 uuid primary key default gen_random_uuid(),
  tm_id              text not null unique,         -- Transfermarkt player id (the stable identifier)
  slug               text not null unique,          -- url-safe lookup key, e.g. "kylian-mbappe"
  name               text not null,                 -- full name, as given by Transfermarkt
  search_name        text not null,                 -- normalised (lowercase, no accents) for lookups
  date_of_birth      date,
  age                int,
  nationality        text,
  position            text,
  photo_url          text,
  current_club       text,
  current_club_tm_id text,
  shirt_number       text,                          -- text, not int: Transfermarkt can omit or return odd values
  market_value       text,                          -- formatted estimate as Transfermarkt shows it, e.g. "€180.00m"
  market_value_note  text default 'Estimated value from Transfermarkt; not an official or audited figure.',
  transfers          jsonb not null default '[]'::jsonb, -- [{date, fromClub, toClub, fee, type}, ...] chronological
  source_updated_at  timestamptz,                   -- Transfermarkt's own updatedAt for the data we stored
  fetched_at         timestamptz not null default now(), -- when THIS site last fetched/refreshed it
  fetch_error        text,                          -- last upstream error, if a refresh failed (row still served)
  created_at         timestamptz not null default now()
);

create index if not exists players_search_idx on public.players (search_name);
create index if not exists players_slug_idx on public.players (slug);

-- Row Level Security: nobody can read/write with the public (anon) key at all.
-- The website reads/writes through /api/player.js, which uses the server-side
-- service-role key (service role bypasses RLS) -- same pattern as news_articles.
alter table public.players enable row level security;
