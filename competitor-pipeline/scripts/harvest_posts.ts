/**
 * Full posts harvest for active, verified AU/US competitors -- explicitly
 * excludes CA (handles are being sourced manually there, per instruction).
 *
 * Unlike smoke_test.ts (single handle, hard-capped at 5 posts, no
 * production intent), this pulls each competitor's actual posts_per_run,
 * with no onlyPostsNewerThan watermark -- the goal right now is seeding
 * enough real video posts to clear v_competitor_baseline's 5-post minimum,
 * not an incremental trickle since the smoke tests a few minutes ago.
 * Future scheduled runs (see scripts/schedule.md) would use the watermark
 * via build_run_input.ts; this script is a one-off full-pull harvest.
 *
 * Usage: npm run harvest-posts
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

interface ActorPin {
  actorId: string;
  build: string;
}

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

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

async function main() {
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");

  const { readFileSync } = await import("node:fs");
  const actors = JSON.parse(readFileSync(ACTORS_PATH, "utf-8")) as {
    profile: ActorPin;
    posts: ActorPin;
  };

  const supabase = getSupabaseClient();
  const { ingestProfile, ingestPost } = await import("./ingest.ts");

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("competitor_id, name, handle, market, tier, posts_per_run")
    .eq("active", true)
    .eq("handle_verified", true)
    .in("market", ["AU", "US"]);

  if (error) throw new Error(`Failed to read competitors: ${error.message}`);
  if (!competitors || competitors.length === 0) {
    console.log("No active, verified AU/US competitors found.");
    return;
  }

  console.log(`Harvesting ${competitors.length} competitor(s): ${competitors.map((c) => c.name).join(", ")}\n`);

  for (const c of competitors) {
    const runId = crypto.randomUUID();
    console.log(`--- ${c.name} (${c.handle}, ${c.market}/${c.tier}) run_id=${runId} ---`);

    const profileItems = await runApifyActor(actors.profile, { usernames: [c.handle] }, apifyToken);
    for (const item of profileItems) {
      await ingestProfile(supabase, c.competitor_id, item, runId);
    }
    const followersAtScrape =
      (profileItems[0]?.followersCount as number | undefined) ??
      (profileItems[0]?.followers as number | undefined) ??
      null;
    console.log(`  profile: ${profileItems.length} item(s), followers=${followersAtScrape}`);

    const postsPerRun = c.posts_per_run ?? 20;
    const postItems = await runApifyActor(
      actors.posts,
      { username: [c.handle], resultsLimit: postsPerRun, dataDetailLevel: "detailedData" },
      apifyToken
    );
    for (const item of postItems) {
      await ingestPost(supabase, c.competitor_id, item, runId, followersAtScrape);
    }
    console.log(`  posts: ${postItems.length} item(s) (requested up to ${postsPerRun})\n`);
  }

  console.log("Harvest complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
