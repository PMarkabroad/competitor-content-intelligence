# Orchestration schedule

Describes the cron setup. **Wired up on 2026-09-04**: the trigger is
`.github/workflows/scheduled-harvest.yml`, running on GitHub Actions so it
no longer depends on anyone's laptop being awake. Times there are UTC, since
GitHub cron has no timezone.

This means real, unattended recurring spend -- roughly $5/month at 58
accounts. The guard is `MONTHLY_APIFY_SPEND_CAP_USD`, checked against REAL
month-to-date spend before a run starts. Note its limit: it compares spend
against an ESTIMATE beforehand and cannot stop a run that overshoots
mid-flight. That is exactly how spend reached $29.07 against a $29 cap on
2026-09-04, so the cap is now set below the real ceiling on purpose.

## Harvest cadence, by tier

| Stage | Trigger | Runs |
|---|---|---|
| T1 | -- | Not wired to this scheduler -- stays manual (see note below) |
| T2 harvest | Sunday 19:00 UTC | `npm run scheduled-harvest -- --tier T2` |
| T3 harvest | Sunday 20:00 UTC | `npm run scheduled-harvest -- --tier T3` |
| Content | Sunday 21:00 UTC | `transcribe-outliers --instagram --limit=25`, then `draft-hook-tags`, then `generate-from-analysis --count=8` (which chains into `generate-formats`) |

The content chain was added 2026-09-04. Before it, the scheduler collected
rows and stopped: Monday brought fresh competitor posts but no new hooks and
nothing to publish, which is most of the point. Every step runs with
continue-on-error so one failure costs a stage rather than the night --
if transcription dies, hooks that already have transcripts still get tagged.

Two caps are deliberate. `--limit=25` on transcription bounds Apify spend on
a week with an unusual number of outliers; the script's own spend guard is
the other half. `--count=8` on generation exists because Anthropic has no
spend ceiling the way Apify does, and an unbounded weekly generator would
pile up drafts faster than anyone can publish them.

Changed from T2-fortnightly / T3-monthly to weekly on 2026-09-04, so that
Monday morning always opens on data collected the night before. Sunday
19:00 and 20:00 UTC are Monday 05:00 and 06:00 in Melbourne (an hour later
under daylight saving), so both have finished before anyone looks.

Weekly is affordable because harvests are incremental: a T2 run one day
after the previous one returned 17 new post rows for $0.18, against a $1.84
estimate. The estimate prices a full pull; the watermark means most runs are
nowhere near it. What weekly does raise is the floor -- the TikTok actor
charges a $0.50 per-run minimum whether it finds anything or not, so the
realistic cost is roughly $3-6/month rather than the ~$5 of the old
cadence.

T1 is exempt from scoring (`SCOREABLE_TIERS` in `config.ts` is `["T2","T3"]`
only) and was deliberately left off this scheduler -- see Prompt 4 Step 3.

`scripts/scheduled_harvest.ts` (single script, platform-aware) replaces the
originally-planned `build_run_input.ts` + webhook-`ingest.ts` split for the
scheduled path -- `build_run_input.ts` still exists and is useful for
eyeballing a run's shape/estimated cost before committing to it, but its own
cap check only compares its estimate against the *full* cap, not remaining
budget, so it is not spend-safe to run unattended on its own.

Each scheduled run:
1. Reads active, handle-verified competitors for that tier. All markets --
   `active=true` is the only thing that scopes it. This used to say "AU/US
   only, CA stays active=false", which was true when written and is not any
   more: there are 12 active CA accounts. A hardcoded market allowlist in
   scheduled_harvest.ts silently excluded newly-approved CA accounts from
   every run once that changed, and was removed on 2026-08-26.
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
