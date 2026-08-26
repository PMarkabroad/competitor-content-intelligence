/**
 * Publishes a generated hook report to both places it needs to exist:
 * competitor-pipeline/out/<title>.md (the canonical CLI-facing archive,
 * per the original spec) and the hook_reports table (what the
 * dashboard's /reports screen actually reads -- no redeploy, no copy
 * step, visible on the next page load).
 *
 * Report content itself is never generated here -- why_it_performed and
 * the report prose stay human/LLM-synthesized from tagged hook_library
 * rows, same as always. This script only removes the "now remember to
 * copy the file into the dashboard too" step that used to follow that.
 *
 * Usage: npx tsx scripts/publish_hook_report.ts <path-to-md-file> [title]
 *   title defaults to the filename without its extension.
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const OUT_DIR = fileURLToPath(new URL("../out/", import.meta.url));

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: publish_hook_report.ts <path-to-md-file> [title]");
  }
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const filename = path.basename(filePath);
  const title = process.argv[3] ?? filename.replace(/\.md$/, "");

  // Ensure a copy lands in out/ under its canonical name, even if the
  // source file was written somewhere else (e.g. the scratchpad).
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, filename);
  if (path.resolve(filePath) !== path.resolve(outPath)) {
    copyFileSync(filePath, outPath);
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("hook_reports").insert({ title, content });
  if (error) throw new Error(`Failed to publish to hook_reports: ${error.message}`);

  console.log(`Published "${title}" -- out/${filename} and hook_reports (dashboard /reports).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
