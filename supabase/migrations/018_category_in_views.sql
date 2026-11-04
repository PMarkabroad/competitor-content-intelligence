-- Exposes competitors.category through the views the dashboard reads, so
-- viral_creator performance can be excluded from benchmark rankings.
--
-- Note what the skew actually is. v_competitor_baseline groups BY
-- competitor_id, so each account's median is its own -- a viral account
-- cannot drag a niche account's baseline, and that view needs no change.
-- The distortion is in the POOLED rankings: "hook patterns that are
-- working" averages outlier scores across every account at once, so a
-- lifestyle reel that went 400x against its own modest baseline outranks a
-- career coach's genuinely strong 12x. Those are the numbers that decide
-- what Ark makes next, and they are the ones that need the filter.
--
-- Adding the column to the views rather than filtering inside them: the
-- dashboard decides what to include, so one view serves both "benchmarks"
-- (niche only) and "what is going viral anywhere" (everything).

drop view if exists v_hook_report;
create view v_hook_report as
select
    h.hook_id, h.hook_pattern, h.format, h.topic_slug, h.opening_line,
    h.outlier_score, h.vpf, h.au_transplant, h.transplant_note,
    c.name as competitor_name, c.tier, c.market, c.category,
    h.tagged_at, h.brand_fit, h.brand_fit_note
from hook_library h
join competitors c on c.competitor_id = h.competitor_id
where h.tagged_at >= (now() - '30 days'::interval)
  and h.brand_fit is distinct from 'no'
order by h.outlier_score desc
limit 15;

drop view if exists v_competitor_summary;
create view v_competitor_summary as
select
    c.competitor_id, c.name, c.handle, c.platform, c.market, c.tier,
    c.category, c.active, c.handle_verified, c.last_scraped_at,
    b.baseline_median_vpf, b.posts_in_window
from competitors c
left join v_competitor_baseline b on b.competitor_id = c.competitor_id;
