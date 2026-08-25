-- Three fixes to v_outliers's remaining blind spots, found by actually
-- looking at what it returned:
--
-- 1. paid_partnership: the 20.7x Erin McGoff post was a paid Google
-- partnership (confirmed via raw.paidPartnership / raw.sponsors). It only
-- dropped out of the top-N/30-day-window rule (migration 005) because it's
-- 49 days old -- a sponsored post inside the window still qualifies today,
-- and ad amplification teaches nothing about what her own hooks do.
-- Stored explicitly and excluded from v_outliers, not left buried in raw.
--
-- 2. Account-health gate: Self Made Millennial's 90-day median vpf is
-- ~0.005 (~245 views/post on ~49k followers). Her "7.4x median" outliers
-- were posts with 1,000-1,800 views -- beating a median that's itself in
-- the noise, not a real signal. A relative multiplier over a broken
-- denominator still produces a big number. Competitors whose own median
-- can't clear MIN_ACCOUNT_MEDIAN_VPF are excluded from v_outliers
-- entirely, and flagged in the registry (visible without a join).
--
-- 3. MIN_OUTLIER_VIEWS: an absolute floor, independent of any account's
-- median -- backstop for the same failure mode at the edges.

alter table competitor_posts add column if not exists paid_partnership boolean;

-- Backfill from already-stored raw payloads -- every post ingested so far
-- came from an actor that reports this field in raw.paidPartnership.
update competitor_posts
set paid_partnership = (raw ->> 'paidPartnership')::boolean
where raw ? 'paidPartnership'
  and paid_partnership is null;

alter table competitors add column if not exists low_median_flag boolean not null default false;

-- v_post_metrics gains paid_partnership (appended at the end, same
-- create-or-replace-safe pattern as migration 004's post_type addition).
create or replace view v_post_metrics as
select
    p.post_id,
    p.competitor_id,
    p.platform_post_id,
    p.posted_at,
    p.views,
    p.likes,
    p.comments,
    p.shares,
    p.followers_at_scrape,
    case
        when p.followers_at_scrape is null or p.followers_at_scrape = 0 then null
        else p.views::numeric / p.followers_at_scrape
    end as vpf,
    case
        when p.views is null or p.views = 0 then null
        else p.comments::numeric / p.views
    end as comment_ratio,
    p.post_type,
    p.paid_partnership
from competitor_posts p;

-- MIN_ACCOUNT_MEDIAN_VPF = 0.02 and MIN_OUTLIER_VIEWS = 5000 in config.ts
-- -- keep both literals in sync if retuned. Output columns are unchanged
-- from migration 005 (only new WHERE conditions), so create-or-replace is
-- safe here without a drop.
create or replace view v_outliers as
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
      and coalesce(m.paid_partnership, false) = false
      and b.baseline_median_vpf >= 0.02
      and m.views >= 5000
      and not exists (
          select 1 from competitor_transcripts t where t.post_id = m.post_id
      )
)
select post_id, competitor_id, posted_at, views, vpf, baseline_median_vpf, outlier_score
from ranked
where rank_in_window <= 5
  and outlier_score >= 2
order by outlier_score desc;
