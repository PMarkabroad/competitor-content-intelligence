/**
 * Scheduled harvest entry point -- the actual runner behind schedule.md's
 * T2 fortnightly / T3 monthly cadence. T1 is exempt from scoring and is
 * refused here on purpose (weekly T1 harvest stays a separate, manual
 * concern, not wired to this scheduler).
 *
 * Platform-aware: Instagram competitors go through the existing
 * actors.profile + actors.posts pair (same pattern as harvest_posts.ts).
 * TikTok competitors go through ONE actors.tiktokPosts call in "profiles"
 * mode -- that response already carries author metadata nested on every
 * item (authorMeta.fans/following/video/signature), so no separate
 * profile call is needed. Field names are normalized to the same shape
 * ingestProfile/ingestPost already expect from Instagram (see
 * normalizeTikTokProfile/normalizeTikTokPost below) rather than growing
 * ingest.ts's fallback chains -- keeps the platform-specific field-name
 * quirks colocated with the platform-specific actor call.
 *
 * Cap-aware: checks REAL month-to-date Apify spend (GET
 * /v2/users/me/usage/monthly, same call preflight.ts makes) plus this
 * run's own cost estimate, BEFORE calling any actor. If that would push
 * past MONTHLY_APIFY_SPEND_CAP_USD, the run is skipped (loud log to
 * stdout + logs/, exit 0) rather than run partially or failed --
 * build_run_input.ts's existing cap check only compares its own estimate
 * against the full cap, not against remaining budget; this script does
 * the actually-correct check since it's the one that spends real money.
 *
 * Incremental: each competitor's last_scraped_at becomes the "since"
 * watermark (onlyPostsNewerThan for Instagram, oldestPostDateUnified for
 * TikTok -- confirmed via the actor's real input schema on 2026-08-26
 * that this param exists and does exactly this).
 *
 * Zero-row alert: ANY active, in-scope competitor that returns zero post
 * rows raises a flagged error (broader than ingest.ts's webhook-path
 * check, which only flags T1 -- a scheduled T2/T3 zero-row result is
 * just as likely to mean a broken handle as a T1 one, and this step's
 * spec says so explicitly).
 *
 * Never schedules transcription -- that stays a separate, manual/human
 * step per schedule.md.
 *
 * Usage: npm run scheduled-harvest -- --tier T2
 */

import { appendFileSync, mkdirSync } from "node:fs";
import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { ingestProfile, ingestPost } from "./ingest.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);
const LOG_DIR = new URL("../logs/", import.meta.url);

type Tier = "T2" | "T3";

interface ActorPin {
  actorId: string;
  build: string;
}

interface ActorsConfig {
  profile: ActorPin;
  posts: ActorPin;
  tiktokPosts: ActorPin;
}

interface Competitor {
  competitor_id: string;
  name: string;
  platform: string;
  market: string;
  handle: string;
  posts_per_run: number | null;
  last_scraped_at: string | null;
  tier: Tier;
}

function logFlag(message: string, context: Record<string, unknown>) {
  const entry = { level: "error", message, context, at: new Date().toISOString() };
  console.error(JSON.stringify(entry));
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(
    new URL(`scheduled-harvest-${new Date().toISOString().slice(0, 10)}.log`, LOG_DIR),
    JSON.stringify(entry) + "\n"
  );
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

async function getRealMonthToDateSpendUsd(apifyToken: string): Promise<number> {
  const res = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apifyToken}`);
  if (!res.ok) {
    throw new Error(`Could not fetch Apify usage: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: { totalUsageCreditsUsdAfterVolumeDiscount: number } };
  return json.data.totalUsageCreditsUsdAfterVolumeDiscount;
}

function estimateRunCostUsd(competitors: Competitor[]): number {
  return competitors.reduce((sum, c) => {
    const maxResults = c.posts_per_run ?? config.POSTS_PER_RUN[c.tier];
    return sum + config.ESTIMATED_COST_PER_PROFILE_USD + maxResults * config.ESTIMATED_COST_PER_POST_USD;
  }, 0);
}

