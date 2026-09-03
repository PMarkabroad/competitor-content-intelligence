/**
 * Instagram account discovery -- finds ACCOUNTS by scraping reels under
 * career-content hashtags and keywords, then reading the handle off each
 * result. The reels are just the means; the accounts are the output.
 *
 * Why this exists: discover.ts is TikTok-only because TikTok exposes a
 * keyword search the pipeline can query directly. Instagram doesn't, which
 * is why 980 of the first 981 discovery candidates were TikTok and the
 * roster ended up 32 TikTok / 4 Instagram. This closes that gap.
 *
 * Reels, not posts, deliberately: the scoring chain needs a video view
 * count to compute views-per-follower, and Instagram career content is
 * carousel-heavy -- 49 of the first 117 Instagram posts collected were
 * Sidecar or Image and are structurally unscoreable. Discovering
 * carousel-first accounts would add accounts that can never produce an
 * outlier.
 *
 * Writes to discovery_candidates with platform='instagram', so the
 * existing --classify / --gate / --shortlist / --promote stages in
 * discover.ts can process them the same way as TikTok candidates. It does
 * NOT promote anything itself.
 *
 * Usage:
 *   npm run discover-instagram -- [--limit=AU|US|CA] [--per-seed=30] [--confirm]
 * Without --confirm it prints the plan and the cost estimate, and stops.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { runApifyActor, getRealMonthToDateSpendUsd } from "./lib/harvest.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

// BRONZE "Result" event, confirmed live via the actor's pricingInfos
// 2026-09-03. Minimum per run is $0.0026, i.e. effectively none.
const COST_PER_RESULT_USD = 0.0023;

// Practitioner language, matching the convention set for the CA seed
// queries: no visa, PR, sponsorship or migration terms, and no
// "newcomer"/"immigrant" framing. Search phrasing targets the TOPIC; the
// classify stage decides relevance.
const SEEDS: Record<string, string[]> = {
  AU: [
    "resume tips australia",
    "interview tips australia",
    "career coach australia",
    "job search australia",
    "linkedin tips australia",
  ],
  US: [
    "resume tips",
    "interview tips",
    "career coach",
    "job search tips",
    "linkedin tips",
  ],
  CA: [
    "resume tips canada",
    "interview tips canada",
    "career coach canada",
    "job search canada",
  ],
};

interface Candidate {
  handle: string;
  market: string;
  seed: string;
  followers: number | null;
  posts: number;
  bio: string | null;
  captions: string[];
}

function arg(name: string): string | null {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : null;
}

async function main() {
  const marketArg = arg("limit");
  const perSeed = Number(arg("per-seed") ?? 30);
  const confirmed = process.argv.includes("--confirm");

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");

  const markets = marketArg ? [marketArg.toUpperCase()] : Object.keys(SEEDS);
  const plan = markets.flatMap((m) => (SEEDS[m] ?? []).map((s) => ({ market: m, seed: s })));
  if (plan.length === 0) throw new Error(`No seeds for market(s): ${markets.join(", ")}`);

  const estimate = plan.length * perSeed * COST_PER_RESULT_USD;
  const cap = config.MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getRealMonthToDateSpendUsd(apifyToken);

  console.log(`Instagram discovery: ${plan.length} seed(s) across ${markets.join(", ")}, up to ${perSeed} reels each.`);
  for (const p of plan) console.log(`  ${p.market}: "${p.seed}"`);
  console.log(`\nReal spend so far: $${spentSoFar.toFixed(4)}. Estimated: $${estimate.toFixed(4)}. Cap: $${cap}.`);

  if (spentSoFar + estimate > cap) {
    console.error(`\n*** SKIPPED: would exceed the $${cap} cap. ***\n`);
    return;
  }
  if (!confirmed) {
    console.log("\nNot confirmed -- pass --confirm to actually run this. Stopping here.");
    return;
  }

  const actors = JSON.parse(readFileSync(ACTORS_PATH, "utf-8"));
  const pin = actors.instagramDiscovery;
  const supabase = getSupabaseClient();

  // Anything already tracked or already screened shouldn't be re-added.
  const { data: existing } = await supabase.from("competitors").select("handle, platform");
  const known = new Set(
    (existing ?? []).filter((e) => e.platform === "instagram").map((e) => e.handle.toLowerCase())
  );
  const { data: seen } = await supabase
    .from("discovery_candidates")
    .select("handle, platform")
    .eq("platform", "instagram");
  const screened = new Set((seen ?? []).map((s) => s.handle.toLowerCase()));

  const found = new Map<string, Candidate>();

  for (const [i, p] of plan.entries()) {
    console.log(`\n[${i + 1}/${plan.length}] ${p.market} "${p.seed}"`);
    let items: Record<string, unknown>[] = [];
    try {
      items = await runApifyActor(
        pin,
        { hashtags: [p.seed], keywordSearch: true, resultsType: "reels", resultsLimit: perSeed },
        apifyToken
      );
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    let newHere = 0;
    for (const item of items) {
      const handle = String(item.ownerUsername ?? item.ownerUsernameRaw ?? "").toLowerCase().trim();
      if (!handle) continue;
      if (known.has(handle) || screened.has(handle)) continue;

      const existingCand = found.get(handle);
      const caption = typeof item.caption === "string" ? item.caption : null;
      if (existingCand) {
        existingCand.posts++;
        if (caption && existingCand.captions.length < 3) existingCand.captions.push(caption);
        continue;
      }
      found.set(handle, {
        handle,
        market: p.market,
        seed: p.seed,
        // The reel payload doesn't reliably carry follower count; the
        // existing --profile stage fills that in and gates on it.
        followers: typeof item.ownerFollowersCount === "number" ? item.ownerFollowersCount : null,
        posts: 1,
        bio: null,
        captions: caption ? [caption] : [],
      });
      newHere++;
    }
    console.log(`  ${items.length} reel(s) -> ${newHere} new account(s)`);
  }

  console.log(`\n${found.size} new Instagram account(s) discovered.`);
  if (found.size === 0) return;

  // Accounts appearing under more than one seed are more likely to be
  // genuinely in-niche than a one-off match, so surface that ordering.
  const ranked = Array.from(found.values()).sort((a, b) => b.posts - a.posts);
  for (const c of ranked.slice(0, 25)) {
    console.log(`  @${c.handle.padEnd(28)} ${c.market}  ${c.posts} reel(s)  seed="${c.seed}"`);
  }

  const rows = ranked.map((c) => ({
    platform: "instagram",
    handle: c.handle,
    market_guess: c.market,
    found_via: `instagram discovery: keyword "${c.seed}" (${c.posts} reel(s) in results)`,
    followers: c.followers,
    recent_captions: c.captions.slice(0, 3),
  }));

  // Upsert on (platform, handle) is what discover.ts uses; anything already
  // present was filtered out above, so this only inserts genuinely new rows.
  const { error } = await supabase.from("discovery_candidates").upsert(rows, { onConflict: "platform,handle" });
  if (error) throw new Error(`Failed to write discovery_candidates: ${error.message}`);

  const spentAfter = await getRealMonthToDateSpendUsd(apifyToken);
  console.log(`\nWrote ${rows.length} candidate(s). Real spend now: $${spentAfter.toFixed(4)} / $${cap} (this run: $${(spentAfter - spentSoFar).toFixed(4)}).`);
  console.log(`Next: npm run discover -- --profile   (fills followers, gates on size/private)`);
  console.log(`Then: npm run discover -- --classify  (relevance, Anthropic only)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
