/**
 * Behaviour-first discovery pass. Finds TikTok candidate accounts by
 * running 90 days of real post data through the same gates an account
 * already in the registry would face, BEFORE a human ever looks at the
 * account name -- the inverse of how the original T3 Instagram roster was
 * assembled (niche/name first, behaviour discovered later, at cost, one
 * account at a time).
 *
 * Six independently-runnable stages, run IN ORDER, each behind its own flag:
 *   --search    run seed queries through the TikTok search actor, extract
 *               unique candidate handles, insert into discovery_candidates
 *   --profile   cheap gates only: followers, is_private (author-level
 *               metadata). Also pulls 3 recent captions for --classify.
 *   --classify  THE relevance gate (added after the AU sweep showed only
 *               6 of 37 behaviorally-healthy candidates were genuine
 *               career coaches -- 21 were lifestyle vloggers a behavioral
 *               gate structurally cannot filter). Anthropic API, not
 *               keyword matching. Hard-excludes 'regulated' (visa/
 *               migration-agent accounts) and 'irrelevant'. No Apify cost.
 *   --gate      expensive gates: video_posts_90d, median_vpf_90d,
 *               last_post_at. Only runs on candidates --classify approved
 *               (career_coach/adjacent). The expensive Apify stage.
 *   --shortlist  write out/discovery_shortlist.csv for the human pass
 *   --promote   read the completed shortlist back, insert approved rows
 *               into `competitors` (never automatic). Refuses any row
 *               classified 'regulated' (also enforced at the DB level,
 *               migration 009 -- this is defense in depth, not the lock).
 *
 * Every stage that calls Apify prints an estimated cost and requires
 * --confirm to proceed; --classify calls only the Anthropic API and has no
 * such gate. --limit=<market> scopes --search/--classify/--gate to one
 * market. --sample=<N> (--gate only) randomly samples N candidates from
 * the eligible pool instead of gating all of them -- for a budget-capped
 * run, gives an unbiased read on the true pass rate rather than skewing
 * toward whatever an arbitrary ordering (e.g. by followers) would favor.
 *
 * Usage:
 *   npm run discover -- --search --confirm [--limit=AU]
 *   npm run discover -- --profile --confirm
 *   npm run discover -- --classify [--limit=AU]
 *   npm run discover -- --gate --confirm [--limit=AU] [--sample=55]
 *   npm run discover -- --shortlist
 *   npm run discover -- --promote --file out/discovery_shortlist.csv
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "csv-parse/sync";
import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);
const SEED_QUERIES_PATH = new URL("../discovery/seed_queries.json", import.meta.url);
const SHORTLIST_PATH = new URL("../out/discovery_shortlist.csv", import.meta.url);
const OUT_DIR = new URL("../out/", import.meta.url);

type Market = "AU" | "CA" | "US";

interface ActorPin {
  actorId: string;
  build: string;
}

interface ActorsConfig {
  tiktokSearch: ActorPin;
  tiktokPosts: ActorPin;
  tiktokProfile: ActorPin;
}

function loadActors(): ActorsConfig {
  return JSON.parse(readFileSync(ACTORS_PATH, "utf-8"));
}

function loadSeedQueries(): Record<Market, string[]> {
  const raw = JSON.parse(readFileSync(SEED_QUERIES_PATH, "utf-8"));
  // Strip every underscore-prefixed key (_comment, _comment_AU, ...), not
  // just the literal "_comment" -- a market-specific comment key here
  // would otherwise leak into `markets` and be iterated as if it were a
  // fourth market.
  const markets = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith("_"))
  );
  return markets as Record<Market, string[]>;
}

async function runApifyActor(
  pin: ActorPin,
  input: Record<string, unknown>,
  apifyToken: string
): Promise<Record<string, unknown>[]> {
  const pathActorId = pin.actorId.replace("/", "~");
  const url =
    `https://api.apify.com/v2/acts/${pathActorId}/run-sync-get-dataset-items` +
    `?token=${apifyToken}&build=${encodeURIComponent(pin.build)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Apify actor ${pin.actorId}:${pin.build} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

// Uses DISCOVERY_FOLLOWER_BANDS (TikTok-calibrated), not FOLLOWER_BANDS
// (Instagram-only, used by the real harvest pipeline and baked into
// v_outliers's SQL) -- see config.ts's comment on DISCOVERY_FOLLOWER_BANDS
// for why one set of floors can't serve both platforms.
function resolveBand(followers: number) {
  for (const band of config.DISCOVERY_FOLLOWER_BANDS) {
    if (followers < band.maxFollowers) return band;
  }
  return config.DISCOVERY_FOLLOWER_BANDS[config.DISCOVERY_FOLLOWER_BANDS.length - 1];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  return {
    search: args.includes("--search"),
    profile: args.includes("--profile"),
    classify: args.includes("--classify"),
    gate: args.includes("--gate"),
    shortlist: args.includes("--shortlist"),
    promote: args.includes("--promote"),
    confirm: args.includes("--confirm"),
    limit: limitArg ? (limitArg.split("=")[1] as Market) : undefined,
    sample: (() => {
      const a = args.find((a) => a.startsWith("--sample="));
      return a ? Number(a.split("=")[1]) : undefined;
    })(),
    file: (() => {
      const i = args.indexOf("--file");
      return i >= 0 ? args[i + 1] : undefined;
    })(),
  };
}

/**
 * Prints an estimated cost and returns whether the caller may proceed.
 * Every stage that calls Apify goes through this -- no stage calls Apify
 * without printing a number first, and none proceeds without --confirm.
 */
