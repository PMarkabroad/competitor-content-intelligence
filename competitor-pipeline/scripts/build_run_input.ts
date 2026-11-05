/**
 * Reads active competitors from Supabase and emits the Apify run input JSON
 * for a harvest run. Does not call Apify -- this only builds the input
 * payload for review / for a separate runner to use.
 *
 * Usage: npm run build-run-input [-- --category niche_competitor]
 *
 * --category is optional and narrows the run to one kind of account. Omit it
 * for the whole active roster, which is the normal case since migration 020
 * retired tiers and made one harvest run cover everybody.
 *
 * Incremental by design: each competitor's last_scraped_at becomes the
 * "since" watermark, so runs only pull what's new since the last harvest
 * instead of re-pulling everything every time.
 *
 * T3 (format benchmarks) is scored differently: top-N by views within a
 * trailing window rather than most-recent, since the point of T3 is
 * "what's their best format ever done", not "what did they post this week".
 */

import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

type Tier = "T1" | "T2" | "T3";

interface Competitor {
  competitor_id: string;
  name: string;
  platform: string;
  handle: string;
  posts_per_run: number | null;
  last_scraped_at: string | null;
  category: string | null;
}

interface RunInputItem {
  competitor_id: string;
  name: string;
  platform: string;
  handle: string;
  since: string | null;
  maxResults: number;
  sortByViewsWindowDays: number | null;
}

function estimateMonthToDateSpendUsd(items: RunInputItem[]): number {
  const profileCost = items.length * config.ESTIMATED_COST_PER_PROFILE_USD;
  const postsCost = items.reduce(
    (sum, i) => sum + i.maxResults * config.ESTIMATED_COST_PER_POST_USD,
    0
  );
  return profileCost + postsCost;
}

async function main() {
  const catArgIndex = process.argv.indexOf("--category");
  const category = catArgIndex >= 0 ? process.argv[catArgIndex + 1] : null;
  if (catArgIndex >= 0 && !category) {
    throw new Error("Usage: build_run_input.ts [--category <niche_competitor|viral_creator>]");
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("competitors")
    .select("competitor_id, name, platform, handle, posts_per_run, last_scraped_at, category")
    .eq("active", true)
    .eq("handle_verified", true);

  if (error) {
    throw new Error(`Failed to read competitors: ${error.message}`);
  }

  let competitors = (data ?? []) as Competitor[];
  if (category) competitors = competitors.filter((c) => c.category === category);
  if (competitors.length === 0) {
    console.log(`No active, handle-verified competitors found${category ? ` in category ${category}` : ""}.`);
    return;
  }

  const items: RunInputItem[] = competitors.map((c) => ({
    competitor_id: c.competitor_id,
    name: c.name,
    platform: c.platform,
    handle: c.handle,
    since: c.last_scraped_at,
    maxResults: c.posts_per_run ?? config.DEFAULT_POSTS_PER_RUN,
    // viral_creator accounts are tracked for format benchmarks, so what
    // matters is what WORKED, not what is newest -- top-N by views over a
    // trailing window rather than most-recent. (Was keyed to tier T3 before
    // migration 020; T3 and viral_creator were the same accounts.)
    sortByViewsWindowDays:
      c.category === "viral_creator" ? config.TOP_N_BY_VIEWS_WINDOW_DAYS : null,
  }));

  const estimatedSpend = estimateMonthToDateSpendUsd(items);
  if (estimatedSpend > config.MONTHLY_APIFY_SPEND_CAP_USD) {
    console.error(
      `Refusing to emit run input: estimated spend $${estimatedSpend.toFixed(2)} ` +
        `exceeds MONTHLY_APIFY_SPEND_CAP_USD ($${config.MONTHLY_APIFY_SPEND_CAP_USD}). ` +
        `Reduce posts_per_run, narrow the competitor list, or raise the cap in config.ts.`
    );
    process.exitCode = 1;
    return;
  }

  const runInput = {
    category,
    generatedAt: new Date().toISOString(),
    estimatedSpendUsd: Number(estimatedSpend.toFixed(4)),
    items,
  };

  console.log(JSON.stringify(runInput, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
