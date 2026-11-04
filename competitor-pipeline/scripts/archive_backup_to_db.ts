/**
 * Copies a local backup directory into a private `archive` schema in the
 * same Supabase project, so the only copy is not sitting on one laptop.
 *
 * Why a schema and not a storage bucket: 122MB of mostly `raw` jsonb would
 * be an opaque blob in storage, whereas in a schema it stays queryable --
 * "what did this competitor's posts look like before the reset" is the
 * actual reason to keep it. It also needs no new credentials.
 *
 * `archive` is private by design: Supabase exposes only `public` (and
 * graphql_public) through PostgREST, so these tables are unreachable from
 * the anon or service REST API and are reachable only via a direct database
 * connection. Tables are created with LIKE ... INCLUDING ALL but WITHOUT the
 * foreign keys -- an archive should not refuse a row because its parent was
 * deleted, which is the whole situation it exists to record.
 *
 * Writes go through the CLI's SQL path rather than PostgREST precisely
 * because the schema is not exposed to PostgREST.
 *
 * Usage: npm run archive-backup -- --dir=backups/competitor-reset-2026-11-04
 */

import "dotenv/config";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

function arg(name: string): string | null {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : null;
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function runSql(sql: string, label: string) {
  // Via a file: these statements carry embedded JSON far past any sane
  // command-line length.
  const dir = mkdtempSync(join(tmpdir(), "archive-"));
  const path = join(dir, "stmt.sql");
  writeFileSync(path, sql, "utf-8");
  try {
    // shell:true because on Windows `supabase` is a .cmd shim and
    // execFileSync without a shell cannot resolve PATHEXT -- it fails with
    // ENOENT even though the binary is plainly on PATH. The file path is
    // quoted: this repo lives under "Deepak Files/Arkabroad Claude/...".
    execFileSync("supabase", ["db", "query", "--linked", "--file", `"${path}"`], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      shell: true,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer };
    throw new Error(`${label} failed: ${String(err.stderr ?? err.stdout ?? e).slice(0, 400)}`);
  }
}

/**
 * Serialises one value for SQL, using the column's ACTUAL Postgres type.
 *
 * A JS array is ambiguous without it: `recent_captions` is text[] and wants
 * `{"a","b"}`, while `raw` is jsonb and may itself hold a JSON array that
 * wants `["a","b"]`. Guessing from the JS value serialised text[] as JSON
 * and Postgres rejected the whole batch with `22P02 malformed array
 * literal` -- after the table had already been created, so it looked done
 * and held nothing.
 */
function sqlLiteral(v: unknown, udtName?: string): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";

  // udt_name for an array type is the element type prefixed with "_".
  const isPgArray = typeof udtName === "string" && udtName.startsWith("_");
  if (isPgArray && Array.isArray(v)) {
    if (v.length === 0) return "'{}'";
    const BACKSLASH = String.fromCharCode(92);
    const QUOTE = String.fromCharCode(34);
    const elems = v.map((e) => {
      if (e === null) return "NULL";
      // Inside an array literal, backslash and double quote are escaped with
      // a backslash; built from char codes so no quoting layer can eat them.
      const t = String(e)
        .split(BACKSLASH)
        .join(BACKSLASH + BACKSLASH)
        .split(QUOTE)
        .join(BACKSLASH + QUOTE);
      return QUOTE + t + QUOTE;
    });
    // Then the whole literal is single-quoted for SQL, doubling any single
    // quotes the captions contain.
    const literal = "{" + elems.join(",") + "}";
    return "'" + literal.split("'").join("''") + "'";
  }

  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

/** column_name -> udt_name for a public table, read once and cached. */
const udtCache = new Map<string, Map<string, string>>();
function columnTypes(table: string): Map<string, string> {
  const cached = udtCache.get(table);
  if (cached) return cached;
  const out = execFileSync(
    "supabase",
    ["db", "query", "--linked", "--output", "json",
     `"select column_name, udt_name from information_schema.columns where table_schema='public' and table_name='${table}'"`],
    { cwd: repoRoot, encoding: "utf-8", shell: true, maxBuffer: 32 * 1024 * 1024 }
  );
  const m = out.match(/\{[\s\S]*\}/);
  const map = new Map<string, string>();
  if (m) for (const r of (JSON.parse(m[0]).rows ?? []) as { column_name: string; udt_name: string }[]) {
    map.set(r.column_name, r.udt_name);
  }
  udtCache.set(table, map);
  return map;
}

async function main() {
  const dirArg = arg("dir");
  if (!dirArg) throw new Error("Usage: --dir=backups/competitor-reset-<date>");
  const backupDir = join(repoRoot, dirArg);
  const stamp = dirArg.split("-").slice(-3).join("-");

  console.log(`Archiving ${dirArg} into schema archive (suffix _${stamp.replace(/-/g, "_")})\n`);

  runSql("create schema if not exists archive;", "create schema");

  // What is already in the archive, so a re-run resumes instead of redoing.
  const alreadyDone = new Map<string, number>();
  try {
    const out = execFileSync(
      "supabase",
      ["db", "query", "--linked", "--output", "json",
       `"select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from archive.%I', table_name), false,true,'')))[1]::text::int as n from information_schema.tables where table_schema='archive'"`],
      { cwd: repoRoot, encoding: "utf-8", shell: true, maxBuffer: 32 * 1024 * 1024 }
    );
    const m = out.match(/\{[\s\S]*\}/);
    if (m) for (const r of (JSON.parse(m[0]).rows ?? []) as { table_name: string; n: number }[]) {
      alreadyDone.set(r.table_name, r.n);
    }
  } catch {
    // No archive yet, or the probe failed -- treat everything as pending.
  }

  const summary: Record<string, number> = {};

  for (const table of TABLES) {
    const rows = JSON.parse(readFileSync(join(backupDir, `${table}.json`), "utf-8")) as Record<string, unknown>[];
    const target = `archive.${table}_${stamp.replace(/-/g, "_")}`;

    // Resumable: a table already holding the right number of rows is left
    // alone, so a 413 partway through does not mean starting over.
    if (alreadyDone.get(`${table}_${stamp.replace(/-/g, "_")}`) === rows.length) {
      summary[table] = rows.length;
      console.log(`  ok  ${table.padEnd(24)} ${rows.length} rows (already archived, skipped)`);
      continue;
    }

    // INCLUDING ALL minus constraints: no FKs, so a child row whose parent
    // is gone still lands. EXCLUDING CONSTRAINTS also drops CHECKs, which is
    // wanted -- archived rows must not be re-validated against constraints
    // that may since have changed.
    runSql(
      `drop table if exists ${target};
       create table ${target} (like public.${table} including defaults excluding constraints excluding indexes);`,
      `create ${target}`
    );

    if (rows.length === 0) {
      summary[table] = 0;
      console.log(`  ok  ${table.padEnd(24)} 0 rows (nothing to copy)`);
      continue;
    }

    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const udt = columnTypes(table);

    // Batched by payload size, not row count: competitor_posts rows carry a
    // whole scraped API response in `raw`, so a fixed 500-row batch is a
    // 6MB statement for one table and 40KB for another.
    //
    // 300KB, not 4MB. The Management API answers 413 "request entity too
    // large" well below a megabyte, and it does so AFTER the table has been
    // created -- so an oversized batch leaves an empty archive table behind
    // and reads as success until the counts are checked.
    const MAX_BYTES = 300 * 1024;
    let batch: string[] = [];
    let bytes = 0;
    let written = 0;

    const flush = () => {
      if (batch.length === 0) return;
      runSql(`insert into ${target} (${colList}) values ${batch.join(",")};`, `insert into ${target}`);
      written += batch.length;
      batch = [];
      bytes = 0;
    };

    for (const r of rows) {
      const tuple = `(${cols.map((c) => sqlLiteral(r[c], udt.get(c))).join(",")})`;
      if (bytes + tuple.length > MAX_BYTES) flush();
      batch.push(tuple);
      bytes += tuple.length;
    }
    flush();

    summary[table] = written;
    console.log(`  ${written === rows.length ? "ok " : "FAIL"} ${table.padEnd(24)} ${written} of ${rows.length} rows`);
  }

  console.log("\nVerifying row counts in the archive schema...");
  const checks = TABLES.map(
    (t) => `select '${t}' as t, count(*) from archive.${t}_${stamp.replace(/-/g, "_")}`
  ).join(" union all ");
  runSql(`${checks};`, "verify");

  writeFileSync(
    join(backupDir, "ARCHIVED_TO_DB.json"),
    JSON.stringify({ archived_at: new Date().toISOString(), schema: "archive", suffix: stamp, tables: summary }, null, 2)
  );
  console.log(`\nDone. Archive schema: archive.<table>_${stamp.replace(/-/g, "_")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
