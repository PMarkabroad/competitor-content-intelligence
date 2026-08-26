/**
 * Behaviour-first discovery pass. Finds TikTok candidate accounts by
 * running 90 days of real post data through the same gates an account
 * already in the registry would face, BEFORE a human ever looks at the
 * account name -- the inverse of how the original T3 Instagram roster was
 * assembled (niche/name first, behaviour discovered later, at cost, one
 * account at a time).
 *
 * Five independently-runnable stages, each behind its own flag:
 *   --search   run seed queries through the TikTok search actor, extract
 *              unique candidate handles, insert into discovery_candidates
 *   --profile  profile-scrape every candidate with a null followers value
 *   --gate     pull ~90 days of posts per candidate, compute
 *              video_posts_90d / median_vpf_90d, resolve band, apply the
 *              hard gates in config.ts. The expensive stage.
 *   --shortlist  write out/discovery_shortlist.csv for the human pass
 *   --promote  read the completed shortlist back, insert approved rows
 *              into `competitors` (never automatic)
 *
 * Every stage prints an estimated cost and requires --confirm to actually
 * call Apify. --limit=<market> scopes --search/--gate to one market.
 * --sample=<N> (--gate only) randomly samples N candidates from the
 * eligible pool instead of gating all of them -- for a budget-capped run,
 * gives an unbiased read on the true pass rate rather than skewing toward
 * whatever an arbitrary ordering (e.g. by followers) would favor.
 *
 * Usage:
 *   npm run discover -- --search --confirm [--limit=AU]
 *   npm run discover -- --profile --confirm
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
  const { _comment, ...markets } = raw;
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

function resolveBand(followers: number) {
  for (const band of config.FOLLOWER_BANDS) {
    if (followers < band.maxFollowers) return band;
  }
  return config.FOLLOWER_BANDS[config.FOLLOWER_BANDS.length - 1];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  return {
    search: args.includes("--search"),
    profile: args.includes("--profile"),
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
// resultsPerPage MUST still be 1. The tiktok-profile-scraper actor's
// default is 100 posts/profile (it's a profile+videos scraper, not a
// profile-only lookup) -- leaving it unset would have made this "cheap"
// stage cost ~100x more than intended. Field names below are confirmed
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

  const estimateUsd = Math.max(0.01, pending.length * 1 * 0.003 + 0.001);
  if (!costGate("profile", estimateUsd, confirmed)) return;

  const items = await runApifyActor(
    actors.tiktokProfile,
    { profiles: pending.map((p) => p.handle), profileScrapeSections: ["videos"], resultsPerPage: 1 },
    apifyToken
  );
  console.log(`Profile stage returned ${items.length} item(s).`);

  const byHandle = new Map<string, string>(pending.map((p) => [p.handle, p.candidate_id]));
  const gates = config.DISCOVERY_GATES;

  let updated = 0;
  let cheapFailed = 0;
  for (const item of items) {
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;
    const handle = String(author.name ?? author.uniqueId ?? item.uniqueId ?? "");
    const candidateId = byHandle.get(handle);
    if (!candidateId) continue;

    const followers = Number(author.fans ?? author.followerCount ?? item.fans ?? 0) || null;
    const isPrivate = Boolean(author.privateAccount ?? author.isPrivate ?? item.privateAccount ?? false);

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

// --- --gate (expensive gates: video_posts_90d, median_vpf_90d) -----------
//
// Only ever runs against candidates that already passed --profile's cheap
// gates (followers, is_private) -- gate_result stays null for a passing
// --profile candidate specifically so this query picks them up.
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
    .is("gate_result", null) // only candidates that passed --profile's cheap gates and haven't been gated yet
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
    .select("candidate_id, platform, handle, display_name, followers, market_guess, video_posts_90d, median_vpf_90d, band, found_via")
    .eq("gate_result", "pass")
    .order("median_vpf_90d", { ascending: false });
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);

  const columns = [
    "candidate_id", "platform", "handle", "display_name", "followers", "market_guess",
    "video_posts_90d", "median_vpf_90d", "band", "found_via",
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
  if (args.gate) await stageGate(apifyToken!, args.limit, args.confirm, args.sample);
  if (args.shortlist) await stageShortlist();
  if (args.promote) {
    if (!args.file) throw new Error("--promote requires --file <path-to-completed-shortlist.csv>");
    await stagePromote(args.file);
  }

  if (!args.search && !args.profile && !args.gate && !args.shortlist && !args.promote) {
    console.log("Usage: discover.ts --search|--profile|--gate|--shortlist|--promote [--limit=AU|CA|US] [--confirm] [--file <path>]");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
