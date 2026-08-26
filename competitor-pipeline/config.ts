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
   * TikTok-specific bands for scripts/discover.ts, separate from
   * FOLLOWER_BANDS above (which stays Instagram-only, unchanged, and is
   * also baked directly into v_outliers's SQL -- migration 007).
   *
   * The AU discovery sweep (2026-08-26) showed FOLLOWER_BANDS's floors are
   * essentially a no-op on TikTok: 46 of 49 gated candidates with a
   * non-null median (94%) cleared their band's floor, most by 10-75x
   * margin. TikTok view counts include passive feed-scroll impressions
   * that Instagram's algorithm doesn't surface the same way, so vpf runs
   * far higher across the board -- Instagram's floors, calibrated from
   * Instagram data, don't transfer.
   *
   * Derivation: each band's floor is set at that band's own median vpf
   * from the 50-candidate real distribution (values below, computed
   * 2026-08-26), not an arbitrary multiple of the Instagram floor --
   *   small (n=30, <10k followers): median vpf ~0.477 -> floor 0.40
   *     (just under the median, filters ~half of the small-band pool)
   *   mid (n=17, 10k-250k followers): median vpf ~0.070 -> floor 0.07
   *     (matches the observed median almost exactly)
   *   large (n=2, >=250k followers): only 2 data points (0.062, 0.122) --
   *     too thin to derive a real floor with confidence. Proposing 0.03
   *     (~6x the Instagram large floor, a conservative order-of-magnitude
   *     scale-up rather than a data-fitted number) and flagging this for
   *     revisit once more large-follower TikTok candidates are gated.
   *
   * Note this fixes a broken GATE, not the shortlist's relevance problem
   * -- a p50-ish floor still lets through roughly half the pool by
   * definition, lifestyle vloggers included. Relevance is --classify's
   * job (see stageClassify in discover.ts), not this floor's.
   */
  DISCOVERY_FOLLOWER_BANDS: [
    { name: "small", maxFollowers: 10_000, minMedianVpf: 0.40 },
    { name: "mid", maxFollowers: 250_000, minMedianVpf: 0.07 },
    { name: "large", maxFollowers: Infinity, minMedianVpf: 0.03 },
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

  /**
   * Discovery pass (migration 008, scripts/discover.ts). TikTok is the
   * primary discovery and hook-corpus platform: native keyword search,
   * every post is video with a view count, no carousel problem. All three
   * failures that broke the original T3 Instagram roster -- pinned posts
   * producing false-dormancy reads, private accounts invisible until
   * scrape time, carousel-only accounts structurally unable to produce
   * vpf -- are Instagram-specific. T1 AU stays on Instagram: it's read for
   * positioning/offers/objection language, not scored for performance.
   */
  DISCOVERY_PLATFORM: "tiktok" as const,

  /**
   * Hard gates applied in the --gate stage of discover.ts. Fail any one
   * and the candidate is discarded (gate_result='fail', gate_fail_reason
   * names which one, so it's possible to tell whether the roster is
   * failing on dormancy, size, or content type). minMedianVpf reuses
   * FOLLOWER_BANDS above rather than duplicating a separate threshold --
   * a candidate is held to the same bar an account already in the roster
   * would be.
   */
  DISCOVERY_GATES: {
    minVideoPosts90d: 8,
    minFollowers: 1_000,
    maxDaysSinceLastPost: 30,
    validMarkets: ["AU", "CA", "US"] as const,
  },

  /**
   * Volume controls. SEARCH_RESULTS_PER_QUERY is
   * clockworks/tiktok-scraper's resultsPerPage applied to the --search
   * stage (videos+profiles per seed query). GATE_MAX_POSTS_PER_CANDIDATE
   * is the same field applied per-candidate in --gate. minVideoPosts90d
   * above requires 8 in-window video posts to pass, so this cap needs
   * enough margin over 8 to actually see whether an account clears it.
   *
   * Raised from 10 to 25 on 2026-08-26 (discovery pass, revision 2):
   * TikTok search author-duplicates heavily within a thematically
   * clustered query set (all 15 queries per market orbit the same 6 topic
   * slugs), so the top ~10 results per query converge on the same
   * handful of head accounts across queries. Estimated unique-handle
   * yield (unconfirmed until a real --search run -- this is the thing the
   * AU sweep is meant to calibrate):
   *   R=10: ~150 raw results/market, ~55-65 unique handles/market
   *         (top results converge heavily; ~35-45% unique)
   *   R=25: ~375 raw results/market, ~100-130 unique handles/market
   *         (the deeper 15 results/query are less likely to repeat the
   *         same head accounts, so uniqueness improves in the tail --
   *         yield grows ~1.7-2.2x, not the full 2.5x raw-result increase)
   *
   * Gate stage now runs AFTER --profile's cheap gates (followers,
   * is_private, last_post_at) pre-filter the pool -- see
   * DISCOVERY_GATE_MAX_POSTS_PER_CANDIDATE below and stageGate in
   * discover.ts. Full worked cost estimate is in
   * MONTHLY_APIFY_SPEND_CAP_USD's comment further down.
   */
  DISCOVERY_SEARCH_RESULTS_PER_QUERY: 25,
  DISCOVERY_GATE_MAX_POSTS_PER_CANDIDATE: 10,

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
   *   volume or outlier count runs high.
   *
   * Raised to $12 to cover a full discovery sweep (migration 008,
   * discover.ts), revised 2026-08-26 (revision 2) after splitting --gate
   * into a cheap stage (--profile: followers/is_private/last_post_at,
   * $0.003/result) and an expensive stage (--gate: video_posts_90d/
   * median_vpf_90d, needs a full post pull, $0.0037/result) -- cheap gates
   * eliminate candidates BEFORE the expensive post pull, instead of
   * pulling posts for every candidate and discarding most of them.
   * Pricing confirmed via the Apify API on 2026-08-26, not guessed;
   * unique-candidate and cheap-gate-pass-rate figures are estimates, not
   * yet confirmed by a real run -- see DISCOVERY_SEARCH_RESULTS_PER_QUERY
   * above for the unique-yield reasoning.
   *
   * Full 3-market sweep at R=25 (raised from R=10 alongside this split --
   * see DISCOVERY_SEARCH_RESULTS_PER_QUERY):
   *   --search:  45 queries x 25 results x $0.0037 = ~$4.16
   *   --profile: ~330 unique candidates (110/market est.) x 1 result x
   *              $0.003 = ~$0.99
   *   --gate:    ~50% estimated cheap-gate pass rate -> ~165 candidates x
   *              GATE_MAX_POSTS_PER_CANDIDATE (10) x $0.0037 = ~$6.11
   *   Full-sweep total: ~$4.16 + $0.99 + $6.11 = ~$11.26
   *
   * For comparison, the same split at the original R=10 (i.e. holding
   * search breadth fixed, isolating just the cheap/expensive split's
   * effect): ~180 unique candidates, --profile ~$0.54, --gate at ~50%
   * pass-rate ~90 x 10 x $0.0037 = ~$3.33 (down from ~$6.66 when every
   * profiled candidate went straight to the expensive stage -- roughly
   * half, or closer to a third at a ~33% pass rate; the exact figure
   * depends on the real cheap-gate pass rate, unconfirmed until a real
   * run). Search $1.67 + profile $0.54 + gate $3.33 = ~$5.54 total, down
   * from the original ~$8.87 estimate for the same R=10 breadth.
   *
   * IMPORTANT: the account switched from personal to an organizational
   * Apify account on 2026-08-26 -- still FREE tier, still a real $5/month
   * platform ceiling (confirmed via GET /v2/users/me against the org
   * account: tier FREE, maxMonthlyUsageUsd 5). The org switch did not
   * raise the real ceiling. Reverted this value to $4 (a notch below $5,
   * same reasoning as the original $4 -- this guard should fire first
   * with a clear error, not Apify's own platform wall failing a run
   * abruptly mid-harvest) after a brief excursion to $12 that assumed a
   * higher-tier plan which never materialized. A full 3-market discovery
   * sweep (~$11.26 estimated) and even a single-market one (~$3.75)
   * cannot complete in one cycle at this cap -- work in smaller batches
   * (--limit, --sample) and expect to spread a full sweep across cycles,
   * or upgrade the Apify plan and raise this deliberately.
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
