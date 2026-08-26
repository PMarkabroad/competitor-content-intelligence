# Orchestration schedule

Describes the intended cron setup. **The runner script (`scheduled_harvest.ts`)
is built and verified against real accounts (2026-08-26) — no OS-level
schedule (cron/Task Scheduler/Apify Scheduler) has been registered to call
it automatically yet.** That's still a deliberate, separate decision left
open below, since it means real, unattended recurring spend.

## Harvest cadence, by tier

| Tier | Cadence | Trigger | Runs |
|---|---|---|---|
| T1 | Weekly | e.g. Monday 06:00 AEST | Not wired to this scheduler -- stays manual (see note below) |
| T2 | Fortnightly | Same day, every 2nd week | `npm run scheduled-harvest -- --tier T2` |
| T3 | Monthly | 1st of the month | `npm run scheduled-harvest -- --tier T3` |

T1 is exempt from scoring (`SCOREABLE_TIERS` in `config.ts` is `["T2","T3"]`
only) and was deliberately left off this scheduler -- see Prompt 4 Step 3.

`scripts/scheduled_harvest.ts` (single script, platform-aware) replaces the
originally-planned `build_run_input.ts` + webhook-`ingest.ts` split for the
scheduled path -- `build_run_input.ts` still exists and is useful for
eyeballing a run's shape/estimated cost before committing to it, but its own
cap check only compares its estimate against the *full* cap, not remaining
budget, so it is not spend-safe to run unattended on its own.

Each scheduled run:
1. Reads active, handle-verified competitors for that tier (AU/US only --
   CA stays `active=false` and out of scope regardless).
2. Checks REAL month-to-date Apify spend (not just this run's estimate)
   against `MONTHLY_APIFY_SPEND_CAP_USD`. If spend + this run's estimate
   would exceed the cap, the run is **skipped** (loud log to stdout +
   `logs/scheduled-harvest-<date>.log`), not failed and not run partially.
3. Branches per competitor by `platform`:
   - `instagram`: `actors.profile` + `actors.posts` (one call each per
     competitor), incremental via `onlyPostsNewerThan`.
   - `tiktok`: ALL tiktok competitors sharing the same since-date are
     batched into ONE `actors.tiktokPosts` call (`profiles` mode) --
     this actor has a $0.50-per-run minimum charge, so one call per
     competitor would multiply that minimum unnecessarily (confirmed via
     the pricing API, see `apify/actors.json`'s comments). Author-level
     fields (`authorMeta.fans` etc.) are normalized into the same profile
     shape Instagram produces; no separate TikTok profile call is needed.
4. Upserts into `competitor_snapshots` / `competitor_posts` via
   `ingest.ts`'s `ingestProfile`/`ingestPost`, same as the webhook path.
5. Flags (loud log) any active, in-scope competitor whose run was a FULL
   pull (`last_scraped_at` was null going in) that returned zero post
   rows. An incremental pull returning zero rows is NOT flagged -- that's
   the routine, expected outcome of a quiet posting window on a
   fortnightly/monthly cadence, confirmed for real on the second of this
   session's two back-to-back T2 test runs (2 of 3 accounts correctly
   returned "no new posts" a few minutes after their first harvest, with
   no genuine problem).

## Transcription pass

Runs **24 hours after each harvest**, once metrics have had time to settle
and `v_outliers` has something to queue:

1. Query `v_outliers` (defined in `migrations/002_scoring_views.sql`) —
   posts scoring >= `OUTLIER_SCORE_THRESHOLD` (currently 2.5x baseline)
   that don't already have a transcript.
2. For each, call the Apify `transcript` actor against the post URL.
3. The webhook fires `ingest.ts` with `meta.postId` set, which upserts
   into `competitor_transcripts`.

This pass is intentionally decoupled from the harvest — it only ever
processes outliers, never the full post volume, per the spend rationale in
`migrations/002_scoring_views.sql`.

## After transcription: hook tagging

Tagging rows into `hook_library` (hook_pattern, format, topic_slug,
au_transplant, etc.) is a manual/human step against `competitor_transcripts`
+ `competitor_posts`, not automated here. `v_hook_report` is what a human
reads monthly once tagging has happened.

## Not covered here

- Registering `npm run scheduled-harvest -- --tier <T2|T3>` with an actual
  OS-level/cloud scheduler (Windows Task Scheduler, Apify Scheduler,
  GitHub Actions cron, etc.) — the runner itself is built and verified,
  but wiring it to fire unattended is a separate decision (real,
  autonomous recurring spend against a live Apify account), left open on
  purpose rather than assumed.
- Retry/backoff policy for failed Apify runs.
- Alerting destination for the zero-rows-on-full-pull flag beyond stdout +
  `logs/` (e.g. wiring it to Slack) — not built yet.
