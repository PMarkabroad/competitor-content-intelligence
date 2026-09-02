import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const supabase = getSupabaseClient();

const { data: hooks, error } = await supabase.from("hook_library").select("*");
if (error) throw error;

const competitorIds = Array.from(new Set((hooks ?? []).map((h) => h.competitor_id)));
const { data: comps } = await supabase
  .from("competitors")
  .select("competitor_id, name, handle, market, tier, platform")
  .in("competitor_id", competitorIds);
const compById = new Map((comps ?? []).map((c) => [c.competitor_id, c]));

const postIds = (hooks ?? []).map((h) => h.post_id);
const { data: posts } = await supabase
  .from("competitor_posts")
  .select("post_id, post_url, caption, posted_at, views, duration_seconds")
  .in("post_id", postIds);
const postById = new Map((posts ?? []).map((p) => [p.post_id, p]));

const enriched = (hooks ?? []).map((h) => {
  const c = compById.get(h.competitor_id);
  const p = postById.get(h.post_id);
  return {
    competitor: c?.name,
    handle: c?.handle,
    market: c?.market,
    tier: c?.tier,
    platform: c?.platform,
    post_url: p?.post_url,
    posted_at: p?.posted_at,
    views: p?.views,
    duration_seconds: p?.duration_seconds ?? h.duration_seconds,
    outlier_score: h.outlier_score,
    vpf: h.vpf,
    hook_pattern: h.hook_pattern,
    topic_slug: h.topic_slug,
    sub_topic: h.sub_topic,
    content_angle: h.content_angle,
    cta: h.cta,
    narrative_structure: h.narrative_structure,
    opening_line: h.opening_line,
    au_transplant: h.au_transplant,
    transplant_note: h.transplant_note,
    brand_fit: h.brand_fit,
    brand_fit_note: h.brand_fit_note,
  };
});

enriched.sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0));

writeFileSync(
  new URL("../out/_hook_data.json", import.meta.url),
  JSON.stringify(enriched, null, 2)
);
console.log(`wrote ${enriched.length} enriched hook rows to out/_hook_data.json`);

// Compact console summary for the top scorers
console.log("\nTOP 15 BY OUTLIER SCORE:");
for (const e of enriched.slice(0, 15)) {
  console.log(`\n${(e.outlier_score ?? 0).toFixed(1)}x  ${e.competitor} (${e.market}/${e.tier})  ${e.duration_seconds ?? "?"}s  ${e.views?.toLocaleString() ?? "?"} views`);
  console.log(`  pattern: ${e.hook_pattern} | fit: ${e.brand_fit} | transplant: ${e.au_transplant}`);
  console.log(`  sub_topic: ${e.sub_topic}`);
  console.log(`  angle: ${e.content_angle}`);
  console.log(`  structure: ${e.narrative_structure}`);
  console.log(`  opening: "${e.opening_line}"`);
  console.log(`  url: ${e.post_url}`);
}
