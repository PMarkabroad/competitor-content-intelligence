/**
 * Exports the discovered Instagram candidates to a CSV for human review,
 * before any money is spent profiling or gating them.
 *
 * These rows come from discover_instagram.ts and are UNPROFILED -- no
 * follower count, no private check, no relevance classification yet. The
 * only thing known about each is which keyword surfaced it and how many
 * reels of theirs appeared in the results, which is a weak but real
 * relevance signal: an account showing up under several career keywords
 * is more likely in-niche than a one-off match.
 *
 * Usage: npm run export-instagram-candidates
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const OUT_DIR = new URL("../out/", import.meta.url);

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const supabase = getSupabaseClient();

  // Filtered server-side. An unfiltered select caps at 1000 rows and there
  // are ~980 TikTok candidates, which silently truncated the Instagram
  // ones when this was first counted in JS.
  const { data, error } = await supabase
    .from("discovery_candidates")
    .select("handle, market_guess, followers, is_private, found_via, classification, gate_result, recent_captions")
    .eq("platform", "instagram")
    .order("market_guess", { ascending: true });
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);

  const rows = data ?? [];
  console.log(`${rows.length} Instagram candidate(s).`);

  // "N reel(s) in results" is embedded in found_via by the discovery
  // script; pull it out so the CSV can be sorted by it.
  const withSignal = rows.map((r) => {
    const m = String(r.found_via ?? "").match(/(\d+)\s+reel/);
    const seed = String(r.found_via ?? "").match(/keyword "([^"]+)"/)?.[1] ?? "";
    return { ...r, reels: m ? Number(m[1]) : 1, seed };
  });

  const byMarket = new Map<string, typeof withSignal>();
  for (const r of withSignal) {
    const m = String(r.market_guess ?? "?");
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(r);
  }

  for (const [market, list] of Array.from(byMarket.entries()).sort()) {
    list.sort((a, b) => b.reels - a.reels || a.handle.localeCompare(b.handle));
    console.log(`\n=== ${market} (${list.length}) ===`);
    for (const r of list) {
      const flag = r.reels > 1 ? ` [${r.reels} reels]` : "";
      console.log(`  @${r.handle}${flag}`);
    }
  }

  const header = ["market", "handle", "profile_url", "reels_in_results", "surfaced_by_keyword", "followers", "is_private", "classification", "gate_result"];
  const lines = [header.join(",")];
  for (const [market, list] of Array.from(byMarket.entries()).sort()) {
    for (const r of list) {
      lines.push([
        market,
        r.handle,
        `https://instagram.com/${r.handle}`,
        r.reels,
        r.seed,
        r.followers ?? "",
        r.is_private ?? "",
        r.classification ?? "",
        r.gate_result ?? "",
      ].map(csvCell).join(","));
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const path = new URL("instagram_candidates.csv", OUT_DIR);
  writeFileSync(path, lines.join("\n") + "\n");
  console.log(`\nWrote out/instagram_candidates.csv (${rows.length} rows).`);
  console.log("Unprofiled: no follower count or relevance check yet -- that's --profile and --classify.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
