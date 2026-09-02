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
 * MODES (--mode=, actor's downloadSubtitlesOptions enum):
 *   DOWNLOAD_SUBTITLES (default) -- reuse TikTok's own caption track only.
 *     Flat ~$0.003/video, no speech-to-text. Cheap, but PROVEN USELESS on
 *     this roster: a full run over 68 outliers on 2026-08-31 returned
 *     0 usable transcripts -- none of these accounts publish native
 *     captions. Kept as the default anyway since it's the only mode that
 *     can't run up a real bill by accident.
 *   DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES -- reuse captions
 *     where they exist, real speech-to-text where they don't. Strictly
 *     dominant over TRANSCRIBE_ALL_VIDEOS (never more expensive, cheaper
 *     whenever a caption track does exist), so this is the one to reach
 *     for when the cheap mode comes back empty.
 *   TRANSCRIBE_ALL_VIDEOS -- speech-to-text on everything, ignoring any
 *     existing caption track. No reason to pick this over the hybrid.
 *
 * The two speech-to-text modes bill an ADD-ON ~$0.041 per STARTED minute
 * per video on top of the flat per-video charge -- a 61-second video is
 * billed as 2 minutes. The cost estimate below is therefore computed from
 * each post's real `duration_seconds`, not a flat per-video guess.
 *
 * Usage: npm run transcribe-outliers -- [--limit=N] [--mode=<enum>]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { ingestTranscript } from "./ingest.ts";
import { runApifyActor, getRealMonthToDateSpendUsd, logFlag } from "./lib/harvest.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

// BRONZE-tier charges, confirmed live via the actor's pricingInfos
// (2026-08-26/31): a flat "Video" event on every returned video, plus an
// "Add-on: Transcript" event per STARTED minute per video whenever a
// speech-to-text mode is used. No per-run minimum on this actor.
const TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD = 0.003;
const TIKTOK_STT_COST_PER_STARTED_MINUTE_USD = 0.041;

const SUBTITLE_MODES = [
  "DOWNLOAD_SUBTITLES",
  "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES",
  "TRANSCRIBE_ALL_VIDEOS",
] as const;
type SubtitleMode = (typeof SUBTITLE_MODES)[number];

interface OutlierRow {
  post_id: string;
  competitor_id: string;
  outlier_score: number;
}

interface SubtitleLink {
  language?: string;
  downloadLink?: string;
  source?: string;
}

/**
 * This actor does NOT return transcript text inline. It returns
 * `videoMeta.subtitleLinks[]`, each with a `downloadLink` pointing at a
 * .vtt file in an Apify key-value store, which then has to be fetched
 * separately (and WITH the API token -- an unauthenticated GET on that
 * record 403s). An earlier version of this script checked for
 * `item.transcript`/`item.captionText`, fields this actor never emits,
 * and therefore reported "no native captions" for all 68 outliers on
 * 2026-08-31 -- that was this bug, not a real absence of captions.
 */
function pickSubtitleLink(item: Record<string, unknown>): SubtitleLink | null {
  const videoMeta = (item.videoMeta ?? {}) as Record<string, unknown>;
  const links = videoMeta.subtitleLinks;
  if (!Array.isArray(links) || links.length === 0) return null;
  const typed = links as SubtitleLink[];
  // Prefer an English track; within that prefer a non-machine-translation
  // source, since MT of another language reads noticeably worse than the
  // original/ASR track when one exists.
  const english = typed.filter((l) => /^en/i.test(String(l.language ?? "")));
  const pool = english.length > 0 ? english : typed;
  return pool.find((l) => String(l.source ?? "").toUpperCase() !== "MT") ?? pool[0];
}

function parseVtt(vtt: string): string {
  const out: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT") || line.startsWith("NOTE")) continue;
    if (line.includes("-->")) continue; // timing cue
    if (/^\d+$/.test(line)) continue; // cue index
    const cleaned = line.replace(/<[^>]+>/g, "").trim(); // inline markup
    if (!cleaned) continue;
    if (out[out.length - 1] === cleaned) continue; // consecutive duplicate cues
    out.push(cleaned);
  }
  return out.join(" ");
}

