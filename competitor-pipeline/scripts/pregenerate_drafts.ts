/**
 * Pre-generates Ark drafts for the content ideas that don't have one yet,
 * so /content-ideas shows a finished draft instead of a button that makes
 * you wait 20 seconds each time.
 *
 * Deliberately NOT done on page load: /content-ideas shows 15 cards, so
 * generating on render would mean 15 model calls per page view, most of
 * them thrown away, on every refresh. Generating once and storing is the
 * same output for a fraction of the cost.
 *
 * Calls the deployed /api/generate-draft endpoint rather than
 * reimplementing the prompt, so there is exactly one definition of how a
 * draft gets written (including the voice guide and its proof bank) and
 * this can't drift from what the button does. That endpoint already
 * persists to generated_drafts, so this script just picks targets and
 * paces the calls.
 *
 * Re-run it after each harvest/tagging pass; it skips anything already
 * drafted.
 *
 * Usage:
 *   npm run pregenerate-drafts -- [--limit=N] [--per-market=N] [--dry-run]
 *   npm run pregenerate-drafts -- --base=http://localhost:3000
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const DEFAULT_BASE = "https://ark-competitor-dashboard.vercel.app";
const DEFAULT_PER_MARKET = 5;

interface Target {
  post_id: string;
  competitor_name: string;
  market: string;
  outlier_score: number | null;
  vpf: number | null;
  hook_pattern: string | null;
  format: string | null;
  content_angle: string | null;
  narrative_structure: string | null;
  cta: string | null;
  why_it_performed: string | null;
  opening_line: string | null;
  transcript: string | null;
  caption: string | null;
}

function arg(name: string): string | null {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const base = arg("base") ?? DEFAULT_BASE;
  const perMarket = Number(arg("per-market") ?? DEFAULT_PER_MARKET);
  const limitArg = arg("limit");
  const limit = limitArg ? Number(limitArg) : null;

  const supabase = getSupabaseClient();

  // Same selection /content-ideas makes: tagged hooks, brand_fit not 'no',
  // from accounts still active, best first.
  const { data: hooks, error } = await supabase
    .from("hook_library")
    .select(
      "post_id, hook_pattern, format, content_angle, narrative_structure, cta, why_it_performed, opening_line, outlier_score, vpf, brand_fit, competitor_posts(caption), competitors(name, market, active)"
    )
    .order("outlier_score", { ascending: false });
  if (error) throw new Error(`Failed to read hook_library: ${error.message}`);

  type Row = {
    post_id: string;
    brand_fit: string | null;
    competitors: { name: string; market: string; active: boolean } | null;
    competitor_posts: { caption: string | null } | null;
  } & Omit<Target, "post_id" | "competitor_name" | "market" | "transcript" | "caption">;

  const eligible = ((hooks ?? []) as unknown as Row[]).filter(
    (r) => r.brand_fit !== "no" && r.competitors?.active !== false && r.competitors?.market
  );

  const { data: drafted } = await supabase
    .from("generated_drafts")
    .select("source_post_id")
    .not("source_post_id", "is", null);
  const alreadyDrafted = new Set((drafted ?? []).map((d) => d.source_post_id as string));

  // Top N per market, so one prolific account can't consume the whole run.
  const byMarket = new Map<string, Row[]>();
  for (const r of eligible) {
    if (alreadyDrafted.has(r.post_id)) continue;
    const m = r.competitors!.market;
    if (!byMarket.has(m)) byMarket.set(m, []);
    if (byMarket.get(m)!.length < perMarket) byMarket.get(m)!.push(r);
  }

  let picked = Array.from(byMarket.values()).flat();
  picked.sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0));
  if (limit) picked = picked.slice(0, limit);

  if (picked.length === 0) {
    console.log("Every eligible content idea already has a draft. Nothing to generate.");
    return;
  }

  const { data: transcripts } = await supabase
    .from("competitor_transcripts")
    .select("post_id, transcript")
    .in("post_id", picked.map((p) => p.post_id));
  const transcriptByPost = new Map((transcripts ?? []).map((t) => [t.post_id, t.transcript as string]));

  console.log(`${picked.length} idea(s) without a draft (top ${perMarket} per market). Endpoint: ${base}`);
  if (dryRun) {
    for (const p of picked) {
      console.log(`  ${(p.outlier_score ?? 0).toFixed(1)}x  ${p.competitors!.market}  ${p.competitors!.name}  ${p.opening_line?.slice(0, 60) ?? "(no opening line)"}`);
    }
    console.log("\nDry run -- nothing generated.");
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const [i, p] of picked.entries()) {
    const label = `[${i + 1}/${picked.length}]`;
    const body: Target = {
      post_id: p.post_id,
      competitor_name: p.competitors!.name,
      market: p.competitors!.market,
      outlier_score: p.outlier_score,
      vpf: p.vpf,
      hook_pattern: p.hook_pattern,
      format: p.format,
      content_angle: p.content_angle,
      narrative_structure: p.narrative_structure,
      cta: p.cta,
      why_it_performed: p.why_it_performed,
      opening_line: p.opening_line,
      transcript: transcriptByPost.get(p.post_id) ?? null,
      caption: p.competitor_posts?.caption ?? null,
    };

    if (!body.transcript && !body.caption) {
      console.log(`  ${label} ${body.competitor_name}: no transcript or caption to work from, skipped`);
      continue;
    }

    try {
      const res = await fetch(`${base}/api/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error(`  ${label} ${body.competitor_name}: FAILED ${res.status} -- ${detail.slice(0, 160)}`);
        failed++;
        continue;
      }
      const draft = (await res.json()) as { hook?: string };
      ok++;
      console.log(`  ${label} ${body.competitor_name} (${body.market}): ${draft.hook?.slice(0, 70) ?? "(no hook)"}`);
    } catch (err) {
      failed++;
      console.error(`  ${label} ${body.competitor_name}: FAILED -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. ${ok} draft(s) generated, ${failed} failed. They're on /drafts and inline on /content-ideas.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
