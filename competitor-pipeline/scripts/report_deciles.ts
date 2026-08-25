/**
 * Prints the full vpf distribution (deciles) per active T2/T3 account,
 * video posts only -- not just what clears v_outliers. Useful for sanity-
 * checking whether outlier thresholds (config.ts: OUTLIER_*,
 * MIN_ACCOUNT_MEDIAN_VPF, MIN_OUTLIER_VIEWS) are actually reasonable
 * against each account's real spread, not just eyeballing a handful of
 * posts that happened to clear the bar.
 *
 * Usage: npm run report-deciles
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const supabase = getSupabaseClient();

const { data: competitors } = await supabase
  .from("competitors")
  .select("competitor_id, name, tier")
  .in("tier", ["T2", "T3"])
  .eq("active", true);

for (const c of competitors ?? []) {
  const { data: baseline } = await supabase
    .from("v_competitor_baseline")
    .select("baseline_median_vpf, posts_in_window")
    .eq("competitor_id", c.competitor_id)
    .maybeSingle();

  const { data: metrics } = await supabase
    .from("v_post_metrics")
    .select("vpf, post_type, posted_at")
    .eq("competitor_id", c.competitor_id)
    .not("vpf", "is", null);

  const videoVpfs = (metrics ?? [])
    .filter((m) => (m.post_type ?? "").toLowerCase() === "video")
    .map((m) => Number(m.vpf))
    .sort((a, b) => a - b);

  console.log(`=== ${c.name} (${c.tier}) ===`);
  console.log(`  video posts w/ non-null vpf (all-time, not just 90d window): ${videoVpfs.length}`);
  console.log(
    `  baseline: ${baseline ? `median_vpf=${baseline.baseline_median_vpf}, posts_in_window=${baseline.posts_in_window}` : "NONE (< 5 in 90d window)"}`
  );

  if (videoVpfs.length === 0) {
    console.log("");
    continue;
  }

  const deciles: number[] = [];
  for (let d = 0; d <= 10; d++) {
    const idx = Math.min(videoVpfs.length - 1, Math.round((d / 10) * (videoVpfs.length - 1)));
    deciles.push(videoVpfs[idx]);
  }
  const median = baseline?.baseline_median_vpf ? Number(baseline.baseline_median_vpf) : videoVpfs[Math.floor(videoVpfs.length / 2)];

  console.log("  decile | vpf | x-median");
  const labels = ["p0(min)", "p10", "p20", "p30", "p40", "p50", "p60", "p70", "p80", "p90", "p100(max)"];
  for (let i = 0; i < deciles.length; i++) {
    const xMedian = median ? (deciles[i] / median).toFixed(2) : "n/a";
    console.log(`  ${labels[i].padEnd(10)} | ${deciles[i].toFixed(5)} | ${xMedian}x`);
  }
  console.log("");
}