async function fetchTranscriptText(
  item: Record<string, unknown>,
  apifyToken: string
): Promise<{ text: string; vttUrl: string } | null> {
  const link = pickSubtitleLink(item);
  if (!link?.downloadLink) return null;
  const res = await fetch(`${link.downloadLink}?token=${apifyToken}`);
  if (!res.ok) {
    throw new Error(`Subtitle fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = parseVtt(await res.text());
  return text ? { text, vttUrl: link.downloadLink } : null;
}

async function main() {
  // "--limit=" (equals-sign style), matching discover.ts's convention --
  // NOT a separate "--limit N" token, which npm's "--" passthrough doesn't
  // require and this codebase doesn't use anywhere else. A first version
  // of this looked for a separate token, silently never matched, and ran
  // all 72 outliers instead of the intended 2 on the first real test.
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;

  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = (modeArg ? modeArg.slice("--mode=".length) : "DOWNLOAD_SUBTITLES") as SubtitleMode;
  if (!SUBTITLE_MODES.includes(mode)) {
    throw new Error(`Unknown --mode=${mode}. Valid: ${SUBTITLE_MODES.join(", ")}`);
  }
  const usesSpeechToText = mode !== "DOWNLOAD_SUBTITLES";

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
    .select("post_id, post_url, duration_seconds")
    .in("post_id", postIds);
  if (pErr) throw new Error(`Failed to read competitor_posts: ${pErr.message}`);
  const urlByPostId = new Map((posts ?? []).map((p) => [p.post_id, p.post_url]));
  const durationByPostId = new Map((posts ?? []).map((p) => [p.post_id, p.duration_seconds as number | null]));

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

  // Billed per STARTED minute, so a 61s video costs two minutes' worth --
  // hence ceil() per video, not a total-seconds/60 average. A post with no
  // recorded duration is assumed to be 2 minutes rather than 1, so the
  // estimate errs high and the cap guard below stays conservative.
  const flatCost = targets.length * TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD;
  let billableStartedMinutes = 0;
  for (const t of targets) {
    const seconds = durationByPostId.get(t.postId);
    billableStartedMinutes += seconds == null ? 2 : Math.max(1, Math.ceil(seconds / 60));
  }
  const sttCost = usesSpeechToText ? billableStartedMinutes * TIKTOK_STT_COST_PER_STARTED_MINUTE_USD : 0;
  const estimate = flatCost + sttCost;

  console.log(`${targets.length} TikTok outlier(s) to transcribe. Mode: ${mode}.`);
  if (usesSpeechToText) {
    console.log(`  Speech-to-text billing: ${billableStartedMinutes} started-minute(s) x $${TIKTOK_STT_COST_PER_STARTED_MINUTE_USD} = $${sttCost.toFixed(4)}, plus $${flatCost.toFixed(4)} flat per-video.`);
  }
  console.log(`Real spend so far: $${spentSoFar.toFixed(4)}. Estimated cost: $${estimate.toFixed(4)}. Cap: $${cap}.`);

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
        { postURLs: [target.postUrl], downloadSubtitlesOptions: mode },
        apifyToken
      );
      const item = items[0];
      const result = item ? await fetchTranscriptText(item, apifyToken) : null;
      if (!result) {
        noCaptions++;
        const why = usesSpeechToText
          ? "EMPTY RESULT despite speech-to-text mode"
          : "no subtitle track on this video";
        console.log(`  [${i + 1}/${targets.length}] ${target.postId}: ${why}`);
        if (usesSpeechToText) {
          logFlag("transcribe-outliers", "Speech-to-text mode returned no transcript for a post", { postId: target.postId, postUrl: target.postUrl, mode });
        }
        continue;
      }
      // Shaped to match what ingestTranscript reads (`transcript`) and the
      // provenance shape already stored on the pre-existing rows.
      await ingestTranscript(supabase, target.postId, {
        transcript: result.text,
        raw: { source: `${pin.actorId}:${pin.build}`, vttUrl: result.vttUrl, mode },
      });
      transcribed++;
      console.log(`  [${i + 1}/${targets.length}] ${target.postId}: transcribed (${result.text.length} chars)`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${targets.length}] ${target.postId}: FAILED -- ${message}`);
      logFlag("transcribe-outliers", "Transcript actor call failed for a post", { postId: target.postId, postUrl: target.postUrl, error: message });
    }
  }

  // A real transient network blip (DNS resolution failure reaching
  // api.apify.com) hit this exact call on the first real test run, after
  // the per-post loop above had already finished and logged its own
  // results -- letting that failure propagate uncaught turned an
  // otherwise-successful run into a nonzero exit with no summary line.
  // The per-post loop already has its own try/catch for the actual
  // transcription work; this is just a closing status check.
  try {
    const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
    console.log(`\nDone (${mode}). ${transcribed} transcribed, ${noCaptions} empty, ${failed} failed. Real spend now: $${spentAfter.toFixed(4)} / $${cap} (this run: $${(spentAfter - spentSoFar).toFixed(4)}).`);
  } catch (err) {
    console.log(`\nDone (${mode}). ${transcribed} transcribed, ${noCaptions} empty, ${failed} failed. (Could not fetch final spend total: ${err instanceof Error ? err.message : String(err)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