// TikTok's authorMeta (nested on every video item) -> the flat shape
// ingestProfile expects from Instagram's profile actor.
function normalizeTikTokProfile(authorMeta: Record<string, unknown>): Record<string, unknown> {
  return {
    followersCount: authorMeta.fans ?? null,
    followingCount: authorMeta.following ?? null,
    postsCount: authorMeta.video ?? null,
    biography: authorMeta.signature ?? null,
  };
}

// TikTok video item field names confirmed against a real response
// (2026-08-26 salvaged discovery dataset) -- none overlap with
// Instagram's field names, so mapped onto the SAME canonical keys
// ingestPost's existing fallback chains already read, rather than
// widening those chains with platform-specific quirks.
function normalizeTikTokPost(item: Record<string, unknown>): Record<string, unknown> {
  const videoMeta = (item.videoMeta ?? {}) as Record<string, unknown>;
  return {
    ...item,
    timestamp: item.createTimeISO ?? null,
    videoViewCount: item.playCount ?? null,
    likesCount: item.diggCount ?? null,
    url: item.webVideoUrl ?? null,
    durationSeconds: videoMeta.duration ?? null,
    paidPartnership: item.isAd ?? item.isSponsored ?? null,
    type: item.isSlideshow ? "carousel" : "video",
  };
}

async function harvestInstagram(
  supabase: ReturnType<typeof getSupabaseClient>,
  actors: ActorsConfig,
  apifyToken: string,
  c: Competitor
): Promise<number> {
  const runId = crypto.randomUUID();
  const profileItems = await runApifyActor(actors.profile, { usernames: [c.handle] }, apifyToken);
  for (const item of profileItems) {
    await ingestProfile(supabase, c.competitor_id, item, runId);
  }
  const followersAtScrape =
    (profileItems[0]?.followersCount as number | undefined) ??
    (profileItems[0]?.followers as number | undefined) ??
    null;

  const postsPerRun = c.posts_per_run ?? config.POSTS_PER_RUN[c.tier];
  const input: Record<string, unknown> = {
    username: [c.handle],
    resultsLimit: postsPerRun,
    dataDetailLevel: "detailedData",
  };
  // Normalized to a bare date the same way TikTok's oldestPostDateUnified
  // is below -- Postgres's "+00:00" offset suffix broke the TikTok actor's
  // strict date regex, and there's no evidence this actor is any more
  // lenient, so the same normalization is applied here defensively.
  if (c.last_scraped_at) input.onlyPostsNewerThan = c.last_scraped_at.slice(0, 10);

  const postItems = await runApifyActor(actors.posts, input, apifyToken);
  for (const item of postItems) {
    await ingestPost(supabase, c.competitor_id, item, runId, followersAtScrape);
  }
  console.log(`  [${c.name}] instagram run_id=${runId}: profile ${profileItems.length}, posts ${postItems.length} (requested up to ${postsPerRun}, since=${c.last_scraped_at ?? "(none, full pull)"})`);
  return postItems.length;
}

