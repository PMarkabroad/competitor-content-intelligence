-- Retires the T1/T2/T3 tier system. `category` becomes the single axis.
--
-- Tier was doing three jobs: deciding harvest cadence, setting a default
-- posts_per_run, and deciding which accounts were scoreable at all. By
-- 2026-11-05 it was doing none of them in practice:
--
--   * Scoreability: SCOREABLE_TIERS was ('T2','T3') and every one of the 23
--     active, verified accounts is T2 or T3. The filter excluded nobody --
--     verified by counting, not assumed: 0 rows excluded by tier.
--   * posts_per_run: all 23 rows override the tier default with 60, so the
--     per-tier defaults never applied.
--   * Cadence: the only thing it still did -- two harvest runs an hour apart
--     instead of one.
--
-- Meanwhile `category` had quietly taken over the real analytical work. The
-- rule that actually shapes the rankings -- keeping viral creators out of
-- benchmark averages, so a lifestyle reel at 400x its own modest baseline
-- cannot outrank a career coach's genuine 12x -- lives in the dashboard's
-- benchmarkRows() and keys off CATEGORY, not tier. And the two had become
-- exact duplicates of each other: T2 was all 14 niche_competitor, T3 all 9
-- viral_creator. Two names for one split is how a reader ends up unsure
-- which one governs.
--
-- So: tier comes out of every view. Nothing about who gets analysed or what
-- gets generated changes -- the filter was already a no-op, which is exactly
-- why it was safe to remove and why it was worth removing.
--
-- WHAT THIS GIVES UP: T1 existed so an account could be tracked for
-- positioning and offer -- how they price, what they sell, reviewed by a
-- human quarterly -- WITHOUT its posts entering the hook corpus and skewing
-- the craft library. There are no T1 accounts and have not been for some
-- time, so nothing is lost today. If that need returns, it should come back
-- as a `category` value ('positioning_watch', say) excluded from the
-- scoring views, rather than as a second parallel axis.
--
-- The competitors.tier COLUMN is deliberately LEFT IN PLACE, holding its
-- current values. Nothing reads it after this migration. Dropping a column
-- is irreversible and buys nothing here, and the existing values are the
-- only record of how the roster was tiered. Drop it in a one-line migration
-- once this has run a few cycles:  alter table competitors drop column tier;

-- v_competitor_baseline ----------------------------------------------------
-- Was: ... and c.tier in ('T2','T3'). The join to competitors is kept even
-- though the filter is gone -- it still guarantees a baseline is only
-- computed for a post whose competitor row actually exists.
-- Dropped children-first: v_competitor_summary and v_outliers both read
-- v_competitor_baseline, so it cannot be replaced until they are gone.
drop view if exists v_competitor_summary;
drop view if exists v_carousel_outliers;
drop view if exists v_outliers;
drop view if exists v_hook_report;
drop view if exists v_competitor_baseline;

create view v_competitor_baseline as
select
    m.competitor_id,
    percentile_cont(0.5) within group (order by m.vpf) as baseline_median_vpf,
    count(*) as posts_in_window
from v_post_metrics m
join competitors c on c.competitor_id = m.competitor_id
where m.posted_at >= now() - interval '90 days'
  and m.vpf is not null
  and lower(m.post_type) = 'video'
group by m.competitor_id
having count(*) >= 5;

