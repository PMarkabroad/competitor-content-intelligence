-- Two changes to the scoring chain, based on a real first look at v_outliers
-- against Erin McGoff (US/T3) and The Self Concept Lab (AU/T1):
--
-- 1. Replaces the fixed 2.5x-multiplier-only outlier rule with two
-- conditions, both required: top N by vpf per competitor within a 30-day
-- window, AND >= a floor multiplier over that competitor's baseline
-- median. The fixed-multiplier rule let 6 of 21 in-window posts clear the
-- bar for Erin McGoff alone (29% of her corpus) -- transcribing that much
-- isn't finding outliers, it's transcribing the median with extra steps,
-- and it fills hook_library with unremarkable content. Top-N also
-- guarantees the monthly report has rows even in a quiet month, which a
-- floor-only rule doesn't provide.
--
-- 2. Exempts T1 from the baseline/outlier path entirely, rather than
-- extending its window. The Self Concept Lab pulled 20 posts and only 4
-- fell inside the existing 90-day baseline window -- T1 accounts post
-- monthly-ish and are a positioning/offer read reviewed quarterly by a
-- human, not the hook corpus. T2/T3 are what this system exists to mine.
--
-- Both v_competitor_baseline and v_outliers are affected -- dropped and
-- recreated in dependency order (v_outliers depends on
-- v_competitor_baseline depends on v_post_metrics).

drop view if exists v_outliers;
drop view if exists v_competitor_baseline;

-- SCOREABLE_TIERS in config.ts = ('T2', 'T3') -- keep this literal in sync
-- with that constant if it's ever retuned; Postgres views can't reference
-- a TypeScript constant.
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
  and c.tier in ('T2', 'T3')
group by m.competitor_id
having count(*) >= 5;

-- OUTLIER_TOP_N_PER_ACCOUNT = 5, OUTLIER_WINDOW_DAYS = 30,
-- OUTLIER_FLOOR_MULTIPLIER = 2 in config.ts -- keep these three literals in
-- sync if retuned.
create view v_outliers as
with ranked as (
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
    where m.vpf is not null
      and lower(m.post_type) = 'video'
      and c.tier in ('T2', 'T3')
      and m.posted_at >= now() - interval '30 days'
      and not exists (
          select 1 from competitor_transcripts t where t.post_id = m.post_id
      )
)
select post_id, competitor_id, posted_at, views, vpf, baseline_median_vpf, outlier_score
from ranked
where rank_in_window <= 5
  and outlier_score >= 2
order by outlier_score desc;