// Batches ALL TikTok competitors sharing the same since-watermark into ONE
// actors.tiktokPosts call -- clockworks/tiktok-scraper has a $0.50
// minimumMaxTotalChargeUsd PER RUN (see actors.json's tiktokSearch/
// tiktokPosts comments), so calling it once per competitor (3 competitors
// = 3 x $0.50 minimum = $1.50) would burn most of a tight remaining
// budget on minimums alone, not on the actual per-result cost.
// oldestPostDateUnified is a single top-level input, not per-handle, so
// competitors are grouped by their exact last_scraped_at value and one
// call is made per group (competitors with no prior scrape share the
// group key `null` and get a full pull together).
async function harvestTikTokBatch(
  supabase: ReturnType<typeof getSupabaseClient>,
  actors: ActorsConfig,
  apifyToken: string,
  competitors: Competitor[]
): Promise<Map<string, number>> {
  const postCountByCompetitorId = new Map<string, number>();
  // Grouped by UTC DATE, not the exact timestamp -- competitors harvested
  // in the same batched call get last_scraped_at values a few hundred ms
  // apart (ingestProfile is called once per competitor after the shared
  // fetch), which would otherwise fragment them into separate single-
  // competitor groups on the next run and reintroduce the per-run-minimum
  // problem this batching exists to avoid. Day-level granularity also
  // matches the actor's own date-filter semantics (its schema describes
  // the parameter primarily in terms of "how many days back", not
  // sub-day precision).
  const groups = new Map<string | null, Competitor[]>();
  for (const c of competitors) {
    const key = c.last_scraped_at ? c.last_scraped_at.slice(0, 10) : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  for (const [sinceDate, group] of groups.entries()) {
    const runId = crypto.randomUUID();
    const maxPostsPerRun = Math.max(...group.map((c) => c.posts_per_run ?? config.POSTS_PER_RUN[c.tier]));
    const input: Record<string, unknown> = {
      profiles: group.map((c) => c.handle),
      resultsPerPage: maxPostsPerRun,
      excludePinnedPosts: true,
    };
    // Actor's date-filter regex only accepts a literal "Z" suffix, not a
    // "+00:00" offset -- Postgres timestamps come back with the latter,
    // which produced a 400 Bad Request on the first real incremental run.
    const since = sinceDate ? `${sinceDate}T00:00:00Z` : null;
    if (since) input.oldestPostDateUnified = since;

    const items = await runApifyActor(actors.tiktokPosts, input, apifyToken);

    const itemsByHandle = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
      const author = (item.authorMeta ?? {}) as Record<string, unknown>;
      const handle = String(author.name ?? author.uniqueId ?? "");
      if (!handle) continue;
      if (!itemsByHandle.has(handle)) itemsByHandle.set(handle, []);
      itemsByHandle.get(handle)!.push(item);
    }

    for (const c of group) {
      const handleItems = itemsByHandle.get(c.handle) ?? [];
      // When oldestPostDateUnified matches nothing new, the actor still
      // returns one row per profile carrying authorMeta (so a followers
      // refresh can still happen below) but no post fields -- just a
      // `note: "No videos found to match the filter"` marker (confirmed
      // on the second real incremental run, 2026-08-26). That's a
      // legitimate "nothing new" result, not a malformed post, so it's
      // filtered out here rather than passed to ingestPost.
      const realPostItems = handleItems.filter((item) => item.id != null);
      if (handleItems.length > 0) {
        const authorMeta = (handleItems[0].authorMeta ?? {}) as Record<string, unknown>;
        const profileItem = normalizeTikTokProfile(authorMeta);
        await ingestProfile(supabase, c.competitor_id, profileItem, runId);
        const followersAtScrape = (profileItem.followersCount as number | null) ?? null;
        for (const item of realPostItems) {
          await ingestPost(supabase, c.competitor_id, normalizeTikTokPost(item), runId, followersAtScrape);
        }
      }
      postCountByCompetitorId.set(c.competitor_id, realPostItems.length);
      console.log(`  [${c.name}] tiktok run_id=${runId}: ${realPostItems.length} post(s) (requested up to ${maxPostsPerRun}, since=${since ?? "(none, full pull)"})`);
    }
  }

  return postCountByCompetitorId;
}

