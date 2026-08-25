-- Scoring views for the competitor-analysis pipeline.
--
-- The chain: v_post_metrics (raw ratios) -> v_competitor_baseline (per-
-- competitor "normal" performance) -> v_outliers (posts that beat their
-- own competitor's normal by a wide margin) -> v_hook_report (the monthly
-- human-readable read).
--
-- All thresholds referenced in comments below (2.5x, 90 days, 5-post
-- minimum) are also defined in config.ts for the TypeScript side. Keep
-- them in sync if you retune one.

-- v_post_metrics -----------------------------------------------------------
-- Joins each post to the nearest-in-time snapshot for its competitor
-- (the closest snapshot at or before the post's scrape) and computes:
--   vpf           = views per follower, at the time the post was scraped.
--                   This is what lets us compare a 5k-follower account's
--                   50k-view reel against a 500k-follower account's
--                   200k-view reel on equal footing.
--   comment_ratio = comments per view, a rough engagement-depth signal.
-- Both are null-safe: if followers is 0, missing, or there is no snapshot
-- at or before the post, vpf is null rather than throwing a divide error.

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
    s.snapshot_id,
    s.followers,
    s.scraped_at as snapshot_scraped_at,
    case
        when s.followers is null or s.followers = 0 then null
        else p.views::numeric / s.followers
    end as vpf,
    case
        when p.views is null or p.views = 0 then null
        else p.comments::numeric / p.views
    end as comment_ratio
from competitor_posts p
left join lateral (
    select snapshot_id, followers, scraped_at
    from competitor_snapshots s
    where s.competitor_id = p.competitor_id
      and s.scraped_at <= p.last_scraped_at
    order by s.scraped_at desc
    limit 1
) s on true;

-- v_competitor_baseline ------------------------------------------------
-- Per competitor, the median vpf over posts from the last 90 days.
-- Median (not mean) so one viral outlier doesn't drag the baseline up and
-- hide itself. Requires at least 5 posts in the 90-day window; below that
-- a median isn't a meaningful "normal" for the account, so this returns
-- null rather than a noisy baseline.

create or replace view v_competitor_baseline as
select
    competitor_id,
    percentile_cont(0.5) within group (order by vpf) as baseline_median_vpf,
    count(*) as posts_in_window
from v_post_metrics
where posted_at >= now() - interval '90 days'
  and vpf is not null
group by competitor_id
having count(*) >= 5;

-- v_outliers -------------------------------------------------------------
-- This view is the transcription queue. Transcribing every post triples
-- Apify spend and teaches nothing about what's actually working — only
-- posts that beat their own competitor's normal by 2.5x or more get a
-- second pass, and only if they haven't been transcribed already.
--   outlier_score = vpf / baseline_median_vpf
--   e.g. a score of 4.0 means "this post got 4x the views-per-follower
--   this competitor's typical post gets" — a strong signal something
--   about the hook, format or topic is unusually effective.

create or replace view v_outliers as
select
    m.post_id,
    m.competitor_id,
    m.posted_at,
    m.views,
    m.vpf,
    b.baseline_median_vpf,
    m.vpf / b.baseline_median_vpf as outlier_score
from v_post_metrics m
join v_competitor_baseline b on b.competitor_id = m.competitor_id
where m.vpf is not null
  and m.vpf / b.baseline_median_vpf >= 2.5
  and not exists (
      select 1 from competitor_transcripts t where t.post_id = m.post_id
  )
order by outlier_score desc;

-- v_hook_report ------------------------------------------------------------
-- The monthly read: top 15 hooks tagged in the last 30 days, ranked by
-- outlier_score, with competitor context attached.

create or replace view v_hook_report as
select
    h.hook_id,
    h.hook_pattern,
    h.format,
    h.topic_slug,
    h.opening_line,
    h.outlier_score,
    h.vpf,
    h.au_transplant,
    h.transplant_note,
    c.name as competitor_name,
    c.tier,
    c.market,
    h.tagged_at
from hook_library h
join competitors c on c.competitor_id = h.competitor_id
where h.tagged_at >= now() - interval '30 days'
order by h.outlier_score desc
limit 15;
