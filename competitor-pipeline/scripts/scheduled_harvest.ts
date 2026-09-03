/**
 * Scheduled harvest entry point -- the actual runner behind schedule.md's
 * T2 fortnightly / T3 monthly cadence. T1 is exempt from scoring and is
 * refused here on purpose (weekly T1 harvest is a separate, manual
 * concern -- see harvest_t1.ts -- not wired to this scheduler).
 *
 * Platform-aware, cap-aware, incremental, zero-row-alerting harvest logic
 * lives in scripts/lib/harvest.ts and is shared with harvest_t1.ts. See
 * that file's header comment for the reasoning behind each of those
 * behaviors (TikTok batching, date-format normalization, the placeholder-
 * item filter, full-pull-vs-incremental zero-row semantics).
 *
 * Never schedules transcription -- that stays a separate, manual/human
 * step per schedule.md.
 *
 * Usage: npm run scheduled-harvest -- --tier T2 [--platform instagram|tiktok]
 *
 * --platform is optional and narrows the run to one platform. Both
 * platforms are harvested when it is omitted, which stays the default
 * cadence behaviour. It exists because the two platforms have very
 * different per-run economics -- the TikTok actor carries a $0.50/run
 * minimum -- so newly promoted Instagram accounts can be backfilled
 * without paying to re-pull TikTok in the same breath.
 */

import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import {
  type ActorsConfig,
  type Competitor,
  type Tier,
  logFlag,
  getRealMonthToDateSpendUsd,
  estimateRunCostUsd,
  harvestCompetitors,
} from "./lib/harvest.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

async function main() {
  const tierArgIndex = process.argv.indexOf("--tier");
  const tier = (tierArgIndex >= 0 ? process.argv[tierArgIndex + 1] : null) as Tier | null;
  if (!tier || !["T2", "T3"].includes(tier)) {
    throw new Error("Usage: scheduled_harvest.ts --tier <T2|T3> [--platform instagram|tiktok] (T1 is exempt from this scheduler -- see harvest_t1.ts)");
  }

  const platformArgIndex = process.argv.indexOf("--platform");
  const platform = platformArgIndex >= 0 ? process.argv[platformArgIndex + 1] : null;
  if (platform && !["instagram", "tiktok"].includes(platform)) {
    throw new Error(`--platform must be instagram or tiktok, got "${platform}".`);
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
  let query = supabase
    .from("competitors")
    .select("competitor_id, name, platform, market, handle, posts_per_run, last_scraped_at, tier")
    .eq("tier", tier)
    .eq("active", true)
    .eq("handle_verified", true);
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;

  if (error) throw new Error(`Failed to read competitors: ${error.message}`);
  const competitors = (data ?? []) as Competitor[];
  if (competitors.length === 0) {
    console.log(`No active, verified ${tier}${platform ? ` ${platform}` : ""} competitors. Nothing to harvest.`);
    return;
  }

  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getRealMonthToDateSpendUsd(apifyToken);
  const estimate = estimateRunCostUsd(competitors);
  const label = platform ? `${tier}/${platform}` : tier;
  console.log(`[${label}] ${competitors.length} competitor(s). Real spend so far this cycle: $${spentSoFar.toFixed(4)}. Estimated cost of this run: $${estimate.toFixed(4)}. Cap: $${cap}.`);

  if (spentSoFar + estimate > cap) {
    const message = `SKIPPED ${label} harvest: real spend $${spentSoFar.toFixed(4)} + estimated $${estimate.toFixed(4)} would exceed the $${cap} monthly cap.`;
    console.error(`\n*** ${message} ***\n`);
    logFlag("scheduled-harvest", message, { tier, platform, spentSoFar, estimate, cap, competitorCount: competitors.length });
    return; // skip, not fail -- exit 0
  }

  const totalPosts = await harvestCompetitors(supabase, actors, apifyToken, competitors, `Scheduled ${label}`, "scheduled-harvest");

  const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
  console.log(`\n[${tier}] Harvest complete. ${totalPosts} total post row(s) across ${competitors.length} competitor(s). Real spend now: $${spentAfter.toFixed(4)} / $${cap}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
