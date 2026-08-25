# Orchestration schedule

Describes the intended cron setup. **No live schedules have been created —
this is documentation only**, for whoever wires up the actual scheduler
(Apify's own scheduler, GitHub Actions, a cron box, etc).

## Harvest cadence, by tier

| Tier | Cadence | Trigger | Runs |
|---|---|---|---|
| T1 | Weekly | e.g. Monday 06:00 AEST | `build_run_input.ts --tier T1` → Apify `posts` + `profile` actors → `ingest.ts` |
| T2 | Fortnightly | Same day, every 2nd week | `build_run_input.ts --tier T2` → same actors → `ingest.ts` |
| T3 | Monthly | 1st of the month | `build_run_input.ts --tier T3` → same actors, `sortByViewsWindowDays` set → `ingest.ts` |

Each tier's run:
1. `build_run_input.ts --tier <T1|T2|T3>` reads active, handle-verified
   competitors for that tier and emits run input JSON (refuses to run if
   the spend guard in `config.ts` would be exceeded).
2. That JSON drives the Apify `profile` and `posts` actors (see
   `apify/actors.json`).
3. Each actor run's webhook fires `ingest.ts`, which upserts into
   `competitor_snapshots` / `competitor_posts` and flags any T1 account
   that returned zero rows.

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

- The actual scheduler implementation (Apify Scheduler vs GitHub Actions
  cron vs something else) — a deliberate choice left open.
- Retry/backoff policy for failed Apify runs.
- Alerting destination for the T1-zero-rows flag beyond stdout + `logs/`
  (e.g. wiring it to Slack) — not built yet.
