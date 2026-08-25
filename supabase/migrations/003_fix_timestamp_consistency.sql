-- Fixes a real bug found by smoke_test.ts: the very first smoke test run
-- against theselfconceptlab produced 5 posts with vpf = null, because
-- v_post_metrics's join required snapshot.scraped_at <= post.last_scraped_at,
-- and the two timestamps came from different clocks -- competitor_snapshots
-- relied on Postgres's own `default now()`, while competitor_posts used a
-- client-computed `new Date().toISOString()`. Measured skew between the
-- Supabase Postgres server clock and the ingesting machine's clock was
-- ~3-4 seconds (server ahead), confirmed via a single REST round-trip
-- using the response Date header on 2026-08-25, isolated from connection
-- setup latency. That's enough to invert the ordering within one harvest
-- batch and silently null out vpf for every post in it.
--
-- Three changes, not one -- the clock-skew trigger fixes today's bug, but
-- the join itself was always going to misattribute vpf over time even
-- with perfectly synced clocks: last_scraped_at updates on every re-scrape,
-- so a post ingested in week 1 would silently get re-pointed at week 4's
-- snapshot on its next re-scrape, changing its historical vpf after the
-- fact. The denominator has to be frozen at capture time, not looked up
-- dynamically at query time.

-- 0. New columns first, so the trigger functions below (which reference
-- them) are readable top-to-bottom without forward references.

alter table competitor_posts add column if not exists followers_at_scrape bigint;
alter table competitor_snapshots add column if not exists run_id uuid;
alter table competitor_posts add column if not exists run_id uuid;

-- 1. Force server-side now() for both timestamp columns, so no future
-- ingest path -- however it computes its own client timestamp -- can
-- reintroduce clock-skew-driven ordering bugs for OTHER columns that
-- still care about wall-clock ordering (last_scraped_at is still used to
-- pick "what changed since the last harvest" elsewhere, so it still
-- needs to be trustworthy, just not as the vpf join key anymore).

create or replace function set_server_timestamp_scraped_at()
returns trigger as $$
begin
  new.scraped_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_competitor_snapshots_scraped_at
before insert on competitor_snapshots
for each row execute function set_server_timestamp_scraped_at();

-- Combined with the followers_at_scrape freeze: on UPDATE (a re-scrape
-- upsert), last_scraped_at always advances to now(), but
-- followers_at_scrape is pinned back to whatever it was first set to,
-- regardless of what the upsert tries to write. This has to be a DB-level
-- guarantee, not application discipline in ingest.ts -- an upsert that
-- passes a fresh followers_at_scrape on every re-scrape would silently
-- reproduce the exact bug this migration exists to fix, just moved from
-- query time to ingest time.

create or replace function set_server_timestamp_and_freeze_followers()
returns trigger as $$
begin
  new.last_scraped_at = now();
  if tg_op = 'UPDATE' and old.followers_at_scrape is not null then
    new.followers_at_scrape = old.followers_at_scrape;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_competitor_posts_last_scraped_at
before insert or update on competitor_posts
for each row execute function set_server_timestamp_and_freeze_followers();

-- 2. Freeze the vpf denominator at capture time instead of joining to
-- competitor_snapshots at query time. followers_at_scrape is populated by
-- ingest.ts from the most recent snapshot for that competitor at the
-- moment each post is ingested -- once written (and after the trigger
-- above pins it), it never changes on re-scrape, so a post's historical
-- vpf stays stable even as the competitor's follower count moves over
-- subsequent harvests.
--
-- v_post_metrics is dropping columns (snapshot_id, followers,
-- snapshot_scraped_at) that existed in 002's version, and Postgres refuses
-- `create or replace view` when the column set shrinks. Drop and recreate
-- top-down through the dependency chain instead
-- (v_outliers -> v_competitor_baseline -> v_post_metrics), then rebuild
-- bottom-up. v_competitor_baseline and v_outliers are otherwise unchanged
-- from 002 -- they only ever consumed v_post_metrics's
-- post_id/competitor_id/posted_at/vpf columns, all still present under the
-- same names.

drop view if exists v_outliers;
drop view if exists v_competitor_baseline;
drop view if exists v_post_metrics;

create view v_post_metrics as
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
    end as comment_ratio
from competitor_posts p;

create view v_competitor_baseline as
select
    competitor_id,
    percentile_cont(0.5) within group (order by vpf) as baseline_median_vpf,
    count(*) as posts_in_window
from v_post_metrics
where posted_at >= now() - interval '90 days'
  and vpf is not null
group by competitor_id
having count(*) >= 5;

create view v_outliers as
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

-- 3. run_id: which ingest run wrote each row, for provenance/debugging.
-- Generated client-side (crypto.randomUUID()) once per script invocation
-- in ingest.ts / smoke_test.ts -- not the same as Apify's own run id,
-- which isn't a valid uuid, but groups everything one script invocation
-- wrote. Columns were added in step 0 above.
