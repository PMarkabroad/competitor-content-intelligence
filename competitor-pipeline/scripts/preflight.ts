/**
 * Pre-flight check. Verifies the pipeline is actually ready before
 * anything -- most importantly smoke_test.ts -- is allowed to call Apify.
 * Prints a pass/fail line per check and exits non-zero on any failure.
 *
 * Usage: npm run preflight
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);
const STATE_DIR = new URL("../out/", import.meta.url);
const STATE_PATH = new URL("preflight_last_pass.json", STATE_DIR);

const EXPECTED_TABLES: Record<string, string[]> = {
  competitors: [
    "competitor_id", "name", "tier", "market", "platform", "handle",
    "profile_url", "niche_match", "scrape_cadence", "posts_per_run",
    "transcripts_enabled", "handle_verified", "active", "last_scraped_at",
    "notes", "created_at", "updated_at",
  ],
  competitor_snapshots: [
    "snapshot_id", "competitor_id", "scraped_at", "followers", "following",
    "post_count", "bio", "raw",
  ],
  competitor_posts: [
    "post_id", "competitor_id", "platform_post_id", "post_url", "post_type",
    "caption", "posted_at", "views", "likes", "comments", "shares",
    "duration_seconds", "first_seen_at", "last_scraped_at", "raw",
  ],
  competitor_transcripts: [
    "transcript_id", "post_id", "transcript", "opening_line",
    "seconds_to_first_claim", "transcribed_at", "raw",
  ],
  hook_library: [
    "hook_id", "post_id", "competitor_id", "hook_pattern", "format",
    "topic_slug", "opening_line", "outlier_score", "vpf", "au_transplant",
    "transplant_note", "tagged_by", "tagged_at", "used_in",
  ],
};

const EXPECTED_VIEWS = [
  "v_post_metrics",
  "v_competitor_baseline",
  "v_outliers",
  "v_hook_report",
];

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function checkTablesAndColumns(supabase: ReturnType<typeof getSupabaseClient>): Promise<CheckResult> {
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(EXPECTED_TABLES)) {
    const { data, error } = await supabase.from(table).select(columns.join(",")).limit(1);
    if (error) {
      missing.push(`${table}: ${error.message}`);
    }
  }
  return {
    name: "All five tables exist with expected columns",
    pass: missing.length === 0,
    detail: missing.length === 0 ? "ok" : missing.join("; "),
  };
}

async function checkViews(supabase: ReturnType<typeof getSupabaseClient>): Promise<CheckResult> {
  const failures: string[] = [];
  for (const view of EXPECTED_VIEWS) {
    const { error } = await supabase.from(view).select("*").limit(1);
    if (error) {
      failures.push(`${view}: ${error.message}`);
    }
  }
  return {
    name: "All four views exist and return without error",
    pass: failures.length === 0,
    detail: failures.length === 0 ? "ok" : failures.join("; "),
  };
}

function checkActorsPinned(): CheckResult {
  let json: Record<string, { actorId: string; build?: string }>;
  try {
    json = JSON.parse(readFileSync(ACTORS_PATH, "utf-8"));
  } catch (err) {
    return {
      name: "actors.json has no REPLACE_ME and every actor ID is version-pinned",
      pass: false,
      detail: `Could not read/parse actors.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const problems: string[] = [];
  for (const [role, entry] of Object.entries(json)) {
    const actorId = entry.actorId;
    if (!actorId || actorId === "REPLACE_ME") {
      problems.push(`${role}: actorId is still REPLACE_ME`);
      continue;
    }
    // Pin shape is {actorId, build} (build = an explicit Apify build number
    // like "0.0.587"), not a colon-embedded version string. "latest" is
    // never acceptable as the build value -- it floats to whatever the
    // actor's newest build is at call time.
    if (!entry.build || entry.build === "latest") {
      problems.push(`${role}: build is missing or "latest" (actorId "${actorId}")`);
    }
  }

  return {
    name: "actors.json has no REPLACE_ME and every actor ID is version-pinned",
    pass: problems.length === 0,
    detail: problems.length === 0 ? "ok" : problems.join("; "),
  };
}

async function checkCredentialsAuthenticate(supabase: ReturnType<typeof getSupabaseClient>): Promise<CheckResult> {
  const problems: string[] = [];

  const { error: supabaseError } = await supabase.from("competitors").select("competitor_id").limit(1);
  if (supabaseError) {
    problems.push(`Supabase: ${supabaseError.message}`);
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    problems.push("Apify: APIFY_TOKEN not set");
  } else {
    try {
      const res = await fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`);
      if (!res.ok) {
        problems.push(`Apify: authentication failed (${res.status})`);
      }
    } catch (err) {
      problems.push(`Apify: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    name: "Supabase and Apify credentials authenticate",
    pass: problems.length === 0,
    detail: problems.length === 0 ? "ok" : problems.join("; "),
  };
}

async function checkSpendUnderCap(): Promise<CheckResult> {
  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  if (!(typeof cap === "number" && cap > 0)) {
    return {
      name: "Apify month-to-date spend is under the cap in config.ts",
      pass: false,
      detail: "MONTHLY_APIFY_SPEND_CAP_USD is not a positive number in config.ts",
    };
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return {
      name: "Apify month-to-date spend is under the cap in config.ts",
      pass: false,
      detail: "APIFY_TOKEN not set, cannot check real usage",
    };
  }

  try {
    const res = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apifyToken}`);
    if (!res.ok) {
      return {
        name: "Apify month-to-date spend is under the cap in config.ts",
        pass: false,
        detail: `Could not fetch Apify usage: ${res.status} ${res.statusText}`,
      };
    }
    const json = (await res.json()) as {
      data: { totalUsageCreditsUsdAfterVolumeDiscount: number };
    };
    const spent = json.data.totalUsageCreditsUsdAfterVolumeDiscount;
    const pass = spent < cap;
    return {
      name: "Apify month-to-date spend is under the cap in config.ts",
      pass,
      detail: `$${spent.toFixed(4)} spent this cycle vs $${cap} cap` + (pass ? "" : " -- OVER CAP"),
    };
  } catch (err) {
    return {
      name: "Apify month-to-date spend is under the cap in config.ts",
      pass: false,
      detail: `Could not check Apify usage: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkActiveCompetitorsVerified(supabase: ReturnType<typeof getSupabaseClient>): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("competitors")
    .select("name, tier, market, platform, handle, handle_verified")
    .eq("active", true);

  if (error) {
    return {
      name: "Every active competitor has a non-blank, verified handle",
      pass: false,
      detail: `Could not query competitors: ${error.message}`,
    };
  }

  const bad = (data ?? []).filter(
    (r) => !r.handle || r.handle.trim().length === 0 || r.handle_verified !== true
  );

  return {
    name: "Every active competitor has a non-blank, verified handle",
    pass: bad.length === 0,
    detail:
      bad.length === 0
        ? `ok (${data?.length ?? 0} active competitor(s) checked)`
        : bad.map((r) => `${r.name} (${r.tier}/${r.market}/${r.platform})`).join(", "),
  };
}

/**
 * Guards against the exact failure mode found by the first smoke test:
 * a broken snapshot join produced posts with views populated but vpf
 * silently null. That's not a loud failure -- a null vpf just drops the
 * post from v_competitor_baseline's median calc and never enters
 * v_outliers, so a full harvest with this bug would look like a clean run
 * that simply found no outliers, not an error. Any post with real view
 * data but no followers_at_scrape (and therefore no vpf) means ingest
 * wrote the row without capturing a denominator -- that's a bug, not a
 * legitimately-quiet account.
 */
