/**
 * T1 harvest entry point -- manual-trigger only, deliberately NOT wired
 * to any scheduler (T1's weekly cadence per schedule.md stays a human
 * decision, not a cron job, same as scheduled_harvest.ts's header always
 * said). Built because 7 T1 accounts are TikTok and, until now, no
 * script could harvest a T1 TikTok account: scheduled_harvest.ts refuses
 * T1 by design, and harvest_posts.ts is Instagram-only.
 *
 * Shares all platform-aware/cap-aware/incremental harvest logic with
 * scheduled_harvest.ts via scripts/lib/harvest.ts rather than duplicating
 * it -- that logic already had two real bugs found and fixed once
 * (TikTok date-format, zero-new-posts placeholder items); a second copy
 * would have started from the pre-fix version.
 *
 * Usage: npm run harvest-t1
 */

import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import {
  type ActorsConfig,
  type Competitor,
  logFlag,
  getRealMonthToDateSpendUsd,
  estimateRunCostUsd,
  harvestCompetitors,
} from "./lib/harvest.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

async function main() {
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");

  const supabase = getSupabaseClient();
  const { readFileSync } = await import("node:fs");
  const actors = JSON.parse(readFileSync(ACTORS_PATH, "utf-8")) as ActorsConfig;

  const { data, error } = await supabase
    .from("competitors")
    .select("competitor_id, name, platform, market, handle, posts_per_run, last_scraped_at, tier")
    .eq("tier", "T1")
    .eq("active", true)
    .eq("handle_verified", true);

  if (error) throw new Error(`Failed to read competitors: ${error.message}`);
  const competitors = (data ?? []) as Competitor[];
  if (competitors.length === 0) {
    console.log("No active, verified T1 competitors. Nothing to harvest.");
    return;
  }

  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getRealMonthToDateSpendUsd(apifyToken);
  const estimate = estimateRunCostUsd(competitors);
  console.log(`[T1] ${competitors.length} competitor(s). Real spend so far this cycle: $${spentSoFar.toFixed(4)}. Estimated cost of this run: $${estimate.toFixed(4)}. Cap: $${cap}.`);

  if (spentSoFar + estimate > cap) {
    const message = `SKIPPED T1 harvest: real spend $${spentSoFar.toFixed(4)} + estimated $${estimate.toFixed(4)} would exceed the $${cap} monthly cap.`;
    console.error(`\n*** ${message} ***\n`);
    logFlag("harvest-t1", message, { spentSoFar, estimate, cap, competitorCount: competitors.length });
    return; // skip, not fail -- exit 0
  }

  const totalPosts = await harvestCompetitors(supabase, actors, apifyToken, competitors, "T1", "harvest-t1");

  const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
  console.log(`\n[T1] Harvest complete. ${totalPosts} total post row(s) across ${competitors.length} competitor(s). Real spend now: $${spentAfter.toFixed(4)} / $${cap}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
