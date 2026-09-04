-- Recovered from the remote migration history on 2026-09-04.
--
-- This change was applied straight to the database (via the Supabase
-- dashboard/MCP) without a file in this repo, so `supabase db push`
-- refused to run: remote had migration versions local had never heard
-- of. The SQL below is the exact recorded statement set, written back
-- so local and remote history agree again.

create table generated_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  competitor_name text not null,
  market text not null,
  source_post_id uuid references competitor_posts(post_id),
  source_caption text,
  source_views bigint,
  source_vpf numeric,
  source_outlier_score numeric,
  hook text not null,
  script text not null,
  caption text not null,
  status text not null default 'draft' check (status in ('draft','used','dismissed'))
);

create index generated_drafts_created_at_idx on generated_drafts (created_at desc);
