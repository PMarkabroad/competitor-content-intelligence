-- Two fixes from the first real hook_library row.
--
-- 1. au_transplant was answering the wrong question. It said 'yes' for a
-- hook whose actual content ("three times it's okay to lie in a job
-- interview") is correct on MARKET fit (the pattern/structure works in
-- AU) but completely wrong on WHETHER ARK WOULD EVER SAY IT: this
-- audience's employment and visa standing depends on what they tell
-- employers, and advising strategic dishonesty is materially risky and
-- off-voice. Market fit and brand fit are different questions and were
-- being collapsed into one field. Split:
--   au_transplant  -- unchanged meaning: does this PATTERN work in AU
--   brand_fit      -- new: would Ark actually say this, checked against
--                     /arkabroad-voice (yes / no / with_changes)
--   brand_fit_note -- new: why
--
-- 2. is_repost: the tagged row's own caption says "Revisiting some
-- favorites while on maternity leave" -- a repost during a posting gap
-- gets algorithmic resurfacing to a wider audience than its original run,
-- which can produce a high vpf that reflects distribution mechanics, not
-- a hook landing today. Excluded from v_outliers the same way
-- paid_partnership already is (migration 006) -- same shape of problem,
-- same fix. Backfilled here via a caption heuristic (ILIKE, best-effort:
-- there's no structured "is this a repost" field in the actor's output,
-- so this catches explicit self-disclosure in the caption, not every
-- repost -- a caption that doesn't mention it will read as false here).

alter table hook_library add column if not exists brand_fit text
  check (brand_fit in ('yes', 'no', 'with_changes'));
alter table hook_library add column if not exists brand_fit_note text;

alter table competitor_posts add column if not exists is_repost boolean;

update competitor_posts
set is_repost = true
where is_repost is null
  and caption is not null
  and (
    caption ilike '%revisit%'
    or caption ilike '%repost%'
    or caption ilike '%re-post%'
    or caption ilike '%throwback%'
    or caption ilike '%flashback%'
    or caption ilike '%resharing%'
    or caption ilike '%re-sharing%'
    or caption ilike '%from the archive%'
  );

-- v_post_metrics gains is_repost (appended, create-or-replace-safe, same
-- pattern as post_type/paid_partnership in migrations 004/006).
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
    p.paid_partnership,
    p.is_repost
from competitor_posts p;

-- v_outliers: exclude is_repost the same way paid_partnership already is.
-- Output columns unchanged from migration 007 -- create-or-replace is safe.
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

-- v_hook_report: show brand_fit + brand_fit_note, and exclude brand_fit
-- = 'no' from the report entirely -- "nothing with brand_fit='no' goes
-- into a report sent to anyone" is enforced here, not left as a note for
-- whoever generates the report to remember. `is distinct from` (not !=)
-- so an untagged row (brand_fit still null) is NOT excluded -- only an
-- explicit 'no' verdict is.
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
    h.tagged_at,
    h.brand_fit,
    h.brand_fit_note
from hook_library h
join competitors c on c.competitor_id = h.competitor_id
where h.tagged_at >= now() - interval '30 days'
  and h.brand_fit is distinct from 'no'
order by h.outlier_score desc
limit 15;

-- Backfill the one existing hook_library row from this session.
update hook_library
set brand_fit = 'no',
    brand_fit_note = 'advises misrepresentation; off-voice and materially risky for a migrant audience.'
where post_id = 'e78378d1-e98b-4564-9cfd-085324d6a26c';
