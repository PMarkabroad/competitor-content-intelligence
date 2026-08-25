/**
 * The only script in this pipeline that calls Apify, and only when run
 * explicitly by a human with a single --handle argument. No batch mode.
 *
 * Proves the profile -> posts -> ingest chain and the follower-count join
 * (v_post_metrics) work end-to-end against one real account, at a hard cap
 * of 5 posts, before anything runs at volume. Transcripts and scoring
 * beyond v_post_metrics stay untouched here -- vpf is meaningless if the
 * snapshot join is wrong, so that's the one thing this proves.
 *
 * Usage: npm run smoke-test -- --handle theselfconceptlab
 */

import { readFileSync } from "node:fs";
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const SMOKE_TEST_POST_CAP = 5;
const PREFLIGHT_FRESHNESS_MS = 60 * 60 * 1000; // 1 hour
const PREFLIGHT_STATE_PATH = new URL("../out/preflight_last_pass.json", import.meta.url);
const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

interface ActorPin {
  actorId: string;
  build: string;
}

interface ActorsConfig {
  profile: ActorPin;
  posts: ActorPin;
}

function assertPreflightRecentlyPassed() {
  let state: { passedAt: string };
  try {
    state = JSON.parse(readFileSync(PREFLIGHT_STATE_PATH, "utf-8"));
  } catch {
    throw new Error(
      "preflight.ts has not been run (no out/preflight_last_pass.json). " +
        "Run `npm run preflight` and make it pass before running smoke_test.ts."
    );
  }

  const passedAtMs = Date.parse(state.passedAt);
  if (Number.isNaN(passedAtMs)) {
    throw new Error("out/preflight_last_pass.json is malformed. Re-run `npm run preflight`.");
  }

  const ageMs = Date.now() - passedAtMs;
  if (ageMs > PREFLIGHT_FRESHNESS_MS) {
    throw new Error(
      `preflight.ts last passed ${Math.round(ageMs / 60000)} minute(s) ago, ` +
        `more than the ${PREFLIGHT_FRESHNESS_MS / 60000}-minute freshness window. ` +
        "Re-run `npm run preflight` before smoke_test.ts."
    );
  }
}

async function runApifyActor(
  pin: ActorPin,
  input: Record<string, unknown>,
  apifyToken: string
): Promise<Record<string, unknown>[]> {
  // Apify's API path form uses ~ in place of the store's / separator
  // (e.g. "apify/instagram-profile-scraper" -> "apify~instagram-profile-scraper").
  const pathActorId = pin.actorId.replace("/", "~");
  const url =
    `https://api.apify.com/v2/acts/${pathActorId}/run-sync-get-dataset-items` +
    `?token=${apifyToken}&build=${encodeURIComponent(pin.build)}`;
  const runRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!runRes.ok) {
    throw new Error(
      `Apify actor ${pin.actorId}:${pin.build} failed: ${runRes.status} ${runRes.statusText}`
    );
  }
  return (await runRes.json()) as Record<string, unknown>[];
}