function costGate(stageName: string, estimateUsd: number, confirmed: boolean): boolean {
  console.log(`\n[${stageName}] Estimated cost: $${estimateUsd.toFixed(4)}`);
  if (!confirmed) {
    console.log(`[${stageName}] Not confirmed -- pass --confirm to actually run this stage. Stopping here.`);
    return false;
  }
  console.log(`[${stageName}] --confirm passed, proceeding.`);
  return true;
}

// --- --search ---------------------------------------------------------

async function stageSearch(apifyToken: string, limit: Market | undefined, confirmed: boolean) {
  const actors = loadActors();
  const seedQueries = loadSeedQueries();
  const markets: Market[] = limit ? [limit] : (Object.keys(seedQueries) as Market[]);
  const queries = markets.flatMap((m) => seedQueries[m].map((q) => ({ market: m, query: q })));

  const estimatedResults = queries.length * config.DISCOVERY_SEARCH_RESULTS_PER_QUERY;
  const estimateUsd = Math.max(0.5, estimatedResults * 0.0037 + 0.001);
  if (!costGate("search", estimateUsd, confirmed)) return;

  const supabase = getSupabaseClient();

  const items = await runApifyActor(
    actors.tiktokSearch,
    { searchQueries: queries.map((q) => q.query), resultsPerPage: config.DISCOVERY_SEARCH_RESULTS_PER_QUERY },
    apifyToken
  );
  console.log(`Search returned ${items.length} raw item(s).`);

  // Field names below are best-effort against clockworks/tiktok-scraper's
  // documented output shape -- not yet confirmed against a real response
  // (discover.ts has not been run). Confirm and adjust on first real run.
  const { data: existingCandidates } = await supabase.from("discovery_candidates").select("handle");
  const { data: existingCompetitors } = await supabase.from("competitors").select("handle").eq("platform", "tiktok");
  const known = new Set([
    ...(existingCandidates ?? []).map((c) => c.handle),
    ...(existingCompetitors ?? []).map((c) => c.handle),
  ]);

  const seen = new Set<string>();
  let inserted = 0;
  for (const item of items) {
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;
    const handle = String(author.name ?? author.uniqueId ?? item.authorHandle ?? "");
    if (!handle || known.has(handle) || seen.has(handle)) continue;
    seen.add(handle);

    const matchedQuery = queries.find((q) => item.searchQuery === q.query)?.query ?? queries[0]?.query ?? "";
    const marketOfQuery = queries.find((q) => q.query === matchedQuery)?.market ?? null;

    const { error } = await supabase.from("discovery_candidates").upsert(
      {
        platform: "tiktok",
        handle,
        profile_url: author.profileUrl ?? `https://www.tiktok.com/@${handle}`,
        display_name: author.nickName ?? author.nickname ?? null,
        bio: author.signature ?? null,
        market_guess: marketOfQuery,
        found_via: matchedQuery,
        raw: item,
      },
      { onConflict: "platform,handle" }
    );
    if (!error) inserted += 1;
  }

  console.log(`Inserted ${inserted} new candidate(s) into discovery_candidates.`);
}

