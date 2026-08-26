-- Content-intelligence platform: Phase 1 schema.
--
-- Named 012, not 011 as requested: 011 is already applied
-- (011_brand_fit_and_repost.sql, brand_fit/brand_fit_note/is_repost).
-- Renumbered to the next free slot rather than colliding with an
-- already-applied migration -- same reasoning as 008 vs 007 earlier in
-- this pipeline's history.
--
-- Three decisions carried over from the spec, not re-litigated here:
--   1. No visa/PR/migration/sponsorship topic category is added anywhere
--      in this migration. NOTE: the *existing* topic_slug CHECK
--      (migration 001) already contains 'visa-time-pressure' and
--      'visa-pr-blocker', predating this rule. Left untouched here --
--      Phase 1 only asked to extend hook_pattern, not topic_slug, and
--      changing an existing enum that live rows may reference is a
--      separate decision. Flagged in the build report, not silently
--      fixed or silently ignored.
--   2. hook_pattern's existing 7 values are kept as-is; only appended to.
--   3. why_it_performed is plain nullable text -- nothing here
--      auto-populates it.

alter table hook_library add column if not exists sub_topic text;
alter table hook_library add column if not exists content_angle text;
alter table hook_library add column if not exists cta text;
alter table hook_library add column if not exists narrative_structure text;
alter table hook_library add column if not exists why_it_performed text;
alter table hook_library add column if not exists duration_seconds numeric;

-- Widen hook_pattern's CHECK rather than replace it -- historical rows
-- keep their values, nothing is remapped. Postgres has no ALTER
-- CONSTRAINT, so this drops and recreates the same-named check with the
-- superset of values.
alter table hook_library drop constraint if exists hook_library_hook_pattern_check;
alter table hook_library add constraint hook_library_hook_pattern_check
  check (hook_pattern in (
    'contrarian_inversion', 'cost_accounting', 'empathy_pivot',
    'subdivision_teaching', 'receipt', 'direct_question', 'cold_open_story',
    'curiosity', 'warning', 'list', 'problem', 'bold_statement'
  ));

-- thumbnail_url: schema-only in this migration. competitor-pipeline/scripts/
-- (ingest.ts) is explicitly out of scope for this build, so nothing here
-- populates it at ingest time for new rows -- that's a follow-up for
-- whoever next touches ingest.ts. Existing rows stay null; the dashboard
-- falls back to deriving a thumbnail from the already-stored `raw` jsonb
-- (TikTok: raw.videoMeta.coverUrl, Instagram: raw.displayUrl) when this
-- column is null, so /reels/[post_id] isn't blank for historical posts.
alter table competitor_posts add column if not exists thumbnail_url text;

-- v_competitor_summary -- one row per ACTIVE competitor. Follower change
-- windows use the latest snapshot at or before now, and the latest
-- snapshot at or before (now - N days) -- not "the snapshot closest to
-- exactly N days ago", since harvests don't land on a fixed daily
-- schedule. posts_per_week is span-based (posts_collected over the
-- actual first-to-last-post window in weeks), not tied to any fixed
-- observation period, and is null rather than a divide-by-zero when every
-- collected post landed on the same day.
create or replace view v_competitor_summary as
with latest_snapshot as (
    select distinct on (competitor_id) competitor_id, followers, scraped_at
    from competitor_snapshots
    order by competitor_id, scraped_at desc
),
snapshot_30d_ago as (
    select distinct on (competitor_id) competitor_id, followers
    from competitor_snapshots
    where scraped_at <= now() - interval '30 days'
    order by competitor_id, scraped_at desc
),
snapshot_90d_ago as (
    select distinct on (competitor_id) competitor_id, followers
    from competitor_snapshots
    where scraped_at <= now() - interval '90 days'
    order by competitor_id, scraped_at desc
),
post_stats as (
    select
        competitor_id,
        count(*) as posts_collected,
        max(posted_at) as last_activity_at,
        min(posted_at) as first_post_at
    from competitor_posts
    group by competitor_id
),
best_post as (
    select distinct on (competitor_id)
        competitor_id, post_id as best_post_id, outlier_score as best_post_score
    from v_outliers
    order by competitor_id, outlier_score desc
)
select
    c.competitor_id,
    c.name,
    c.handle,
    c.platform,
    c.tier,
    c.market,
    c.active,
    c.handle_verified,
    c.low_median_flag,
    c.last_scraped_at,
    ls.followers as followers_current,
    (ls.followers - s30.followers) as follower_change_30d,
    (ls.followers - s90.followers) as follower_change_90d,
    coalesce(ps.posts_collected, 0) as posts_collected,
    case
        when ps.first_post_at is not null
             and ps.last_activity_at is not null
             and ps.last_activity_at > ps.first_post_at
        then round(
            ps.posts_collected
            / (extract(epoch from (ps.last_activity_at - ps.first_post_at)) / 604800.0)
        , 2)
        else null
    end as posts_per_week,
    b.baseline_median_vpf as median_vpf,
    bp.best_post_id,
    bp.best_post_score,
    ps.last_activity_at
from competitors c
left join latest_snapshot ls on ls.competitor_id = c.competitor_id
left join snapshot_30d_ago s30 on s30.competitor_id = c.competitor_id
left join snapshot_90d_ago s90 on s90.competitor_id = c.competitor_id
left join post_stats ps on ps.competitor_id = c.competitor_id
left join v_competitor_baseline b on b.competitor_id = c.competitor_id
left join best_post bp on bp.competitor_id = c.competitor_id
where c.active = true;
