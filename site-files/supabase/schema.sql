-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Your existing static articles are NOT touched; this table only holds the automated ones.

create table if not exists public.news_articles (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  summary        text not null,                 -- the "dek" under the headline
  body           jsonb not null,                -- array of paragraph strings
  highlight      text not null,                 -- closing "Highlight" box
  category       text not null,
  published_date date not null,                 -- shown as "Sep 24, 2026" by the API
  source_name    text not null,
  source_url     text not null unique,          -- the same source story can never be published twice
  source_urls    jsonb not null default '[]'::jsonb,
  image_url      text,
  status         text not null default 'draft' check (status in ('draft', 'published', 'rejected')),
  reject_reason  text,
  created_at     timestamptz not null default now()
);

create index if not exists news_articles_public_idx
  on public.news_articles (status, published_date desc, created_at desc);

-- Row Level Security: nobody can read/write with the public (anon) key at all.
-- The website reads through /api/news, which uses the server-side service-role key
-- (service role bypasses RLS) and only ever returns status = 'published'.
alter table public.news_articles enable row level security;

-- To publish a draft you reviewed:
--   update public.news_articles set status = 'published' where slug = '...';
-- To reject / hide an article:
--   update public.news_articles set status = 'rejected' where slug = '...';
