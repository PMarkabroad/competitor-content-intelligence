-- Replaces migration 006's flat MIN_ACCOUNT_MEDIAN_VPF (0.02) and
-- MIN_OUTLIER_VIEWS (5000) with follower-band tiers. The flat median gate
-- was wrong: median vpf scales inversely with follower count, so one
-- absolute number can't span a 2k-follower account and a 2.3M-follower
-- one. It wrongly excluded Erin McGoff (2.3M followers, median vpf 0.0185
-- = ~42k views/post, a healthy account) alongside Self Made Millennial
-- (49k followers, median vpf 0.005 = ~245 views/post, genuinely thin).
-- MIN_OUTLIER_VIEWS alone would have made the right call on its own.
--
-- FOLLOWER_BANDS in config.ts is the source of truth for the three bands
-- below -- keep both in sync if retuned:
--   small  <10k        min_median_vpf 0.05   min_outlier_views 1,000
--   mid    10k-250k     min_median_vpf 0.01   min_outlier_views 5,000
--   large  >=250k       min_median_vpf 0.005  min_outlier_views 20,000
--
-- Band is resolved per account from its most recent snapshot, at query
-- time -- not stored as a column, since accounts move between bands as
-- they grow. The small band matters beyond today's roster: T2 Canadian
-- coaches will land at 1-5k followers, and a flat 5,000-view floor would
-- silently exclude that entire tier the moment their handles are verified.

create or replace view v_outliers as
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
      and c.tier in ('T2', 'T3')
      and m.posted_at >= now() - interval '30 days'
      and coalesce(m.paid_partnership, false) = false
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
