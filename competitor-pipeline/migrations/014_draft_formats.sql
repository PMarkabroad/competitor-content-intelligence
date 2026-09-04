-- Per-channel versions of a ready-made post.
--
-- generated_drafts holds one script plus one caption, which is a reel and
-- nothing else. Publishing the same idea to LinkedIn, a carousel, a story
-- or a tweet meant rewriting it by hand every time -- the part of the job
-- this pipeline was supposed to remove.
--
-- Kept as rows rather than columns on generated_drafts because the channel
-- list changes: Threads, YouTube Shorts and whatever comes next are new
-- rows here, not another schema migration and another nullable column.
--
-- char_limit is the PLATFORM'S hard ceiling, not a target. Facebook's
-- 63,206 is a technical maximum nobody should write to; the generator aims
-- for what actually reads well on each channel and this column exists to
-- catch a violation, not to be filled up.

create table if not exists draft_formats (
    draft_format_id uuid primary key default gen_random_uuid(),
    draft_id uuid not null references generated_drafts(draft_id) on delete cascade,
    platform text not null check (platform in ('instagram', 'linkedin', 'facebook', 'twitter')),
    format text not null check (format in (
        'single_image', 'carousel', 'reel', 'story',   -- instagram
        'post', 'carousel_pdf',                        -- linkedin
        'facebook_post', 'facebook_carousel',          -- facebook
        'tweet'                                        -- twitter/X
    )),
    body text not null,
    -- NULL where the platform sets no fixed limit (Instagram Stories).
    char_limit integer,
    -- Stored rather than computed on read so the dashboard can flag an
    -- over-limit row without recounting every body on every page load.
    char_count integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- One body per channel per draft. Regenerating updates in place.
    unique (draft_id, platform, format)
);

create index if not exists draft_formats_draft_idx on draft_formats (draft_id);

-- A body longer than its own platform allows cannot be posted, so it is
-- refused at write time rather than discovered when someone pastes it in.
alter table draft_formats drop constraint if exists draft_formats_within_limit;
alter table draft_formats add constraint draft_formats_within_limit
    check (char_limit is null or char_count <= char_limit);
