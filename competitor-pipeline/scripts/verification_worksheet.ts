/**
 * Reads the `competitors` registry and emits a CSV worksheet for manual
 * verification. Pre-fills every column we already know; leaves the rest
 * blank for a human to fill in by hand while checking each account.
 *
 * Usage: npm run verification-worksheet
 * Output: competitor-pipeline/out/verification_worksheet.csv
 */

import { writeFileSync, mkdirSync } from "node:fs";
import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const OUT_DIR = new URL("../out/", import.meta.url);
const OUT_PATH = new URL("verification_worksheet.csv", OUT_DIR);

const HEADER_COMMENT =
  `# Decision rule: set active = false if the account has not posted in ` +
  `${config.DORMANCY_MAX_DAYS_SINCE_LAST_POST} days, or has under ` +
  `${config.DORMANCY_MIN_FOLLOWERS} followers, or does not post video/reel ` +
  `content. Such accounts burn scrape budget and cannot clear the ` +
  `${config.BASELINE_MIN_POSTS}-post minimum in v_competitor_baseline, so ` +
  `they return nulls rather than data.\n`;

const COLUMNS = [
  "name",
  "tier",
  "market",
  "source_url",
  "platform",
  "handle",
  "followers",
  "source_actor",
  "last_post_date",
  "posts_reels",
  "verified",
  "active",
  "checked_by",
  "checked_at",
] as const;

// source_actor: which actor (and pinned build) produced the `followers`
// figure on this row -- e.g. "apify/instagram-profile-scraper:0.0.587", or
// "manual" for an eyeballed check. followers is the scoring denominator
// for vpf across the whole pipeline; without this column a follower count
// here is unreproducible -- there's no way to tell later whether a number
// came from a specific actor build or a person glancing at a profile page.

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

interface CompetitorRow {
  name: string;
  tier: string;
  market: string;
  platform: string;
  handle: string;
  profile_url: string | null;
  handle_verified: boolean;
  active: boolean;
}

async function main() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("competitors")
    .select("name, tier, market, platform, handle, profile_url, handle_verified, active")
    .order("tier")
    .order("market")
    .order("name");

  if (error) {
    throw new Error(`Failed to read competitors: ${error.message}`);
  }

  const rows = (data ?? []) as CompetitorRow[];

  const lines: string[] = [HEADER_COMMENT.trimEnd(), COLUMNS.join(",")];

  for (const r of rows) {
    const record: Record<(typeof COLUMNS)[number], string> = {
      name: r.name,
      tier: r.tier,
      market: r.market,
      source_url: r.profile_url ?? "",
      platform: r.platform,
      handle: r.handle,
      followers: "",
      source_actor: "",
      last_post_date: "",
      posts_reels: "",
      verified: String(r.handle_verified),
      active: String(r.active),
      checked_by: "",
      checked_at: "",
    };
    lines.push(COLUMNS.map((c) => csvEscape(record[c])).join(","));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf-8");

  console.log(`Wrote ${rows.length} row(s) to ${OUT_PATH.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
