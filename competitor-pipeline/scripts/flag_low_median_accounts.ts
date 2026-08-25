/**
 * Syncs competitors.low_median_flag (+ a reason appended to notes) from
 * v_competitor_baseline against config.FOLLOWER_BANDS, resolving each
 * account's band from its most recent competitor_snapshots row (not
 * stored on the account -- accounts move between bands as they grow, so
 * this is recomputed fresh every run, same as v_outliers does at query
 * time).
 *
 * This is visibility only -- the actual exclusion from v_outliers is baked
 * directly into that view's SQL (migration 007), so v_outliers stays
 * correct even if this script hasn't been run recently. Run this after
 * each harvest so the registry reflects current account health without
 * anyone having to join to v_competitor_baseline by hand.
 *
 * Idempotent: clears the flag (and appends a "recovered" note) if an
 * account's median has since climbed back above its band's threshold, or
 * if it moved into a band with a lower threshold.
 *
 * Usage: npm run flag-low-median
 */

import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

function resolveBand(followers: number) {
  for (const band of config.FOLLOWER_BANDS) {
    if (followers < band.maxFollowers) return band;
  }
  return config.FOLLOWER_BANDS[config.FOLLOWER_BANDS.length - 1];
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: baselines, error: baselineError } = await supabase
    .from("v_competitor_baseline")
    .select("competitor_id, baseline_median_vpf, posts_in_window");
  if (baselineError) throw new Error(`Failed to read v_competitor_baseline: ${baselineError.message}`);

  const { data: competitors, error: competitorsError } = await supabase
    .from("competitors")
    .select("competitor_id, name, tier, low_median_flag, notes")
    .in("tier", ["T2", "T3"])
    .eq("active", true);
  if (competitorsError) throw new Error(`Failed to read competitors: ${competitorsError.message}`);

  // Most recent snapshot per competitor, to resolve each account's band --
  // same "most recent by scraped_at" logic v_outliers uses at query time.
  const { data: snapshots, error: snapshotsError } = await supabase
    .from("competitor_snapshots")
    .select("competitor_id, followers, scraped_at")
    .order("scraped_at", { ascending: false });
  if (snapshotsError) throw new Error(`Failed to read competitor_snapshots: ${snapshotsError.message}`);

  const latestFollowersByCompetitor = new Map<string, number | null>();
  for (const s of snapshots ?? []) {
    if (!latestFollowersByCompetitor.has(s.competitor_id)) {
      latestFollowersByCompetitor.set(s.competitor_id, s.followers);
    }
  }

  const baselineByCompetitor = new Map((baselines ?? []).map((b) => [b.competitor_id, b]));
  const today = new Date().toISOString().slice(0, 10);

  let flagged = 0;
  let cleared = 0;

  for (const c of competitors ?? []) {
    const baseline = baselineByCompetitor.get(c.competitor_id);
    const median = baseline ? Number(baseline.baseline_median_vpf) : null;
    const followers = latestFollowersByCompetitor.get(c.competitor_id) ?? null;

    if (median === null || followers === null) {
      // No baseline yet, or no snapshot yet -- nothing to evaluate. Leave
      // the existing flag alone rather than guessing.
      continue;
    }

    const band = resolveBand(followers);
    const shouldFlag = median < band.minMedianVpf;

    if (shouldFlag === c.low_median_flag) continue; // already in sync

    const noteAddition = shouldFlag
      ? `LOW_MEDIAN_VPF flag (${today}): median_vpf=${median.toFixed(5)} < ${band.name}-band threshold ${band.minMedianVpf} (followers=${followers}, ${baseline!.posts_in_window} posts in window). Excluded from v_outliers -- see FOLLOWER_BANDS in config.ts.`
      : `LOW_MEDIAN_VPF flag cleared (${today}): median_vpf=${median.toFixed(5)} now >= ${band.name}-band threshold ${band.minMedianVpf} (followers=${followers}).`;

    const newNotes = c.notes ? `${c.notes} | ${noteAddition}` : noteAddition;

    const { error } = await supabase
      .from("competitors")
      .update({ low_median_flag: shouldFlag, notes: newNotes })
      .eq("competitor_id", c.competitor_id);
    if (error) {
      console.error(`Failed to update ${c.name}: ${error.message}`);
      continue;
    }

    if (shouldFlag) {
      flagged += 1;
      console.log(`FLAGGED: ${c.name} (${c.tier}, ${band.name} band, followers=${followers}) -- median_vpf=${median.toFixed(5)} < ${band.minMedianVpf}`);
    } else {
      cleared += 1;
      console.log(`CLEARED: ${c.name} (${c.tier}, ${band.name} band, followers=${followers}) -- median_vpf=${median.toFixed(5)} >= ${band.minMedianVpf}`);
    }
  }

  console.log(`\n${flagged} newly flagged, ${cleared} cleared, ${(competitors?.length ?? 0) - flagged - cleared} unchanged.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