// --- --profile (cheap gates: followers, is_private only) -----------------
//
// last_post_at is NOT gated here, despite the original design intent --
// found on the first real AU run (2026-08-26) that resultsPerPage=1
// without excludePinnedPosts returns TikTok's PINNED post 63.4% of the
// time (168/265 candidates), not the actual most recent one. Same failure
// mode as the Instagram pinned-post contamination found earlier in this
// pipeline's build. Re-running --profile with excludePinnedPosts:true
// would fix it but costs another ~$0.80 on an already-tight budget: since
// --gate pulls multiple posts per candidate anyway (and DOES set
// excludePinnedPosts there), last_post_at is computed for free as part of
// that pull instead. followers/is_private are unaffected by pinning
// (author-level metadata, not post-level) and stay gated here.
//
// resultsPerPage is 3, not 1: --classify (the next stage) needs bio + 3
// recent captions per candidate, and this is the cheap stage that already
// pulls author-level data -- 3 items instead of 1 is still ~33x cheaper
// than --gate's resultsPerPage=10. Captions from these 3 items are almost
// certainly pinned-contaminated for RECENCY purposes (same issue as
// last_post_at, see the header comment above) -- irrelevant for
// classification, which only needs representative content samples, not
// the most-recent ones specifically. Field names below are confirmed
// against a real response (2026-08-26 AU run), not guessed.

async function stageProfile(apifyToken: string, confirmed: boolean) {
  const actors = loadActors();
  const supabase = getSupabaseClient();

  const { data: pending, error } = await supabase
    .from("discovery_candidates")
    .select("candidate_id, handle")
    .is("followers", null);
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);
  if (!pending || pending.length === 0) {
    console.log("No candidates need profiling.");
    return;
  }

  // resultsPerPage=3, not 1: it's still one Apify call per handle, but
  // that call returns 3 billable dataset items (this actor prices per
  // result, not per call) -- 1 item's worth of author metadata for the
  // followers/is_private gates, plus 2 extra items purely to give
  // --classify 3 captions to read. Split out below so the cost line names
  // what it's actually paying for, not one undifferentiated "profile" fee.
  const PROFILE_RESULTS_PER_PAGE = 3;
  const baseProfileUsd = pending.length * 1 * 0.003;
  const classifyCaptionsUsd = pending.length * (PROFILE_RESULTS_PER_PAGE - 1) * 0.003;
  const estimateUsd = Math.max(0.01, baseProfileUsd + classifyCaptionsUsd + 0.001);
  console.log(
    `  (base profile, 1 result/candidate: $${baseProfileUsd.toFixed(4)}; ` +
      `+${PROFILE_RESULTS_PER_PAGE - 1} extra results/candidate for --classify captions: $${classifyCaptionsUsd.toFixed(4)})`
  );
  if (!costGate("profile", estimateUsd, confirmed)) return;

  const items = await runApifyActor(
    actors.tiktokProfile,
    { profiles: pending.map((p) => p.handle), profileScrapeSections: ["videos"], resultsPerPage: PROFILE_RESULTS_PER_PAGE },
    apifyToken
  );
  console.log(`Profile stage returned ${items.length} item(s).`);

  const itemsByHandle = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;
    const handle = String(author.name ?? author.uniqueId ?? item.uniqueId ?? "");
    if (!handle) continue;
    if (!itemsByHandle.has(handle)) itemsByHandle.set(handle, []);
    itemsByHandle.get(handle)!.push(item);
  }

  const byHandle = new Map<string, string>(pending.map((p) => [p.handle, p.candidate_id]));
  const gates = config.DISCOVERY_GATES;

  let updated = 0;
  let cheapFailed = 0;
  for (const [handle, handleItems] of itemsByHandle.entries()) {
    const item = handleItems[0]; // author-level fields are identical across a handle's items
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;
    const candidateId = byHandle.get(handle);
    if (!candidateId) continue;

    const followers = Number(author.fans ?? author.followerCount ?? item.fans ?? 0) || null;
    const isPrivate = Boolean(author.privateAccount ?? author.isPrivate ?? item.privateAccount ?? false);
    const recentCaptions = handleItems
      .map((i) => String(i.text ?? ""))
      .filter((t) => t.length > 0)
      .slice(0, 3);

    const failReasons: string[] = [];
    if (followers === null || followers < gates.minFollowers) {
      failReasons.push(`followers=${followers} < ${gates.minFollowers}`);
    }
    if (isPrivate) {
      failReasons.push("is_private=true");
    }

    const cheapGateFailed = failReasons.length > 0;
    if (cheapGateFailed) cheapFailed += 1;

    const { error: updateError } = await supabase
      .from("discovery_candidates")
      .update({
        followers,
        bio: author.signature ?? item.signature ?? null,
        is_private: isPrivate,
        recent_captions: recentCaptions,
        // Only write a terminal gate_result here on failure -- passing
        // candidates stay gate_result=null so --gate's `is('gate_result',
        // null)` filter picks them up for the expensive post pull. Writing
        // 'pass' here would be premature: last_post_at, video_posts_90d
        // and median_vpf_90d haven't been checked yet.
        gate_result: cheapGateFailed ? "fail" : null,
        gate_fail_reason: cheapGateFailed ? failReasons.join("; ") : null,
      })
      .eq("candidate_id", candidateId);
    if (!updateError) updated += 1;
  }
  console.log(`Updated ${updated} candidate(s). ${cheapFailed} failed a cheap gate (followers/private) and will not proceed to --gate.`);
}

