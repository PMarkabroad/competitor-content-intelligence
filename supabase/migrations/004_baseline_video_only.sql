-- Explicitly restricts v_competitor_baseline to video/reel posts, instead
-- of relying on the incidental fact that carousels and images structurally
-- never get a view count from the Instagram actors currently in use.
--
-- The 5-post minimum was already correct: v_competitor_baseline's `where
-- vpf is not null` runs before its `having count(*) >= 5`, so the count
-- only ever sees rows that already cleared the vpf-not-null filter --
-- confirmed by reading the SQL, no fix needed there.
--
-- But that filter's effectiveness today is an accident of what Instagram
-- happens to report, not a stated rule. A future actor version, a
-- different platform (TikTok/YouTube are both in the platform check
-- constraint on competitors.platform), or an Instagram API change that
-- starts reporting a view-like metric on carousels would silently pull
-- non-video content into the baseline with no error -- this is a
-- reel-performance system, and the baseline should say so explicitly
-- rather than rely on non-video content coincidentally always being null.

-- v_post_metrics gains post_type (appended at the end -- create or replace
-- view can add trailing columns without dropping/recreating dependents).
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
    p.post_type
from competitor_posts p;

-- post_type values observed so far (Instagram, apify/instagram-post-scraper):
-- 'Video' (raw.productType 'clips'), 'Sidecar' (carousel), 'Image'.
-- TikTok/YouTube actors aren't wired up yet (see apify/README.md) and will
-- likely use different vocabulary -- extend this list when that happens,
-- rather than assuming lower(post_type) = 'video' covers every platform.
create or replace view v_competitor_baseline as
select
    competitor_id,
    percentile_cont(0.5) within group (order by vpf) as baseline_median_vpf,
    count(*) as posts_in_window
from v_post_metrics
where posted_at >= now() - interval '90 days'
  and vpf is not null
  and lower(post_type) = 'video'
group by competitor_id
having count(*) >= 5;
