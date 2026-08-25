-- Ark Abroad competitor content intelligence system
-- Initial schema: accounts, posts, classifications, collection runs.
--
-- post_classifications is deliberately separate from competitor_posts.
-- The taxonomy will be retuned after the first real report, and we don't
-- want to re-scrape to reclassify. taxonomy_version + the unique
-- constraint below let old and new classifications coexist side by side.

create extension if not exists pgcrypto;

create table if not exists competitor_accounts (
    id uuid primary key default gen_random_uuid(),
    handle text not null,
    platform text not null check (platform in ('instagram', 'tiktok', 'linkedin', 'youtube')),
    market text not null check (market in ('AU', 'US', 'CA')),
    follower_count integer,
    follower_count_updated_at timestamptz,
    tier integer,
    rationale text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (handle, platform)
);

create table if not exists competitor_posts (
    id uuid primary key default gen_random_uuid(),
    account_id uuid references competitor_accounts(id),
    post_url text not null unique,
    post_type text,
    posted_at timestamptz,
    caption text,
    on_screen_text text,
    views bigint,
    likes bigint,
    comments bigint,
    saves bigint,
    shares bigint,
    duration_seconds integer,
    collected_at timestamptz not null default now(),
    raw_payload jsonb
);

create index if not exists idx_competitor_posts_account_id on competitor_posts (account_id);
create index if not exists idx_competitor_posts_posted_at on competitor_posts (posted_at);

create table if not exists post_classifications (
    id uuid primary key default gen_random_uuid(),
    post_id uuid references competitor_posts(id),
    hook_type text,
    topic_slug text,
    format text,
    cta_type text,
    pain_point text,
    confidence numeric check (confidence >= 0 and confidence <= 1),
    taxonomy_version text not null,
    classified_at timestamptz not null default now(),
    unique (post_id, taxonomy_version)
);

create table if not exists collection_runs (
    id uuid primary key default gen_random_uuid(),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    platform text,
    market text,
    posts_collected integer,
    status text check (status in ('running', 'success', 'failed')),
    error text
);