// --- --classify (relevance gate, runs BEFORE --gate) ----------------------
//
// The real fix from the AU sweep: behavioral gates (follower count,
// posting frequency, vpf) cannot distinguish a career coach from an
// expat-lifestyle vlogger who happens to post about "life in Australia" --
// that difference is semantic. Only 6 of 37 candidates that cleared every
// behavioral gate were genuine career/job-search accounts; 21 were
// generic lifestyle creators caught by broad keyword matching, and 2
// (nazanin.migration, pathwaytoaus) were migration agents that must never
// be promoted regardless of performance (see migration 009's hard
// DB-level constraint -- this classification feeds that lock, it doesn't
// replace it).
//
// Runs against every candidate that passed --profile's cheap gates
// (gate_result is null) and hasn't been classified yet. Uses the
// Anthropic API, not keyword matching -- the whole point is that this is
// a semantic judgment call, and this pipeline already learned once this
// session (the pinned-post bug) that a cheap heuristic can look right and
// be systematically wrong. Only career_coach and adjacent proceed to
// --gate; irrelevant and regulated get a terminal gate_result='fail' here
// and never reach the expensive post pull.
//
// No Apify cost at all -- this stage only calls the Anthropic API.

const CLASSIFY_BATCH_SIZE = 20;

export async function classifyBatch(
  anthropic: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  candidates: { candidate_id: string; handle: string; bio: string | null; recent_captions: string[] | null }[]
): Promise<Map<string, { classification: string; reason: string }>> {
  const system = `You classify TikTok accounts for a competitor-intelligence pipeline built for an Australian career-coaching business (Ark Abroad) that helps internationally-trained professionals and migrants land corporate jobs in AU/US/CA.

Classify each account into exactly one of:
- "career_coach": the account's primary content is career coaching, job-search advice, resume/interview/LinkedIn help, or similar professional-development coaching aimed at job seekers.
- "adjacent": related but not core career coaching -- e.g. a study-abroad or settlement-services org, a niche professional-skills trainer, a recruiter, or similar. Worth a human's second look, not an automatic yes.
- "irrelevant": general lifestyle, travel, entertainment, fitness, or personal-diary content that happens to mention living/working abroad, but is not meaningfully about career coaching or job search.
- "regulated": the account's bio or content centres on visa, permanent residency, migration, or sponsorship advice (e.g. a registered migration agent, a "visa expert" service). This applies regardless of how good the account's other content is -- these must be hard-excluded.

Respond with ONLY a JSON array, no markdown fences, no preamble: [{"handle": "...", "classification": "career_coach|adjacent|irrelevant|regulated", "reason": "one short sentence"}, ...] -- one object per account, in the order given.`;

  // Scraped bios/captions occasionally contain a lone (unpaired) UTF-16
  // surrogate -- usually a mangled emoji from the source scraper. JSON.stringify
  // happily emits it, but the resulting bytes aren't valid UTF-8 and the
  // Anthropic API's JSON parser rejects the whole request body with "no low
  // surrogate in string", silently dropping every candidate in that batch.
  // Strip unpaired surrogates before building the request.
  const sanitize = (s: string) =>
    s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "").replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

  const userContent = candidates
    .map(
      (c, i) =>
        `${i + 1}. handle: ${c.handle}\nbio: ${sanitize(c.bio ?? "(none)")}\nrecent captions: ${(c.recent_captions ?? []).map((cap) => `"${sanitize(cap.slice(0, 200))}"`).join(" | ") || "(none)"}`
    )
    .join("\n\n");

  // claude-haiku-4-5, not claude-opus-5 -- deliberate for this task: four-
  // bucket bio+caption classification is a bulk, well-defined job we pay
  // for per-candidate, not generated code (where the "always Opus" rule
  // applies). Haiku 4.5 is an older-tier model in the Anthropic API sense:
  // it doesn't support output_config.effort or adaptive thinking (both
  // error on this model), so neither is set here -- this is a plain,
  // no-thinking classification call.
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Classify response had no text block.");
  }

  // Defensive: the system prompt says "no markdown fences", but Haiku 4.5
  // wrapped every response in ```json ... ``` anyway on the first real run
  // (2026-08-26) -- every batch failed to parse and was silently skipped
  // as a result, with zero candidates classified despite the model's
  // actual classifications being correct. Strip a fenced-code wrapper if
  // present before parsing, rather than trusting the instruction alone.
  const jsonText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: { handle: string; classification: string; reason: string }[];
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse classify response as JSON: ${jsonText.slice(0, 500)}`);
  }

  const validClassifications = new Set(["career_coach", "adjacent", "irrelevant", "regulated"]);
  const result = new Map<string, { classification: string; reason: string }>();
  for (const row of parsed) {
    if (!validClassifications.has(row.classification)) {
      throw new Error(`Out-of-vocabulary classification "${row.classification}" for ${row.handle}`);
    }
    result.set(row.handle, { classification: row.classification, reason: row.reason });
  }
  return result;
}

async function stageClassify(limit: Market | undefined) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY must be set (see .env.example).");

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const supabase = getSupabaseClient();

  let query = supabase
    .from("discovery_candidates")
    .select("candidate_id, handle, bio, recent_captions")
    .is("gate_result", null) // passed --profile's cheap gates
    .is("classification", null) // not yet classified
    .not("followers", "is", null);

  if (limit) query = query.eq("market_guess", limit);

  const { data: pending, error } = await query;
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);
  if (!pending || pending.length === 0) {
    console.log("No candidates need classification.");
    return;
  }

  console.log(`Classifying ${pending.length} candidate(s) in batches of ${CLASSIFY_BATCH_SIZE} (Anthropic API, no Apify cost)...`);

  let classified = 0;
  let excluded = 0;
  for (let i = 0; i < pending.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = pending.slice(i, i + CLASSIFY_BATCH_SIZE);
    let results: Map<string, { classification: string; reason: string }>;
    try {
      results = await classifyBatch(anthropic, batch);
    } catch (err) {
      console.error(`Batch starting at ${i} failed: ${err instanceof Error ? err.message : String(err)}. Retrying once.`);
      try {
        results = await classifyBatch(anthropic, batch);
      } catch (retryErr) {
        console.error(`Retry also failed, skipping this batch: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
        continue;
      }
    }

    for (const c of batch) {
      const r = results.get(c.handle);
      if (!r) {
        console.error(`No classification returned for ${c.handle}, skipping.`);
        continue;
      }
      const excludeFromGate = r.classification === "irrelevant" || r.classification === "regulated";
      if (excludeFromGate) excluded += 1;

      const { error: updateError } = await supabase
        .from("discovery_candidates")
        .update({
          classification: r.classification,
          classification_reason: r.reason,
          gate_result: excludeFromGate ? "fail" : null,
          gate_fail_reason: excludeFromGate ? `classification=${r.classification}: ${r.reason}` : null,
        })
        .eq("candidate_id", c.candidate_id);
      if (!updateError) classified += 1;
    }
  }

  console.log(`Classified ${classified} candidate(s). ${excluded} excluded (irrelevant/regulated) and will not proceed to --gate.`);
}

