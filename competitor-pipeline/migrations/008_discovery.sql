-- Discovery candidate table for the behaviour-first discovery pass
-- (scripts/discover.ts). Separate from `competitors` -- nothing enters the
-- registry until a human approves a shortlisted row via --promote.
--
-- Named 008, not 007 as originally requested: 007 is already applied
-- (007_follower_band_gates.sql, the follower-band vpf/view-floor gates in
-- v_outliers). Renumbered to the next free slot rather than colliding with
-- an already-applied migration.
--
-- Data minimisation, same rule as everywhere else in this schema: no
-- commenter identities, no personal attributes, no free-text fields that
-- would invite them. bio/display_name are the account's own self-authored
-- public profile text, not personal data about a third party.

create table if not exists discovery_candidates (
    candidate_id uuid primary key default gen_random_uuid(),
    platform text not null,
    handle text not null,
    profile_url text,
    display_name text,
    bio text,
    followers bigint,
    market_guess text,
    found_via text,
    found_at timestamptz not null default now(),
    video_posts_90d integer,
    median_vpf_90d numeric,
    last_post_at timestamptz,
    is_private boolean,
    band text,
    gate_result text check (gate_result in ('pass', 'fail')),
    gate_fail_reason text,
    relevance_score integer,
    topic_slugs text[],
    proposed_tier text,
    reviewed_by text,
    reviewed_at timestamptz,
    promoted boolean not null default false,
    raw jsonb,
    unique (platform, handle)
);

create index if not exists idx_discovery_candidates_gate_result on discovery_candidates (gate_result);
create index if not exists idx_discovery_candidates_promoted on discovery_candidates (promoted);
