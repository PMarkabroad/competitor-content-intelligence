/**
 * Batch-level check that scoring actually HAS inputs.
 *
 * The shape guard inspects the first real item of each actor response. This
 * checks the whole batch after it lands, because the two catch different
 * things: a field renamed for every post is caught by either, but a field
 * that survives on a sample and drops out across the rest is caught only
 * here.
 *
 * It exists because of 2026-11-04. The Instagram post actor moved the view
 * count from videoViewCount (returned as an explicit null) to
 * videoPlayCount. All 460 harvested posts landed with views=null, so every
 * vpf was null, no account had a baseline, and there were zero outliers --
 * while the harvest reported success and exited 0. Nothing downstream could
 * work, and nothing said so.
 *
 * Only VIDEO posts count toward the rate. Carousels and static images have
 * no view count on any platform and never will: of the 110 null-view posts
 * in that run, 95 were carousels, 14 images, and exactly 1 was a video
 * Instagram had withheld the count for. A zero-tolerance rule would fail on
 * that single post forever; a rate threshold tolerates it and still catches
 * a rename, which flips the rate to ~100% at once.
 *
 * Usage: npm run check-scoring-inputs -- [--since=YYYY-MM-DD] [--max-null-rate=0.2]
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

/** Above this fraction of videos missing views, the stage fails. */
const DEFAULT_MAX_NULL_RATE = 0.2;

/**
 * Where each platform's view count lives, most-current first. Kept here as
 * the single record of which field names are live, so a future rename is a
 * one-line change in a place that is checked rather than a silent null.
 *
 * instagram: videoPlayCount since build 0.0.655 (2026-11-04); videoViewCount
 *   is still returned but null, so it stays only as a fallback for rows
 *   ingested under older builds.
 * tiktok: playCount. Checked here too, on request, even with no TikTok
 *   accounts currently active -- the point is to find out from a check
 *   rather than from a month of empty scores when they come back.
 */
export const VIEW_FIELDS: Record<string, string[]> = {
  instagram: ["videoPlayCount", "videoViewCount", "viewCount", "views"],
  tiktok: ["playCount", "videoPlayCount", "viewCount", "views"],
};

function arg(name: string): string | null {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : null;
}

/** Paged: an unfiltered select caps at 1000 rows. */
async function pageAll(
  supabase: ReturnType<typeof getSupabaseClient>,
  table: string,
  cols: string,
  since?: string
) {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const base = supabase.from(table).select(cols);
    const q = since ? base.gte("first_seen_at", since) : base;
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  const since = arg("since") ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const maxNullRate = Number(arg("max-null-rate") ?? DEFAULT_MAX_NULL_RATE);
  const supabase = getSupabaseClient();

  const competitors = await pageAll(supabase, "competitors", "competitor_id, platform, handle");
  const platformOf = new Map(competitors.map((c) => [c.competitor_id as string, c.platform as string]));
  const handleOf = new Map(competitors.map((c) => [c.competitor_id as string, c.handle as string]));

  const posts = await pageAll(supabase, "competitor_posts", "post_id, competitor_id, post_type, views, raw, first_seen_at", since);

  console.log(`Checking ${posts.length} post(s) first seen since ${since}.\n`);

  let failed = false;

  for (const platform of ["instagram", "tiktok"]) {
    const mine = posts.filter((p) => platformOf.get(p.competitor_id as string) === platform);
    // Video only. Carousels and images have no view count anywhere.
    const videos = mine.filter((p) => String(p.post_type ?? "").toLowerCase().includes("video") || String(p.post_type ?? "").toLowerCase() === "clips");

    if (videos.length === 0) {
      console.log(`  ${platform.padEnd(10)} no video posts in this window -- nothing to check`);
      continue;
    }

    const nulls = videos.filter((p) => p.views == null);
    const rate = nulls.length / videos.length;

    // When views are missing, say WHETHER the number was in the payload. A
    // rename leaves it sitting in raw under a different name; a genuine
    // upstream gap leaves nothing anywhere. These need opposite responses,
    // so the check distinguishes them rather than reporting one number.
    const recoverable = nulls.filter((p) => {
      const raw = (p.raw ?? {}) as Record<string, unknown>;
      return Object.entries(raw).some(
        ([k, v]) => /view|play/i.test(k) && !/url/i.test(k) && typeof v === "number" && v > 0
      );
    });

    const pct = (rate * 100).toFixed(1);
    const verdict = rate > maxNullRate ? "FAIL" : "ok  ";
    console.log(
      `  ${verdict} ${platform.padEnd(10)} ${nulls.length}/${videos.length} videos missing views (${pct}%, threshold ${(maxNullRate * 100).toFixed(0)}%)`
    );

    if (recoverable.length > 0) {
      const keys = new Set<string>();
      for (const p of recoverable) {
        for (const [k, v] of Object.entries((p.raw ?? {}) as Record<string, unknown>)) {
          if (/view|play/i.test(k) && !/url/i.test(k) && typeof v === "number" && v > 0) keys.add(k);
        }
      }
      console.error(
        `       ${recoverable.length} of those DO carry a number in raw, under: ${[...keys].join(", ")}.\n` +
          `       That is a FIELD RENAME, not an upstream gap. Add the field to ingest.ts's views mapping and to\n` +
          `       VIEW_FIELDS in this file, then backfill from raw -- no re-scrape needed, the number is already stored.`
      );
      failed = true;
    } else if (rate > maxNullRate) {
      const sample = nulls.slice(0, 5).map((p) => `@${handleOf.get(p.competitor_id as string)}`);
      console.error(
        `       No view figure in raw for any of them, so the data is genuinely absent upstream rather than renamed.\n` +
          `       Affected accounts include: ${sample.join(", ")}. Check whether those accounts went private or\n` +
          `       whether Instagram is withholding counts before changing any code.`
      );
      failed = true;
    }
  }

  if (failed) {
    console.error(`\nSCORING INPUTS FAILED. vpf, baselines and outliers all derive from views: with views missing, every score silently becomes null and the pipeline produces nothing while reporting success.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nScoring inputs healthy.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