// --- --gate (expensive gates: video_posts_90d, median_vpf_90d) -----------
//
// Only ever runs against candidates that already passed --profile's cheap
// gates AND --classify's relevance gate (classification in career_coach/
// adjacent) -- gate_result stays null for a candidate passing both, so
// this query requires classification to be explicitly set to one of the
// two approved values, not just gate_result is null. This enforces the
// stage order (search -> profile -> cheap gates -> classify -> gate): a
// candidate that hasn't been classified yet (classification still null)
// does NOT reach the expensive post pull, even if it happens to have
// gate_result=null from --profile.
// followers/is_private are NOT re-checked here -- --profile already
// decided them. last_post_at IS computed here (not in --profile): the
// pinned-post contamination found in the 2026-08-26 AU run means it needs
// excludePinnedPosts:true and multiple posts to find reliably, which this
// stage already pulls for video_posts_90d/median_vpf_90d anyway.

async function stageGate(apifyToken: string, limit: Market | undefined, confirmed: boolean, sampleSize?: number) {
  const actors = loadActors();
  const supabase = getSupabaseClient();

  let query = supabase
    .from("discovery_candidates")
    .select("candidate_id, handle, followers, market_guess")
    .is("gate_result", null) // hasn't been gated yet (and didn't fail cheap gates or classification)
    .in("classification", ["career_coach", "adjacent"]) // --classify must have run and approved this candidate
    .not("followers", "is", null); // needs --profile to have run first

  if (limit) query = query.eq("market_guess", limit);

  let { data: pending, error } = await query;
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);
  if (!pending || pending.length === 0) {
    console.log("No candidates ready to gate (need --profile run first, all failed a cheap gate, or all already gated).");
    return;
  }

  if (sampleSize !== undefined && pending.length > sampleSize) {
    // Random (not ordering-biased) sample -- for a budget-capped run, this
    // gives an unbiased read on the true pass rate across the full pool,
    // extrapolatable to the candidates left ungated, rather than skewing
    // toward whatever an arbitrary sort (e.g. by followers) would favor.
    const shuffled = [...pending].sort(() => Math.random() - 0.5);
    pending = shuffled.slice(0, sampleSize);
    console.log(`--sample=${sampleSize}: randomly sampled ${pending.length} of the full eligible pool.`);
  }

  const estimatedResults = pending.length * config.DISCOVERY_GATE_MAX_POSTS_PER_CANDIDATE;
  const estimateUsd = Math.max(0.5, estimatedResults * 0.0037 + 0.001);
  if (!costGate("gate", estimateUsd, confirmed)) return;

  const items = await runApifyActor(
    actors.tiktokPosts,
    {
      profiles: pending.map((p) => p.handle),
      resultsPerPage: config.DISCOVERY_GATE_MAX_POSTS_PER_CANDIDATE,
      excludePinnedPosts: true, // see stageProfile's header comment -- pinned posts contaminate recency
    },
    apifyToken
  );
  console.log(`Gate stage returned ${items.length} post item(s).`);

  const postsByHandle = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;
    const handle = String(author.name ?? author.uniqueId ?? item.authorHandle ?? "");
    if (!handle) continue;
    if (!postsByHandle.has(handle)) postsByHandle.set(handle, []);
    postsByHandle.get(handle)!.push(item);
  }

  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = Date.now() - config.DISCOVERY_GATES.maxDaysSinceLastPost * 24 * 60 * 60 * 1000;
  const gates = config.DISCOVERY_GATES;

  for (const candidate of pending) {
    const posts = postsByHandle.get(candidate.handle) ?? [];
    const videoPostsInWindow = posts.filter((p) => {
      const ts = Number(p.createTimeISO ? Date.parse(String(p.createTimeISO)) : Number(p.createTime) * 1000);
      return !Number.isNaN(ts) && ts >= ninetyDaysAgo;
    });

    const lastPostTs = posts.reduce((max, p) => {
      const ts = Number(p.createTimeISO ? Date.parse(String(p.createTimeISO)) : Number(p.createTime) * 1000);
      return !Number.isNaN(ts) && ts > max ? ts : max;
    }, 0);
    const lastPostAt = lastPostTs > 0 ? new Date(lastPostTs).toISOString() : null;

    const followers = candidate.followers as number;
    const vpfs = videoPostsInWindow
      .map((p) => {
        const videoMeta = p.videoMeta as Record<string, unknown> | undefined;
        return Number(p.playCount ?? videoMeta?.playCount ?? 0);
      })
      .filter((v) => v > 0)
      .map((views) => views / followers)
      .sort((a, b) => a - b);
    const medianVpf = vpfs.length > 0 ? vpfs[Math.floor(vpfs.length / 2)] : null;

    const band = resolveBand(followers);

    const failReasons: string[] = [];
    if (!lastPostAt || lastPostTs < thirtyDaysAgo) {
      failReasons.push(`last_post_at=${lastPostAt ?? "null"} outside ${gates.maxDaysSinceLastPost}-day window`);
    }
    if (videoPostsInWindow.length < gates.minVideoPosts90d) {
      failReasons.push(`video_posts_90d=${videoPostsInWindow.length} < ${gates.minVideoPosts90d}`);
    }
    if (medianVpf === null || medianVpf < band.minMedianVpf) {
      failReasons.push(`median_vpf_90d=${medianVpf?.toFixed(5) ?? "null"} < ${band.name}-band floor ${band.minMedianVpf}`);
    }
    // market_guess: 'unknown' passes through for human review, never
    // silently gated -- only a concrete non-AU/CA/US value fails.
    const marketGuess = candidate.market_guess;
    if (marketGuess && marketGuess !== "unknown" && !gates.validMarkets.includes(marketGuess as Market)) {
      failReasons.push(`market_guess=${marketGuess} not in ${gates.validMarkets.join("/")}`);
    }

    const gateResult = failReasons.length === 0 ? "pass" : "fail";

    const { error: updateError } = await supabase
      .from("discovery_candidates")
      .update({
        last_post_at: lastPostAt,
        video_posts_90d: videoPostsInWindow.length,
        median_vpf_90d: medianVpf,
        band: band.name,
        gate_result: gateResult,
        gate_fail_reason: failReasons.length > 0 ? failReasons.join("; ") : null,
      })
      .eq("candidate_id", candidate.candidate_id);
    if (updateError) {
      console.error(`Failed to update ${candidate.handle}: ${updateError.message}`);
    }
  }

  console.log(`Gated ${pending.length} candidate(s).`);
}

