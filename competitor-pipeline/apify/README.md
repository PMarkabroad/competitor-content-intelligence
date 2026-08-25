# Apify actor configuration

`actors.json` maps three pipeline roles — `profile`, `posts`, `transcript` —
to specific Apify actors, each pinned as `{actorId, build}`:

```json
"profile": { "actorId": "apify/instagram-profile-scraper", "build": "0.0.587", ... }
```

All three are pinned as of 2026-08-25 (see each entry's `pinnedAt` /
`verifiedVia` fields). If they're back to `REPLACE_ME`, someone reset them.

## Why `build`, not a colon-embedded version tag

`build` is Apify's own exact build number for an actor (e.g. `0.0.587`),
confirmed live via `GET /v2/acts/<owner>~<name>` at pin time — it's the
actor's own `taggedBuilds.latest.buildNumber` at that moment, captured so
it stops moving. **Every API call must pass `build=<pinned value>` as an
explicit query param.** Never omit it and never pass `latest` — omitting
it (or passing `latest`) lets Apify silently serve whatever the actor's
newest build happens to be at call time, which defeats the entire point of
pinning.

This matters beyond style. Instagram/TikTok scraping actors on the Apify
store get deprecated, renamed, and have their output schema changed
without notice fairly often — that's the nature of scraping a platform
that actively fights scrapers. If a call ever drifts to `latest`, a silent
actor update upstream can silently change output field names, and
`ingest.ts` will either fail loudly (best case) or silently insert garbage
into `raw` and leave the typed columns null (worst case).

Pinning a specific build means:
- A broken/renamed actor fails the run visibly, instead of degrading ingest.
- You choose when to take an upstream actor update, after checking its
  output schema still matches what `ingest.ts` expects.
- Any follower count, view count, etc. pulled through this pipeline is
  reproducible after the fact — you can point at exactly which actor build
  produced a given number. This is why `verification_worksheet.ts` has a
  `source_actor` column: `followers` is the scoring denominator for `vpf`
  everywhere downstream, and an unreproducible denominator undermines the
  whole scoring chain.

## Re-pinning (when an actor is deprecated, or periodically for freshness)

```bash
APIFY_TOKEN=<token>
curl -s "https://api.apify.com/v2/acts/<owner>~<name>?token=$APIFY_TOKEN" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.data.taggedBuilds.latest.buildNumber)})"
```

Confirm the actor's live input schema hasn't changed (`GET
/v2/acts/<owner>~<name>/builds/default`, look at `inputSchema`) before
updating `actors.json` and the corresponding input-shape code in
`smoke_test.ts` / `build_run_input.ts`.

## What each role needs, output-wise

- **profile** — one profile snapshot per run: followers, following,
  post_count, bio. Feeds `competitor_snapshots`. Input: `{ usernames: [...] }`.
- **posts** — a list of recent posts with platform_post_id, post_url,
  post_type, caption, posted_at, views, likes, comments, shares,
  duration_seconds. Needs incremental/since-date support and a result cap.
  Feeds `competitor_posts`. Input: `{ username: [...], resultsLimit, onlyPostsNewerThan, dataDetailLevel }`.
- **transcript** — given one post URL, a transcript with enough timing
  structure to derive `opening_line` and `seconds_to_first_claim` (segment
  or word-level timestamps, not just flat text). Feeds
  `competitor_transcripts`. Only run against `v_outliers` rows, and only
  applicable to video/reel posts (a carousel or static-image outlier has
  no audio — `v_outliers` doesn't currently filter by post_type, which is
  a known gap to close before wiring transcript ingest at volume). Input:
  `{ username: [<post-url>], includeTranscript: true }`, billed per minute
  of audio.

See the `_comment` field on each entry in `actors.json` for the same detail
inline, plus any open gaps noted there (e.g. the transcript actor's output
field names for the transcript itself hadn't been confirmed against a real
response as of pinning).
