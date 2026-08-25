-- Ark Abroad competitor-analysis pipeline
-- Registry + snapshots + posts + transcripts + hook library.
--
-- Data minimisation is enforced here by omission: no columns anywhere for
-- commenter handles, commenter names, individual names in testimonials, or
-- any inferred personal attribute. `raw` jsonb columns exist for debugging
-- the actor payload, but the ingest handler (scripts/ingest.ts) strips
-- comment-author and personal-identifier fields from `raw` before insert —
-- this schema does not enforce that stripping itself, the handler does.

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- competitors ----------------------------------------------------------

create table if not exists competitors (
    competitor_id uuid primary key default gen_random_uuid(),
    name text not null,
    tier text not null check (tier in ('T1', 'T2', 'T3')),
    market text not null check (market in ('AU', 'US', 'CA')),
    platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
    handle text not null,
    profile_url text,
    niche_match text check (niche_match in ('direct', 'analogue', 'format')),
    scrape_cadence text check (scrape_cadence in ('weekly', 'fortnightly', 'monthly')),
    posts_per_run integer,
    transcripts_enabled boolean not null default true,
    handle_verified boolean not null default false,
    active boolean not null default true,
    last_scraped_at timestamptz,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (platform, handle)
);

create trigger trg_competitors_updated_at
before update on competitors
for each row execute function set_updated_at();

-- competitor_snapshots ---------------------------------------------------
-- Follower count per scrape run. The denominator for all scoring, so it's
-- captured every run rather than once at setup.

create table if not exists competitor_snapshots (
    snapshot_id uuid primary key default gen_random_uuid(),
    competitor_id uuid not null references competitors(competitor_id),
    scraped_at timestamptz not null default now(),
    followers bigint,
    following bigint,
    post_count bigint,
    bio text,
    raw jsonb
);

create index if not exists idx_competitor_snapshots_competitor_scraped
    on competitor_snapshots (competitor_id, scraped_at desc);

-- competitor_posts -------------------------------------------------------
-- One row per post, upserted on re-scrape so metrics update but
-- first_seen_at is preserved.

create table if not exists competitor_posts (
    post_id uuid primary key default gen_random_uuid(),
    competitor_id uuid not null references competitors(competitor_id),
    platform_post_id text not null,
    post_url text,
    post_type text,
    caption text,
    posted_at timestamptz,
    views bigint,
    likes bigint,
    comments bigint,
    shares bigint,
    duration_seconds numeric,
    first_seen_at timestamptz not null default now(),
    last_scraped_at timestamptz not null default now(),
    raw jsonb,
    unique (competitor_id, platform_post_id)
);

create index if not exists idx_competitor_posts_competitor_posted
    on competitor_posts (competitor_id, posted_at desc);
create index if not exists idx_competitor_posts_last_scraped
    on competitor_posts (last_scraped_at);

-- competitor_transcripts ---------------------------------------------------
-- Second pass, outliers only (see v_outliers in 002_scoring_views.sql).
-- Transcribing every post triples Apify spend and teaches nothing.

create table if not exists competitor_transcripts (
    transcript_id uuid primary key default gen_random_uuid(),
    post_id uuid not null references competitor_posts(post_id),
    transcript text,
    opening_line text,
    seconds_to_first_claim numeric,
    transcribed_at timestamptz not null default now(),
    raw jsonb,
    unique (post_id)
);

-- hook_library -------------------------------------------------------------
-- The output asset. The only table a human reads directly.

create table if not exists hook_library (
    hook_id uuid primary key default gen_random_uuid(),
    post_id uuid not null references competitor_posts(post_id),
    competitor_id uuid not null references competitors(competitor_id),
    hook_pattern text check (hook_pattern in (
        'contrarian_inversion', 'cost_accounting', 'empathy_pivot',
        'subdivision_teaching', 'receipt', 'direct_question', 'cold_open_story'
    )),
    format text check (format in (
        'talking_head', 'screen_walkthrough', 'text_on_screen_broll',
        'greenscreen_react', 'carousel_as_reel', 'pov'
    )),
    topic_slug text check (topic_slug in (
        'linkedin-networking', 'interview-performance', 'resume-not-working',
        'no-local-experience', 'volume-no-results', 'visa-time-pressure',
        'no-callbacks', 'visa-pr-blocker'
    )),
    opening_line text,
    outlier_score numeric,
    vpf numeric,
    au_transplant text check (au_transplant in ('yes', 'no', 'with_changes')),
    transplant_note text,
    tagged_by text,
    tagged_at timestamptz not null default now(),
    used_in text[],
    updated_at timestamptz not null default now()
);

create trigger trg_hook_library_updated_at
before update on hook_library
for each row execute function set_updated_at();

create index if not exists idx_hook_library_competitor on hook_library (competitor_id);
create index if not exists idx_hook_library_post on hook_library (post_id);
