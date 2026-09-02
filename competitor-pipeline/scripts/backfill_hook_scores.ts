/**
 * Backfills hook_library.outlier_score (and vpf) for rows where it's null.
 *
 * Why it goes null in the first place: v_outliers deliberately EXCLUDES
 * posts that already have a transcript, because its job is "what should we
 * spend transcription budget on next". Any workflow that transcribes first
 * and tags second -- which is the normal order -- therefore finds the post
 * already gone from v_outliers by tagging time, and writes a null score.
 * 64 of the first 66 hook_library rows landed that way on 2026-09-02.
 *
 * The score is recomputed here from its actual definition rather than read
 * back out of that view: outlier_score = post vpf / that account's
 * baseline_median_vpf, which is exactly what v_outliers computes and is
 * available from v_post_metrics + v_competitor_baseline regardless of
 * transcription state.
 *
 * A competitor with no baseline row (fewer than BASELINE_MIN_POSTS scoreable
 * posts in the window, or a non-scoreable tier -- T1 is excluded from
 * scoring by design) genuinely has no defined score, so those rows are left
 * null rather than given a fabricated number.
 *
 * Usage: npm run backfill-hook-scores -- [--dry-run]
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = getSupabaseClient();

  const { data: hooks, error: hErr } = await supabase
    .from("hook_library")
    .select("hook_id, post_id, competitor_id, outlier_score, vpf");
  if (hErr) throw new Error(`Failed to read hook_library: ${hErr.message}`);

  const needScore = (hooks ?? []).filter((h) => h.outlier_score == null || h.vpf == null);
  if (needScore.length === 0) {
    console.log("Every hook_library row already has an outlier_score and vpf. Nothing to backfill.");
    return;
  }

  const postIds = needScore.map((h) => h.post_id);

  // Filtered server-side: an unfiltered select on v_post_metrics silently
  // truncates at Postgrest's 1000-row default, which quietly under-reports
  // once the corpus passes that size.
  const { data: metrics, error: mErr } = await supabase
    .from("v_post_metrics")
    .select("post_id, competitor_id, vpf")
    .in("post_id", postIds);
  if (mErr) throw new Error(`Failed to read v_post_metrics: ${mErr.message}`);
  const metricByPost = new Map((metrics ?? []).map((m) => [m.post_id, m]));

  const { data: baselines, error: bErr } = await supabase
    .from("v_competitor_baseline")
    .select("competitor_id, baseline_median_vpf");
  if (bErr) throw new Error(`Failed to read v_competitor_baseline: ${bErr.message}`);
  const baseByComp = new Map(
    (baselines ?? []).map((b) => [b.competitor_id, b.baseline_median_vpf as number])
  );

  let updated = 0;
  let noBaseline = 0;
  let noMetrics = 0;

  for (const h of needScore) {
    const m = metricByPost.get(h.post_id);
    if (!m || m.vpf == null) {
      noMetrics++;
      continue;
    }
    const median = baseByComp.get(h.competitor_id);
    const vpf = m.vpf as number;

    // vpf is still worth writing even with no baseline -- it's a real
    // measured value; only the RELATIVE score needs the baseline.
    const patch: Record<string, number> = { vpf };
    if (median && median > 0) {
      patch.outlier_score = vpf / median;
    } else {
      noBaseline++;
    }

    if (dryRun) {
      console.log(`  ${h.post_id}: vpf=${vpf.toFixed(4)}${patch.outlier_score ? ` score=${patch.outlier_score.toFixed(2)}x` : " (no baseline -- score left null)"}`);
      updated++;
      continue;
    }

    const { error } = await supabase.from("hook_library").update(patch).eq("hook_id", h.hook_id);
    if (error) {
      console.error(`  ${h.post_id}: UPDATE FAILED -- ${error.message}`);
      continue;
    }
    updated++;
  }

  console.log(
    `\n${dryRun ? "Would update" : "Updated"} ${updated} row(s). ` +
      `${noBaseline} had no competitor baseline (score left null on purpose), ` +
      `${noMetrics} had no metrics row at all.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