-- v_outliers ---------------------------------------------------------------
-- Unchanged except for the removed tier filter. OUTLIER_TOP_N_PER_ACCOUNT =
-- 5, OUTLIER_WINDOW_DAYS = 30, OUTLIER_FLOOR_MULTIPLIER = 2 in config.ts --
-- keep those three literals in sync if retuned.
create view v_outliers as
with latest_snapshot as (
    select distinct on (competitor_id)
        competitor_id,
        followers
    from competitor_snapshots
    order by competitor_id, scraped_at desc
),
banded as (
    select
        ls.competitor_id,
        ls.followers,
        case
            when ls.followers < 10000 then 0.05
            when ls.followers < 250000 then 0.01
            else 0.005
        end as min_median_vpf,
        case
            when ls.followers < 10000 then 1000
            when ls.followers < 250000 then 5000
            else 20000
        end as min_outlier_views
    from latest_snapshot ls
),
ranked as (
    select
        m.post_id,
        m.competitor_id,
        m.posted_at,
        m.views,
        m.vpf,
        b.baseline_median_vpf,
        m.vpf / b.baseline_median_vpf as outlier_score,
        row_number() over (partition by m.competitor_id order by m.vpf desc) as rank_in_window
    from v_post_metrics m
    join v_competitor_baseline b on b.competitor_id = m.competitor_id
    join competitors c on c.competitor_id = m.competitor_id
    join banded bd on bd.competitor_id = m.competitor_id
    where m.vpf is not null
      and lower(m.post_type) = 'video'
      and c.active = true
      and m.posted_at >= now() - interval '30 days'
      and coalesce(m.paid_partnership, false) = false
      and coalesce(m.is_repost, false) = false
      and b.baseline_median_vpf >= bd.min_median_vpf
      and m.views >= bd.min_outlier_views
      and not exists (
          select 1 from competitor_transcripts t where t.post_id = m.post_id
      )
)
select post_id, competitor_id, posted_at, views, vpf, baseline_median_vpf, outlier_score
from ranked
where rank_in_window <= 5
  and outlier_score >= 2
order by outlier_score desc;

-- v_carousel_outliers ------------------------------------------------------
-- Unchanged except for the removed tier filter. See
-- 019_carousel_scoring.sql for why this chain is separate from the vpf one.
create view v_carousel_outliers as
with ranked as (
    select
        m.post_id,
        m.competitor_id,
        m.posted_at,
        m.post_url,
        m.likes,
        m.comments,
        m.followers,
        m.epf,
        m.comment_bait,
        m.comment_to_like,
        b.baseline_median_epf,
        b.carousels_in_window,
        m.epf / b.baseline_median_epf as carousel_score,
        row_number() over (partition by m.competitor_id order by m.epf desc) as rank_in_window
    from v_carousel_metrics m
    join v_carousel_baseline b on b.competitor_id = m.competitor_id
    join competitors c on c.competitor_id = m.competitor_id
    where m.epf is not null
      and b.baseline_median_epf > 0
      and c.active = true
      and m.posted_at >= now() - interval '30 days'
      and coalesce(m.likes, 0) >= 10
      and coalesce(m.paid_partnership, false) = false
      and coalesce(m.is_repost, false) = false
)
select
    post_id,
    competitor_id,
    posted_at,
    post_url,
    likes,
    comments,
    followers,
    epf,
    comment_bait,
    comment_to_like,
    baseline_median_epf,
    carousels_in_window,
    carousel_score
from ranked
where rank_in_window <= 5
  and carousel_score >= 2
order by carousel_score desc;

-- v_hook_report ------------------------------------------------------------
-- Exactly as migration 018 left it, with c.tier dropped from the column
-- list. The 30-day window, the LIMIT 15 and the brand_fit rule are all
-- carried over unchanged -- this is a report of the last month's best hooks,
-- not the whole library.
create view v_hook_report as
select
    h.hook_id, h.hook_pattern, h.format, h.topic_slug, h.opening_line,
    h.outlier_score, h.vpf, h.au_transplant, h.transplant_note,
    c.name as competitor_name, c.market, c.category,
    h.tagged_at, h.brand_fit, h.brand_fit_note
from hook_library h
join competitors c on c.competitor_id = h.competitor_id
where h.tagged_at >= (now() - '30 days'::interval)
  and h.brand_fit is distinct from 'no'
order by h.outlier_score desc
limit 15;

-- v_competitor_summary -----------------------------------------------------
-- Exactly as migration 018 left it, with c.tier dropped. Recreated rather
-- than left alone because it reads v_competitor_baseline, which is dropped
-- and rebuilt above.
create view v_competitor_summary as
select
    c.competitor_id, c.name, c.handle, c.platform, c.market,
    c.category, c.active, c.handle_verified, c.last_scraped_at,
    b.baseline_median_vpf, b.posts_in_window
from competitors c
left join v_competitor_baseline b on b.competitor_id = c.competitor_id;

comment on column competitors.tier is
    'DEPRECATED 2026-11-05 (migration 020). Nothing reads this. Retained only as a record of the old tiering; category is the single axis now. Safe to drop.';
