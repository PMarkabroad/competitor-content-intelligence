/**
 * Exports every competitor-derived table to timestamped JSON + CSV before a
 * destructive reset, and verifies the exported row counts match the source.
 *
 * Writes to backups/competitor-reset-<date>/ at the repo root. That path is
 * gitignored on purpose: a backup of this data contains every competitor
 * post and caption we have collected, and the repository is public.
 *
 * Pages every read. An unfiltered select caps at 1000 rows and
 * competitor_posts is at 3,401 -- a silently truncated backup is worse than
 * no backup, because it looks like one.
 *
 * Usage: npm run backup-competitor-data
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

// Ordered parent-first for readability; restore order is the reverse.
const TABLES = [
  "competitors",
  "competitor_snapshots",
  "competitor_posts",
  "competitor_transcripts",
  "hook_library",
  "generated_drafts",
  "draft_formats",
  "hook_reports",
  "discovery_candidates",
];

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // Union of keys, not just the first row's: a nullable column missing from
  // row 1 would otherwise drop out of the whole export.
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

async function main() {
  const supabase = getSupabaseClient();
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = new URL(`../../backups/competitor-reset-${stamp}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });

  const summary: Record<string, number> = {};
  let failed = false;

  for (const table of TABLES) {
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from(table).select("*").range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data?.length) break;
      rows.push(...(data as Record<string, unknown>[]));
      if (data.length < 1000) break;
      from += 1000;
    }

    // Counted independently of the export, so a paging bug shows up as a
    // mismatch rather than as a confident wrong number.
    const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
    const expected = count ?? 0;

    writeFileSync(new URL(`${table}.json`, dir), JSON.stringify(rows, null, 2));
    writeFileSync(new URL(`${table}.csv`, dir), toCsv(rows));

    const ok = rows.length === expected;
    if (!ok) failed = true;
    summary[table] = rows.length;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${table.padEnd(24)} exported ${rows.length}, table has ${expected}`);
  }

  writeFileSync(
    new URL("MANIFEST.json", dir),
    JSON.stringify({ created_at: new Date().toISOString(), tables: summary, storage_files: "none -- no Supabase storage buckets exist" }, null, 2)
  );

  console.log(`\nBackup written to backups/competitor-reset-${stamp}/`);
  if (failed) {
    console.error("ROW COUNTS DO NOT MATCH -- do not proceed to deletion.");
    process.exitCode = 1;
  } else {
    console.log("All exported counts match the source tables.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