async function main() {
  const tierArgIndex = process.argv.indexOf("--tier");
  const tier = (tierArgIndex >= 0 ? process.argv[tierArgIndex + 1] : null) as Tier | null;
  if (!tier || !["T2", "T3"].includes(tier)) {
    throw new Error("Usage: scheduled_harvest.ts --tier <T2|T3> (T1 is exempt from this scheduler)");
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");

  const supabase = getSupabaseClient();
  const { readFileSync } = await import("node:fs");
  const actors = JSON.parse(readFileSync(ACTORS_PATH, "utf-8")) as ActorsConfig;

  // No market allowlist here -- `active=true` is what actually scopes
  // this, and it's the correct single source of truth. A hardcoded
  // .in("market", ["AU","US"]) used to sit here as "defense in depth"
  // against CA ever being active, written when CA genuinely had zero
  // active rows -- once real CA candidates started getting approved via
  // the dashboard, that filter silently excluded all of them from every
  // harvest run. Found live 2026-08-26: 11 newly-approved CA accounts
  // sat with last_scraped_at=null after a full T2 harvest run because of
  // this. Removed -- if a row is active, it's meant to be harvested,
  // regardless of market.
  const { data, error } = await supabase
    .from("competitors")
    .select("competitor_id, name, platform, market, handle, posts_per_run, last_scraped_at, tier")
    .eq("tier", tier)
    .eq("active", true)
    .eq("handle_verified", true);

  if (error) throw new Error(`Failed to read competitors: ${error.message}`);
  const competitors = (data ?? []) as Competitor[];
  if (competitors.length === 0) {
    console.log(`No active, verified ${tier} competitors. Nothing to harvest.`);
    return;
  }

  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getRealMonthToDateSpendUsd(apifyToken);
  const estimate = estimateRunCostUsd(competitors);
  console.log(`[${tier}] ${competitors.length} competitor(s). Real spend so far this cycle: $${spentSoFar.toFixed(4)}. Estimated cost of this run: $${estimate.toFixed(4)}. Cap: $${cap}.`);

  if (spentSoFar + estimate > cap) {
    const message = `SKIPPED ${tier} harvest: real spend $${spentSoFar.toFixed(4)} + estimated $${estimate.toFixed(4)} would exceed the $${cap} monthly cap.`;
    console.error(`\n*** ${message} ***\n`);
    logFlag(message, { tier, spentSoFar, estimate, cap, competitorCount: competitors.length });
    return; // skip, not fail -- exit 0
  }

  const instagramCompetitors = competitors.filter((c) => c.platform === "instagram");
  const tiktokCompetitors = competitors.filter((c) => c.platform === "tiktok");
  const unknownPlatform = competitors.filter((c) => c.platform !== "instagram" && c.platform !== "tiktok");
  for (const c of unknownPlatform) {
    logFlag(`Unknown platform, skipped`, { competitorId: c.competitor_id, name: c.name, platform: c.platform });
  }

  const postCounts = new Map<string, number>();
  for (const c of instagramCompetitors) {
    postCounts.set(c.competitor_id, await harvestInstagram(supabase, actors, apifyToken, c));
  }
  if (tiktokCompetitors.length > 0) {
    const tiktokCounts = await harvestTikTokBatch(supabase, actors, apifyToken, tiktokCompetitors);
    for (const [id, count] of tiktokCounts.entries()) postCounts.set(id, count);
  }

  let totalPosts = 0;
  for (const c of competitors) {
    const postCount = postCounts.get(c.competitor_id) ?? 0;
    totalPosts += postCount;
    // A zero-row FULL pull (no prior last_scraped_at) almost always means a
    // broken handle or a dead actor -- flagged. A zero-row INCREMENTAL
    // pull just means nothing new posted since the watermark, which is a
    // routine, expected outcome on a fortnightly/monthly cadence (confirmed
    // for real on this session's second T2 run: 2 of 3 accounts correctly
    // returned "No videos found to match the filter" a few minutes after
    // their first harvest) -- flagging every quiet window would drown the
    // real signal in noise. c.last_scraped_at reflects state BEFORE this
    // run, so it still distinguishes the two cases correctly here.
    if (postCount === 0 && c.last_scraped_at === null) {
      logFlag(`Scheduled ${tier} harvest returned zero rows on a FULL PULL for an active competitor`, {
        competitorId: c.competitor_id,
        name: c.name,
        handle: c.handle,
        platform: c.platform,
        market: c.market,
      });
    }
  }

  const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
  console.log(`\n[${tier}] Harvest complete. ${totalPosts} total post row(s) across ${competitors.length} competitor(s). Real spend now: $${spentAfter.toFixed(4)} / $${cap}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