// --- --shortlist ------------------------------------------------------

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function stageShortlist() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("discovery_candidates")
    .select("candidate_id, platform, handle, display_name, followers, market_guess, video_posts_90d, median_vpf_90d, band, found_via, classification, classification_reason")
    .eq("gate_result", "pass")
    .order("median_vpf_90d", { ascending: false });
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);

  const columns = [
    "candidate_id", "platform", "handle", "display_name", "followers", "market_guess",
    "video_posts_90d", "median_vpf_90d", "band", "found_via", "classification", "classification_reason",
    "relevance_score", "topic_slugs", "proposed_tier", "reviewed_by",
  ];
  const lines = [columns.join(",")];
  for (const row of data ?? []) {
    const record: Record<string, string> = {
      candidate_id: row.candidate_id,
      platform: row.platform,
      handle: row.handle,
      display_name: row.display_name ?? "",
      followers: String(row.followers ?? ""),
      market_guess: row.market_guess ?? "",
      video_posts_90d: String(row.video_posts_90d ?? ""),
      median_vpf_90d: String(row.median_vpf_90d ?? ""),
      band: row.band ?? "",
      found_via: row.found_via ?? "",
      classification: row.classification ?? "",
      classification_reason: row.classification_reason ?? "",
      relevance_score: "",
      topic_slugs: "",
      proposed_tier: "",
      reviewed_by: "",
    };
    lines.push(columns.map((c) => csvEscape(record[c])).join(","));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(SHORTLIST_PATH, lines.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${data?.length ?? 0} passing candidate(s) to ${SHORTLIST_PATH.pathname}`);
}

// --- --promote --------------------------------------------------------

async function stagePromote(filePath: string) {
  const supabase = getSupabaseClient();
  const csvText = readFileSync(filePath, "utf-8");
  const rows: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });

  let promoted = 0;
  let refused = 0;

  for (const row of rows) {
    if (!row.reviewed_by?.trim() || !row.proposed_tier?.trim()) {
      refused += 1;
      console.log(`REFUSED (missing reviewed_by or proposed_tier): ${row.handle}`);
      continue;
    }

    // Defense in depth: migration 009's CHECK constraint already makes
    // (promoted=true AND classification='regulated') impossible at the DB
    // level, but refuse explicitly here too, with a clear message, rather
    // than letting a human hit an opaque constraint-violation error.
    const { data: candidateRow } = await supabase
      .from("discovery_candidates")
      .select("classification")
      .eq("candidate_id", row.candidate_id)
      .single();
    if (candidateRow?.classification === "regulated") {
      refused += 1;
      console.log(`REFUSED (classification=regulated, hard-excluded regardless of performance): ${row.handle}`);
      continue;
    }

    const { error: insertError } = await supabase.from("competitors").insert({
      name: row.display_name?.trim() || row.handle,
      tier: row.proposed_tier.trim(),
      market: row.market_guess?.trim() || "unknown",
      platform: row.platform || "tiktok",
      handle: row.handle,
      handle_verified: true,
      active: true,
      notes: `Promoted from discovery pass ${new Date().toISOString().slice(0, 10)} by ${row.reviewed_by.trim()}. found_via="${row.found_via}", video_posts_90d=${row.video_posts_90d}, median_vpf_90d=${row.median_vpf_90d}.`,
    });
    if (insertError) {
      console.error(`Failed to insert ${row.handle} into competitors: ${insertError.message}`);
      continue;
    }

    await supabase
      .from("discovery_candidates")
      .update({
        reviewed_by: row.reviewed_by.trim(),
        reviewed_at: new Date().toISOString(),
        proposed_tier: row.proposed_tier.trim(),
        relevance_score: row.relevance_score ? Number(row.relevance_score) : null,
        topic_slugs: row.topic_slugs ? row.topic_slugs.split(";").map((s) => s.trim()) : null,
        promoted: true,
      })
      .eq("candidate_id", row.candidate_id);

    promoted += 1;
    console.log(`PROMOTED: ${row.handle} -> competitors (${row.proposed_tier}, ${row.market_guess})`);
  }

  console.log(`\n${promoted} promoted, ${refused} refused (blank reviewed_by or proposed_tier).`);
}

async function main() {
  const args = parseArgs();
  const apifyToken = process.env.APIFY_TOKEN;

  if (args.search || args.profile || args.gate) {
    if (!apifyToken) throw new Error("APIFY_TOKEN must be set (see .env.example).");
  }

  if (args.search) await stageSearch(apifyToken!, args.limit, args.confirm);
  if (args.profile) await stageProfile(apifyToken!, args.confirm);
  if (args.classify) await stageClassify(args.limit);
  if (args.gate) await stageGate(apifyToken!, args.limit, args.confirm, args.sample);
  if (args.shortlist) await stageShortlist();
  if (args.promote) {
    if (!args.file) throw new Error("--promote requires --file <path-to-completed-shortlist.csv>");
    await stagePromote(args.file);
  }

  if (!args.search && !args.profile && !args.classify && !args.gate && !args.shortlist && !args.promote) {
    console.log("Usage: discover.ts --search|--profile|--classify|--gate|--shortlist|--promote [--limit=AU|CA|US] [--confirm] [--sample=N] [--file <path>]");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
