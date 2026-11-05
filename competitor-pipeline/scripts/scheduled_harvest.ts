/**
 * Scheduled harvest entry point -- one weekly run over the whole active,
 * handle-verified roster.
 *
 * It used to be two runs an hour apart, one per tier. Migration 020 retired
 * tiers: the split had stopped meaning anything (every account was T2 or T3,
 * so the "scoreable tiers" filter excluded nobody, and every row overrode the
 * per-tier posts_per_run default), while `category` had taken over the real
 * analytical distinction. One run is simpler, and it is also kinder to the
 * stage guard -- a 9-account run fails its 90% floor the moment one account
 * fails to produce, where a 23-account run tolerates two.
 *
 * Platform-aware, cap-aware, incremental, zero-row-alerting harvest logic
 * lives in scripts/lib/harvest.ts. See that file's header comment for the
 * reasoning behind each of those behaviors (TikTok batching, date-format
 * normalization, the placeholder-item filter, full-pull-vs-incremental
 * zero-row semantics).
 *
 * Never schedules transcription -- that stays a separate step.
 *
 * Usage: npm run scheduled-harvest [-- --platform instagram|tiktok]
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
import { recordStage } from "./lib/stage_check.ts";
import {
  type Competitor,
  logFlag,
  loadActors,
  getRealMonthToDateSpendUsd,
  estimateRunCostUsd,
  harvestCompetitors,
} from "./lib/harvest.ts";


async function main() {
  const platformArgIndex = process.argv.indexOf("--platform");
  const platform = platformArgIndex >= 0 ? process.argv[platformArgIndex + 1] : null;
  if (platform && !["instagram", "tiktok"].includes(platform)) {
    throw new Error(`--platform must be instagram or tiktok, got "${platform}".`);
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");

  const supabase = getSupabaseClient();
  const actors = loadActors();

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
    .select("competitor_id, name, platform, market, handle, posts_per_run, last_scraped_at, category")
    .eq("active", true)
    .eq("handle_verified", true);
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;

  if (error) throw new Error(`Failed to read competitors: ${error.message}`);
  const competitors = (data ?? []) as Competitor[];
  if (competitors.length === 0) {
    console.log(`No active, verified${platform ? ` ${platform}` : ""} competitors. Nothing to harvest.`);
    // Recorded even with nothing to do: a stage absent from the summary is
    // indistinguishable from one that died before its check.
    recordStage({ stage: "harvest", expected: 0, actual: 0, detail: "no active verified competitors" });
    return;
  }

  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getRealMonthToDateSpendUsd(apifyToken);
  const estimate = estimateRunCostUsd(competitors);
  const label = platform ? `roster/${platform}` : "roster";
  console.log(`[${label}] ${competitors.length} competitor(s). Real spend so far this cycle: $${spentSoFar.toFixed(4)}. Estimated cost of this run: $${estimate.toFixed(4)}. Cap: $${cap}.`);

  if (spentSoFar + estimate > cap) {
    const message = `SKIPPED ${label} harvest: real spend $${spentSoFar.toFixed(4)} + estimated $${estimate.toFixed(4)} would exceed the $${cap} monthly cap.`;
    console.error(`\n*** ${message} ***\n`);
    logFlag("scheduled-harvest", message, { platform, spentSoFar, estimate, cap, competitorCount: competitors.length });
    // A budget skip exits 0 by design -- a decision, not a fault -- but it has
    // to be visible. A summary that just omits harvest reads like a quiet
    // week rather than a capped one, and those need different responses.
    recordStage({
      stage: "harvest",
      expected: 0,
      actual: 0,
      detail: `SKIPPED FOR BUDGET: $${spentSoFar.toFixed(2)} spent + $${estimate.toFixed(2)} estimated would exceed the $${cap} cap`,
    });
    return; // skip, not fail -- exit 0
  }

  const { totalPosts, accountsWithPosts, accountsExpected, emptyHandles, quietHandles } = await harvestCompetitors(supabase, actors, apifyToken, competitors, `Scheduled ${label}`, "scheduled-harvest");

  const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
  console.log(`\n[${label}] Harvest complete. ${totalPosts} total post row(s) across ${competitors.length} competitor(s). Real spend now: $${spentAfter.toFixed(4)} / $${cap}.`);

  // Measured by ACCOUNT, not by post, and only over accounts that were
  // expected to produce -- a full pull that returned nothing, or an account
  // that did return something. An account with nothing new since its
  // watermark is routine and is reported separately rather than counted as a
  // shortfall; see harvestCompetitors for why that distinction is the whole
  // ballgame on a weekly cadence.
  recordStage({
    stage: "harvest",
    expected: accountsExpected,
    actual: accountsWithPosts,
    emptyItems: emptyHandles,
    detail:
      `${totalPosts} post row(s)` +
      (quietHandles.length > 0 ? `, ${quietHandles.length} account(s) quiet since last run` : ""),
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
