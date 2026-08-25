/**
 * Every hardcoded threshold in the competitor-analysis pipeline lives here.
 * These get retuned against real data -- change them here, not in the SQL
 * views or scripts. If you change OUTLIER_TOP_N_PER_ACCOUNT,
 * OUTLIER_WINDOW_DAYS, OUTLIER_FLOOR_MULTIPLIER, FOLLOWER_BANDS,
 * SCOREABLE_TIERS, BASELINE_WINDOW_DAYS or BASELINE_MIN_POSTS, also update
 * the matching literal in competitor-pipeline/migrations/002_scoring_views.sql,
 * 005_topn_outliers_t1_exempt.sql and 007_follower_band_gates.sql --
 * Postgres views can't reference a TypeScript constant.
 */

export const config = {
  /**
   * v_outliers selection, replacing the original fixed 2.5x-multiplier-only
   * rule (migration 005). That rule let 6 of 21 in-window posts clear the
   * bar for one account (29% of the corpus) -- transcribing that much
   * stops being "outliers", it's just the median with extra steps, and
   * fills hook_library with unremarkable content.
   *
   * Both conditions must hold: a post has to be in its own competitor's
   * top N by vpf within the window, AND clear the floor multiplier over
   * that competitor's baseline median. Top-N also guarantees the monthly
   * report has rows even in an account's quiet month, which a
   * floor-only rule doesn't -- and the floor keeps a quiet month's "top 5"
   * from including posts that never actually outperformed.
   */
  OUTLIER_TOP_N_PER_ACCOUNT: 5,
  OUTLIER_WINDOW_DAYS: 30,
  OUTLIER_FLOOR_MULTIPLIER: 2,

  /**
   * Account-health gate (migration 006, revised migration 007). First cut
   * used one flat MIN_ACCOUNT_MEDIAN_VPF (0.02) and one flat
   * MIN_OUTLIER_VIEWS (5000) -- wrong, because median vpf scales inversely
   * with follower count and one absolute number can't span a 2k-follower
   * account and a 2.3M-follower account. Under the flat 0.02 floor, Erin
   * McGoff (2.3M followers, median vpf 0.0185 -- ~42k views/post, a
   * healthy account) got wrongly excluded alongside Self Made Millennial
   * (49k followers, median vpf 0.005 -- ~245 views/post, genuinely thin).
   * MIN_OUTLIER_VIEWS alone would have made the right call on its own
   * (kills SMM's 1,000-1,800 view posts, keeps Erin's 172k/238k) -- the
   * flat median gate over-fired on top of it.
   *
   * Replaced with follower-band tiers: each account is bucketed by its
   * most recent follower count (resolved at query time in v_outliers from
   * competitor_snapshots, NOT stored -- accounts move between bands as
   * they grow). small/mid/large get their own min_median_vpf and
   * min_outlier_views. The small band matters beyond today's roster: T2
   * Canadian coaches will land at 1-5k followers, and a flat 5,000-view
   * floor would silently exclude that entire tier the moment handles are
   * verified -- band boundaries and thresholds retune here, not in SQL.
   *
   * maxFollowers is exclusive of the boundary going up to the next band
   * (e.g. exactly 10,000 followers falls in "mid", not "small"); the last
   * band's maxFollowers is Infinity as the catch-all.
   */
  FOLLOWER_BANDS: [
    { name: "small", maxFollowers: 10_000, minMedianVpf: 0.05, minOutlierViews: 1_000 },
    { name: "mid", maxFollowers: 250_000, minMedianVpf: 0.01, minOutlierViews: 5_000 },
    { name: "large", maxFollowers: Infinity, minMedianVpf: 0.005, minOutlierViews: 20_000 },
  ] as const,

  /**
   * Tiers eligible for v_competitor_baseline / v_outliers at all (migration
   * 005). T1 is deliberately excluded: it's a positioning/offer read, a
   * quarterly human review, not a hook corpus -- and T1 accounts post
   * monthly-ish, so they'd rarely-to-never clear BASELINE_MIN_POSTS in a
   * 90-day window anyway (The Self Concept Lab pulled 20 posts and only 4
   * fell in-window). T2/T3 are the actual hook corpus this system exists
   * to mine.
   */
  SCOREABLE_TIERS: ["T2", "T3"] as const,

  /** Trailing window used to compute each competitor's baseline median vpf. */
  BASELINE_WINDOW_DAYS: 90,

  /** Minimum posts in the window required to compute a baseline; below this, baseline is null. */
  BASELINE_MIN_POSTS: 5,

  /** Default posts_per_run by tier, used when a competitor row doesn't override it. */
  POSTS_PER_RUN: {
    T1: 20,
    T2: 20,
    T3: 30,
  } as const,

  /** Scrape cadence by tier, in days -- used by schedule.md and build_run_input.ts watermark logic. */
  SCRAPE_CADENCE_DAYS: {
    weekly: 7,
    fortnightly: 14,
    monthly: 30,
  } as const,

  /** For T3 (format benchmarks), request top-N by views within this trailing window instead of most-recent. */
  T3_TOP_N_WINDOW_DAYS: 90,

  /**
   * Hard monthly Apify spend guard, in USD. build_run_input.ts must refuse
   * to emit run input if the month-to-date estimate exceeds this.
   *
   * Set to $4, deliberately BELOW the account's real Apify plan ceiling of $5 (FREE
   * tier, confirmed via GET /v2/users/me on 2026-08-25:
   * maxMonthlyUsageUsd: 5), so this guard bites first with a clear error
   * message instead of Apify's own platform limit failing a run abruptly
   * mid-harvest with no warning from this codebase. Raise past $4 only
   * after upgrading the Apify plan, and keep this a notch below whatever
   * the real plan ceiling is at the time.
   *
   * Cost estimate at full AU+US roster (12 competitors: 6 AU/T1 + 6 US/T3;
   * several are already correctly inactive -- dormant, <500 followers, or
   * broken handle -- so this is an upper bound, not today's actual spend):
   *   Posts, AU/T1 (weekly, 20 posts/run, mostly-incremental in steady
   *     state): ~$0.25/mo. Posts, US/T3 (monthly, 30 posts/run, full
   *     top-N re-evaluation every run, not incremental): ~$0.50/mo.
   *     Posts total: ~$0.75/mo.
   *   Transcripts (apify/instagram-reel-scraper includeTranscript add-on,
   *     $0.048/started-minute -- confirmed via GET /v2/acts/... pricing on
   *     2026-08-25, far steeper per-unit than posts): only run against
   *     v_outliers, so volume is inherently small and variable. At an
   *     estimated 1-5 outlier reels/month across the full roster,
   *     ~60-120s each: roughly $0.08-$0.50/mo.
   *   Combined estimate: ~$0.85-1.25/mo typical, up to ~$2.5/mo if posting
   *   volume or outlier count runs high. $4 leaves real headroom above
   *   that while still catching a genuine runaway before Apify's own wall.
   */
  MONTHLY_APIFY_SPEND_CAP_USD: 4,

  /**
   * Per-item cost estimates used only for the spend-guard check, not
   * billing. Sourced from real Apify pricing (FREE tier) confirmed via the
   * API on 2026-08-25, not guessed: profile $0.0026/call
   * (apify/instagram-profile-scraper), post $0.0027/post
   * (apify/instagram-post-scraper, detailedData -- required, see
   * apify/actors.json), transcript ~$0.05 for a ~1-minute reel
   * (apify/instagram-reel-scraper, $0.048/started-minute + a small base
   * reel charge -- actual cost scales with reel length, this is a rough
   * per-transcript planning figure, not a formula).
   */
  ESTIMATED_COST_PER_PROFILE_USD: 0.0026,
  ESTIMATED_COST_PER_POST_USD: 0.0027,
  ESTIMATED_COST_PER_TRANSCRIPT_USD: 0.05,

  /**
   * Dormancy rules for the verification worksheet (scripts/verification_worksheet.ts)
   * and whoever fills it in. An account tripping either of these can't clear
   * BASELINE_MIN_POSTS in a useful window and should be set active = false --
   * it burns scrape budget and returns nulls from v_competitor_baseline.
   */
  DORMANCY_MAX_DAYS_SINCE_LAST_POST: 90,
  DORMANCY_MIN_FOLLOWERS: 500,
};

export type Config = typeof config;