async function checkNoSilentNullVpf(supabase: ReturnType<typeof getSupabaseClient>): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("competitor_posts")
    .select("post_id, competitor_id, views, followers_at_scrape")
    .not("views", "is", null);

  if (error) {
    return {
      name: "No competitor_posts row with views has a null followers_at_scrape/vpf",
      pass: false,
      detail: `Could not query competitor_posts: ${error.message}`,
    };
  }

  const bad = (data ?? []).filter((r) => r.followers_at_scrape === null);

  return {
    name: "No competitor_posts row with views has a null followers_at_scrape/vpf",
    pass: bad.length === 0,
    detail:
      bad.length === 0
        ? `ok (${data?.length ?? 0} row(s) with views checked)`
        : `${bad.length} row(s) have views but null followers_at_scrape: ${bad
            .slice(0, 5)
            .map((r) => r.post_id)
            .join(", ")}${bad.length > 5 ? ", ..." : ""}`,
  };
}

async function main() {
  const supabase = getSupabaseClient();

  const results: CheckResult[] = [];
  results.push(await checkTablesAndColumns(supabase));
  results.push(await checkViews(supabase));
  results.push(checkActorsPinned());
  results.push(await checkCredentialsAuthenticate(supabase));
  results.push(await checkSpendUnderCap());
  results.push(await checkActiveCompetitorsVerified(supabase));
  results.push(await checkNoSilentNullVpf(supabase));

  console.log("Preflight results:\n");
  let allPass = true;
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    if (!r.pass || r.detail !== "ok") {
      console.log(`       ${r.detail}`);
    }
    if (!r.pass) allPass = false;
  }

  if (allPass) {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify({ passedAt: new Date().toISOString() }), "utf-8");
    console.log("\nAll checks passed.");
  } else {
    console.log("\nOne or more checks failed. Nothing else should run until this passes.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
