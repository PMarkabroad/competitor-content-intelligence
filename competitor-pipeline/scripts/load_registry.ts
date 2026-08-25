/**
 * Loads seed/competitors.csv into the `competitors` table.
 *
 * Upserts on (platform, handle). Rows with a blank handle are skipped --
 * they can't satisfy the unique constraint or be scraped -- and printed as
 * a "needs verification" list instead of being written.
 *
 * Usage: npm run load-registry
 */

import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { parse } from "csv-parse/sync";
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const SEED_PATH = new URL("../seed/competitors.csv", import.meta.url);

interface SeedRow {
  name: string;
  tier: string;
  market: string;
  platform: string;
  handle: string;
  profile_url: string;
  niche_match: string;
  scrape_cadence: string;
  posts_per_run: string;
  transcripts_enabled: string;
  handle_verified: string;
  active: string;
  notes: string;
}

function toBool(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function toIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

async function main() {
  const supabase = getSupabaseClient();

  const csvText = readFileSync(SEED_PATH, "utf-8");
  const rows: SeedRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
  });

  const loadable = rows.filter((r) => r.handle.trim().length > 0);
  const needsVerification = rows.filter((r) => r.handle.trim().length === 0);

  // These two are a strict partition of `rows` by construction (`> 0` vs
  // `=== 0` on the same trimmed value), so this can only fail if someone
  // edits the filters above to stop being complementary. Keep it that way.
  assert.equal(
    loadable.length + needsVerification.length,
    rows.length,
    `Partition invariant broken: ${loadable.length} loadable + ${needsVerification.length} needing verification != ${rows.length} total rows.`
  );

  console.log(`${rows.length} rows in seed file.`);
  console.log(`${loadable.length} loadable (handle present).`);
  console.log(`${needsVerification.length} need handle verification (skipped).`);

  if (loadable.length > 0) {
    const payload = loadable.map((r) => ({
      name: r.name,
      tier: r.tier,
      market: r.market,
      platform: r.platform,
      handle: r.handle.trim(),
      profile_url: r.profile_url.trim() || null,
      niche_match: r.niche_match || null,
      scrape_cadence: r.scrape_cadence || null,
      posts_per_run: toIntOrNull(r.posts_per_run),
      transcripts_enabled: toBool(r.transcripts_enabled),
      handle_verified: toBool(r.handle_verified),
      active: toBool(r.active),
      notes: r.notes.trim() || null,
    }));

    const { error, data } = await supabase
      .from("competitors")
      .upsert(payload, { onConflict: "platform,handle" })
      .select("competitor_id, name, platform, handle");

    if (error) {
      console.error("Upsert failed:", error.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Upserted ${data?.length ?? 0} competitors.`);
  }

  if (needsVerification.length > 0) {
    console.log(`\nNeeds verification (not loaded, no handle) -- ${needsVerification.length} row(s):`);
    let printed = 0;
    for (const r of needsVerification) {
      console.log(`  - ${r.name} (${r.tier}, ${r.market}, ${r.platform})`);
      printed += 1;
    }
    // Same list that produced the count above -- if this ever fails, the
    // loop body was changed to skip/filter entries without updating the
    // count line, which is exactly the class of bug this guards against.
    assert.equal(
      printed,
      needsVerification.length,
      `Printed ${printed} rows but reported count was ${needsVerification.length}.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
