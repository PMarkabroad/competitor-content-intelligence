/**
 * Shared platform-aware harvest logic, extracted from scheduled_harvest.ts
 * (T2/T3) so scripts/harvest_t1.ts doesn't duplicate ~200 lines of it --
 * including two real bugs already found and fixed once in this exact
 * code (the TikTok date-filter "+00:00" vs "Z" format, and the
 * zero-new-posts placeholder item crashing ingestPost). A future fix
 * belongs here once, not in two copies that can drift apart.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import type { getSupabaseClient } from "./supabaseClient.ts";
import { config } from "../../config.ts";
import { ingestProfile, ingestPost } from "../ingest.ts";

const LOG_DIR = new URL("../../logs/", import.meta.url);

export type Tier = "T1" | "T2" | "T3";

export interface ActorPin {
  actorId: string;
  build: string;
}

export interface ActorsConfig {
  profile: ActorPin;
  posts: ActorPin;
  tiktokPosts: ActorPin;
}

export interface Competitor {
  competitor_id: string;
  name: string;
  platform: string;
  market: string;
  handle: string;
  posts_per_run: number | null;
  last_scraped_at: string | null;
  tier: Tier;
}

export function logFlag(logFilePrefix: string, message: string, context: Record<string, unknown>) {
  const entry = { level: "error", message, context, at: new Date().toISOString() };
  console.error(JSON.stringify(entry));
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(
    new URL(`${logFilePrefix}-${new Date().toISOString().slice(0, 10)}.log`, LOG_DIR),
    JSON.stringify(entry) + "\n"
  );
}

export async function runApifyActor(
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

export async function getRealMonthToDateSpendUsd(apifyToken: string): Promise<number> {
  const res = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apifyToken}`);
  if (!res.ok) {
    throw new Error(`Could not fetch Apify usage: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: { totalUsageCreditsUsdAfterVolumeDiscount: number } };
  return json.data.totalUsageCreditsUsdAfterVolumeDiscount;
}

export function estimateRunCostUsd(competitors: Competitor[]): number {
  return competitors.reduce((sum, c) => {
    const maxResults = c.posts_per_run ?? config.POSTS_PER_RUN[c.tier];
    return sum + config.ESTIMATED_COST_PER_PROFILE_USD + maxResults * config.ESTIMATED_COST_PER_POST_USD;
  }, 0);
}

// TikTok's authorMeta (nested on every video item) -> the flat shape
// ingestProfile expects from Instagram's profile actor.
export function normalizeTikTokProfile(authorMeta: Record<string, unknown>): Record<string, unknown> {
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
export function normalizeTikTokPost(item: Record<string, unknown>): Record<string, unknown> {
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

export async function harvestInstagram(
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
  // On an incremental pull (onlyPostsNewerThan) that matches nothing new,
  // this actor returns one placeholder item instead of an empty array --
  // shaped like {url, inputUrl, requestErrorMessages: [], error: "no_items",
  // errorDescription: "Empty or private data for provided input"}, with no
  // id/postId/shortcode. Confirmed on a real incremental T1 run,
  // 2026-08-26. Same situation as TikTok's "no videos found" placeholder
  // below -- filtered out here rather than passed to ingestPost, which
  // requires a real platform post id.
  const realPostItems = postItems.filter((item) => (item.id ?? item.postId ?? item.shortcode) != null);
  for (const item of realPostItems) {
    await ingestPost(supabase, c.competitor_id, item, runId, followersAtScrape);
  }
  console.log(`  [${c.name}] instagram run_id=${runId}: profile ${profileItems.length}, posts ${realPostItems.length} (requested up to ${postsPerRun}, since=${c.last_scraped_at ?? "(none, full pull)"})`);
  return realPostItems.length;
}

// Batches ALL TikTok competitors sharing the same since-watermark into ONE
// actors.tiktokPosts call -- clockworks/tiktok-scraper has a $0.50
// minimumMaxTotalChargeUsd PER RUN (see actors.json's tiktokSearch/
// tiktokPosts comments), so calling it once per competitor would burn
// most of a tight remaining budget on minimums alone, not on the actual
// per-result cost. oldestPostDateUnified is a single top-level input,
// not per-handle, so competitors are grouped by their exact
// last_scraped_at DATE and one call is made per group (competitors with
// no prior scrape share the group key `null` and get a full pull
// together).
export async function harvestTikTokBatch(
  supabase: ReturnType<typeof getSupabaseClient>,
  actors: ActorsConfig,
  apifyToken: string,
  competitors: Competitor[]
): Promise<Map<string, number>> {
  const postCountByCompetitorId = new Map<string, number>();
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
      // on a real incremental run, 2026-08-26). That's a legitimate
      // "nothing new" result, not a malformed post, so it's filtered out
      // here rather than passed to ingestPost.
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

/**
 * Runs the full platform-aware harvest for a given competitor list:
 * splits by platform, harvests each, flags zero-row full pulls, prints
 * a summary. Shared by scheduled_harvest.ts (T2/T3) and harvest_t1.ts.
 */
export async function harvestCompetitors(
  supabase: ReturnType<typeof getSupabaseClient>,
  actors: ActorsConfig,
  apifyToken: string,
  competitors: Competitor[],
  logLabel: string,
  logFilePrefix: string
): Promise<number> {
  const instagramCompetitors = competitors.filter((c) => c.platform === "instagram");
  const tiktokCompetitors = competitors.filter((c) => c.platform === "tiktok");
  const unknownPlatform = competitors.filter((c) => c.platform !== "instagram" && c.platform !== "tiktok");
  for (const c of unknownPlatform) {
    logFlag(logFilePrefix, `Unknown platform, skipped`, { competitorId: c.competitor_id, name: c.name, platform: c.platform });
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
    // A zero-row FULL pull (no prior last_scraped_at) almost always means
    // a broken handle or a dead actor -- flagged. A zero-row INCREMENTAL
    // pull just means nothing new posted since the watermark, which is
    // routine on any cadence -- c.last_scraped_at reflects state BEFORE
    // this run, so it still distinguishes the two cases correctly here.
    if (postCount === 0 && c.last_scraped_at === null) {
      logFlag(logFilePrefix, `${logLabel} harvest returned zero rows on a FULL PULL for an active competitor`, {
        competitorId: c.competitor_id,
        name: c.name,
        handle: c.handle,
        platform: c.platform,
        market: c.market,
      });
    }
  }

  return totalPosts;
}
