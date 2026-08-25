/**
 * Reads the completed verification worksheet CSV back and updates
 * `competitors`: handle, platform, handle_verified, active.
 *
 * Refuses to set handle_verified = true on any row where checked_by is
 * blank -- "verified" must mean a specific person actually checked the
 * account, not that the column was defaulted or copy-pasted forward.
 *
 * Usage: npm run apply-worksheet -- --file out/verification_worksheet.csv
 */

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

interface WorksheetRow {
  name: string;
  tier: string;
  market: string;
  source_url: string;
  platform: string;
  handle: string;
  followers: string;
  last_post_date: string;
  posts_reels: string;
  verified: string;
  active: string;
  checked_by: string;
  checked_at: string;
}

function toBool(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

async function main() {
  const fileArgIndex = process.argv.indexOf("--file");
  const filePath = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : null;
  if (!filePath) {
    throw new Error("Usage: apply_worksheet.ts --file <path-to-completed-worksheet.csv>");
  }

  const supabase = getSupabaseClient();

  const csvText = readFileSync(filePath, "utf-8");
  const rows: WorksheetRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    comment: "#",
  });

  let updated = 0;
  let refused = 0;
  const refusedRows: string[] = [];

  for (const r of rows) {
    const wantsVerifiedTrue = toBool(r.verified);
    const checkedBy = r.checked_by.trim();

    if (wantsVerifiedTrue && !checkedBy) {
      refused += 1;
      refusedRows.push(`${r.name} (${r.tier}, ${r.market}, ${r.platform})`);
      continue;
    }

    const handle = r.handle.trim();
    if (!handle) {
      // No handle to update to -- leave the row alone rather than writing
      // an empty handle over whatever's already in the registry.
      continue;
    }

    const { error } = await supabase
      .from("competitors")
      .update({
        handle,
        platform: r.platform.trim(),
        handle_verified: wantsVerifiedTrue,
        active: toBool(r.active),
      })
      .eq("name", r.name)
      .eq("tier", r.tier)
      .eq("market", r.market);

    if (error) {
      console.error(`Update failed for ${r.name}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    updated += 1;
  }

  console.log(`Updated ${updated} row(s).`);
  if (refused > 0) {
    console.log(
      `\nRefused to set handle_verified = true on ${refused} row(s) with blank checked_by:`
    );
    for (const name of refusedRows) {
      console.log(`  - ${name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