async function main() {
  const handleArgIndex = process.argv.indexOf("--handle");
  const handle = handleArgIndex >= 0 ? process.argv[handleArgIndex + 1] : null;
  if (!handle) {
    throw new Error("Usage: smoke_test.ts --handle <single-handle>");
  }

  assertPreflightRecentlyPassed();

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    throw new Error("APIFY_TOKEN must be set (see .env.example).");
  }

  const actors: ActorsConfig = JSON.parse(readFileSync(ACTORS_PATH, "utf-8"));
  for (const [role, pin] of Object.entries(actors)) {
    if (pin.actorId === "REPLACE_ME" || !pin.build || pin.build === "latest") {
      throw new Error(
        `apify/actors.json's "${role}" entry is not properly pinned (actorId/build). ` +
          "Pin a real actor ID and exact build before running smoke_test.ts " +
          "(preflight.ts should have already caught this)."
      );
    }
  }

  const supabase = getSupabaseClient();

  const { data: competitor, error: competitorError } = await supabase
    .from("competitors")
    .select("competitor_id, name, tier, platform")
    .eq("handle", handle)
    .single();

  if (competitorError || !competitor) {
    throw new Error(
      `No competitor found with handle "${handle}". It must exist in the registry ` +
        `(load it via load_registry.ts or apply_worksheet.ts first).`
    );
  }

  console.log(`Smoke testing ${competitor.name} (${handle}), hard-capped at ${SMOKE_TEST_POST_CAP} posts.`);

  // 1. Profile actor. Input field is `usernames` (confirmed against the
  // actor's live input schema on 2026-08-25), not `handles`.
  const profileItems = await runApifyActor(
    actors.profile,
    { usernames: [handle] },
    apifyToken
  );
  console.log(`Profile actor returned ${profileItems.length} item(s).`);

  // 2. Posts actor, hard-capped regardless of the competitor's configured
  // posts_per_run. Input field is `username` (singular key, array value)
  // and `resultsLimit` (confirmed against the actor's live input schema).
  //
  // dataDetailLevel MUST be "detailedData" -- confirmed against a real
  // response on 2026-08-25 that "basicData" omits video view count
  // entirely (no videoViewCount/videoPlayCount field at all, even for
  // Video/clips posts), which makes vpf permanently null. detailedData is
  // a paid add-on (~$0.001/post extra on top of the base ~$0.0017/post),
  // trivial at this pipeline's scale but not free -- don't revert this to
  // basicData to save pennies, it silently breaks the entire scoring chain.
  const postItems = await runApifyActor(
    actors.posts,
    { username: [handle], resultsLimit: SMOKE_TEST_POST_CAP, dataDetailLevel: "detailedData" },
    apifyToken
  );
  console.log(`Posts actor returned ${postItems.length} item(s) (capped at ${SMOKE_TEST_POST_CAP}).`);

  // 3. Ingest both, via the same per-item functions production webhook
  // delivery uses (ingest.ts's handleWebhook fetches a dataset from an
  // Apify dataset id; smoke_test already has the items in memory from the
  // sync run above, so it calls the same underlying ingestProfile /
  // ingestPost functions directly instead of round-tripping through a
  // webhook payload shape).
  const { ingestProfile, ingestPost } = await import("./ingest.ts");

  const runId = crypto.randomUUID();
  console.log(`run_id: ${runId}`);

  for (const item of profileItems) {
    await ingestProfile(supabase, competitor.competitor_id, item, runId);
  }
  // Pass the just-scraped follower count directly rather than letting
  // ingestPost re-query it -- we already have it in memory from the
  // profile call two lines above, in the same run.
  const followersAtScrape =
    (profileItems[0]?.followersCount as number | undefined) ??
    (profileItems[0]?.followers as number | undefined) ??
    null;
  for (const item of postItems) {
    await ingestPost(supabase, competitor.competitor_id, item, runId, followersAtScrape);
  }
  console.log(`Ingested ${profileItems.length} profile item(s) and ${postItems.length} post item(s).`);

  const afterSnapshots = await supabase
    .from("competitor_snapshots")
    .select("snapshot_id", { count: "exact", head: true })
    .eq("competitor_id", competitor.competitor_id);
  const afterPosts = await supabase
    .from("competitor_posts")
    .select("post_id", { count: "exact", head: true })
    .eq("competitor_id", competitor.competitor_id);

  console.log(`\ncompetitor_snapshots rows for ${handle}: ${afterSnapshots.count ?? 0}`);
  console.log(`competitor_posts rows for ${handle}: ${afterPosts.count ?? 0}`);

  const { data: metrics, error: metricsError } = await supabase
    .from("v_post_metrics")
    .select("*")
    .eq("competitor_id", competitor.competitor_id);

  if (metricsError) {
    console.log(`\nv_post_metrics query failed: ${metricsError.message}`);
  } else {
    console.log(`\nv_post_metrics for ${handle}:`);
    console.log(JSON.stringify(metrics, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
