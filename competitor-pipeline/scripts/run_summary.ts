/**
 * Prints a short plain-text summary of what the pipeline produced, for the
 * weekly email.
 *
 * Counts what arrived in the last 24 hours rather than totals, because the
 * question the email answers is "did Sunday work and what did I get", not
 * "how big is the library". A run that produces nothing is the thing most
 * worth seeing, and a totals-only email hides exactly that -- 972 pieces
 * looks identical whether 32 were added or none were.
 *
 * Usage: npm run run-summary
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

async function pageAll(
  supabase: ReturnType<typeof getSupabaseClient>,
  table: string,
  cols: string
) {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const isNew = (r: Record<string, unknown>) => String(r.created_at ?? "") >= since;

  const [posts, drafts, formats, hooks, competitors] = await Promise.all([
    pageAll(supabase, "competitor_posts", "post_id, first_seen_at"),
    pageAll(supabase, "generated_drafts", "draft_id, created_at, status, hook"),
    pageAll(supabase, "draft_formats", "draft_format_id, created_at, format"),
    pageAll(supabase, "hook_library", "hook_id, tagged_at, brand_fit"),
    pageAll(supabase, "competitors", "competitor_id, active, handle_verified"),
  ]);

  const newPosts = posts.filter((p) => String(p.first_seen_at ?? "") >= since).length;
  const liveDrafts = drafts.filter((d) => d.status !== "dismissed");
  const newDrafts = liveDrafts.filter(isNew);
  const newFormats = formats.filter(isNew);
  const newHooks = hooks.filter((h) => String(h.tagged_at ?? "") >= since && h.brand_fit !== "no");
  const activeComps = competitors.filter((c) => c.active && c.handle_verified).length;

  const carousel = newFormats.filter((f) => String(f.format).startsWith("carousel")).length;

  const lines = [
    `Ark competitor intel -- weekly run`,
    ``,
    `NEW IN THE LAST 24 HOURS`,
    `  competitor posts collected : ${newPosts}`,
    `  hooks added                : ${newHooks.length}`,
    `  ready-made posts           : ${newDrafts.length}`,
    `  channel versions           : ${newFormats.length} (${carousel} Instagram carousels)`,
    ``,
    `TOTALS`,
    `  competitors tracked        : ${activeComps}`,
    `  posts collected            : ${posts.length}`,
    `  usable hooks               : ${hooks.filter((h) => h.brand_fit !== "no").length}`,
    `  ready-made posts           : ${liveDrafts.length}`,
    `  channel versions           : ${formats.length}`,
    ``,
  ];

  if (newDrafts.length > 0) {
    lines.push(`THIS WEEK'S POSTS`);
    for (const d of newDrafts.slice(0, 10)) lines.push(`  - ${String(d.hook).slice(0, 90)}`);
    lines.push(``);
  } else {
    // Stated outright rather than left to be inferred from a zero. A silent
    // no-op run is the failure this email exists to surface.
    lines.push(`NO NEW POSTS WERE PRODUCED. Something in the chain did not run --`);
    lines.push(`check the Actions tab on GitHub for the run log.`);
    lines.push(``);
  }

  lines.push(`Dashboard: https://ark-competitor-dashboard.vercel.app/drafts`);

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
