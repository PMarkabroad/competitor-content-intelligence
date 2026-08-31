/**
 * Batch-transcribes current v_outliers rows via the pinned
 * clockworks/tiktok-transcript-extractor actor (DOWNLOAD_SUBTITLES mode
 * -- reuses TikTok's own native captions, no real speech-to-text, see
 * apify/actors.json's tiktokTranscript entry).
 *
 * TikTok only, for now. Confirmed via the actor's own pricing info (GET
 * .../acts/clockworks~tiktok-transcript-extractor) that DOWNLOAD_SUBTITLES
 * mode charges a flat "Video" event (~$0.003/video, BRONZE) with no
 * per-run minimum (minimalMaxTotalChargeUsd: null) -- so unlike the
 * tiktok-scraper actor, there's no cost benefit to batching multiple
 * postURLs into one call. Instagram outliers use a different, ~10-15x
 * more expensive actor (apify/instagram-reel-scraper,
 * ESTIMATED_COST_PER_TRANSCRIPT_USD in config.ts) and are deliberately
 * skipped here rather than silently spending that much per item under a
 * TikTok-sized budget estimate -- flag before wiring that path.
 *
 * Called ONE POST PER ACTOR RUN, not batched, because a real prior
 * transcript row's raw JSON showed this actor's DOWNLOAD_SUBTITLES output
 * item carries only {source, vttUrl, transcript} -- no input URL/id
 * echoed back -- so a multi-URL batch response couldn't be reliably
 * mapped back to the post it came from. One call per post makes that
 * mapping trivial (the post_id is already known before the call) instead
 * of guessing at a match.
 *
 * v_outliers already excludes posts that already have a transcript (its
 * own `not exists (select 1 from competitor_transcripts...)` clause), so
 * this script doesn't re-check that itself.
 *
 * Usage: npm run transcribe-outliers [-- --limit=N]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { ingestTranscript } from "./ingest.ts";
import { runApifyActor, getRealMonthToDateSpendUsd, logFlag } from "./lib/harvest.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

// BRONZE "Video" event charge for DOWNLOAD_SUBTITLES mode -- confirmed
// live via the actor's pricingInfos, 2026-08-26 (no per-run minimum).
const TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD = 0.003;

interface OutlierRow {
  post_id: string;
  competitor_id: string;
  outlier_score: number;
}

async function main() {
  const limitArgIndex = process.argv.indexOf("--limit");
  const limit = limitArgIndex >= 0 ? Number(process.argv[limitArgIndex + 1]) : null;

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");

  const supabase = getSupabaseClient();
  const actors = JSON.parse(readFileSync(ACTORS_PATH, "utf-8"));
  const pin = actors.tiktokTranscript;

  const { data: outliers, error } = await supabase
    .from("v_outliers")
    .select("post_id, competitor_id, outlier_score")
    .order("outlier_score", { ascending: false });
  if (error) throw new Error(`Failed to read v_outliers: ${error.message}`);

  let rows = (outliers ?? []) as OutlierRow[];
  if (limit) rows = rows.slice(0, limit);
  if (rows.length === 0) {
    console.log("No outliers pending transcription.");
    return;
  }

  const competitorIds = Array.from(new Set(rows.map((r) => r.competitor_id)));
  const { data: competitors, error: cErr } = await supabase
    .from("competitors")
    .select("competitor_id, platform")
    .in("competitor_id", competitorIds);
  if (cErr) throw new Error(`Failed to read competitors: ${cErr.message}`);
  const platformById = new Map((competitors ?? []).map((c) => [c.competitor_id, c.platform]));

  const postIds = rows.map((r) => r.post_id);
  const { data: posts, error: pErr } = await supabase
    .from("competitor_posts")
    .select("post_id, post_url")
    .in("post_id", postIds);
  if (pErr) throw new Error(`Failed to read competitor_posts: ${pErr.message}`);
  const urlByPostId = new Map((posts ?? []).map((p) => [p.post_id, p.post_url]));

  const tiktokRows = rows.filter((r) => platformById.get(r.competitor_id) === "tiktok");
  const nonTiktokRows = rows.filter((r) => platformById.get(r.competitor_id) !== "tiktok");

  if (nonTiktokRows.length > 0) {
    console.log(`Skipping ${nonTiktokRows.length} non-TikTok outlier(s) -- this script only handles the cheap TikTok DOWNLOAD_SUBTITLES path. Instagram transcription needs its own confirm-before-spend run.`);
  }

  const targets = tiktokRows
    .map((r) => ({ postId: r.post_id, postUrl: urlByPostId.get(r.post_id) }))
    .filter((t): t is { postId: string; postUrl: string } => {
      if (!t.postUrl) {
        logFlag("transcribe-outliers", "Outlier post has no post_url, skipped", { postId: t.postId });
        return false;
      }
      return true;
    });

  if (targets.length === 0) {
    console.log("No TikTok outliers with a post_url to transcribe.");
    return;
  }

  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getRealMonthToDateSpendUsd(apifyToken);
  const estimate = targets.length * TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD;
  console.log(`${targets.length} TikTok outlier(s) to transcribe. Real spend so far: $${spentSoFar.toFixed(4)}. Estimated cost: $${estimate.toFixed(4)}. Cap: $${cap}.`);

  if (spentSoFar + estimate > cap) {
    const message = `SKIPPED transcription: real spend $${spentSoFar.toFixed(4)} + estimated $${estimate.toFixed(4)} would exceed the $${cap} monthly cap.`;
    console.error(`\n*** ${message} ***\n`);
    logFlag("transcribe-outliers", message, { spentSoFar, estimate, cap, count: targets.length });
    return;
  }

  let transcribed = 0;
  let noCaptions = 0;
  let failed = 0;

  for (const [i, target] of targets.entries()) {
    try {
      const items = await runApifyActor(
        pin,
        { postURLs: [target.postUrl], downloadSubtitlesOptions: "DOWNLOAD_SUBTITLES" },
        apifyToken
      );
      const item = items[0];
      if (!item || (!item.transcript && !item.captionText)) {
        noCaptions++;
        console.log(`  [${i + 1}/${targets.length}] ${target.postId}: no native captions available`);
        continue;
      }
      await ingestTranscript(supabase, target.postId, item);
      transcribed++;
      console.log(`  [${i + 1}/${targets.length}] ${target.postId}: transcribed`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${targets.length}] ${target.postId}: FAILED -- ${message}`);
      logFlag("transcribe-outliers", "Transcript actor call failed for a post", { postId: target.postId, postUrl: target.postUrl, error: message });
    }
  }

  const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
  console.log(`\nDone. ${transcribed} transcribed, ${noCaptions} had no native captions, ${failed} failed. Real spend now: $${spentAfter.toFixed(4)} / $${cap}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
