/**
 * One-off: the --profile run's HTTP request timed out client-side (Node's
 * undici headers timeout, ~5min) but the Apify run kept going server-side
 * and succeeded, billing real money. Rather than losing that paid-for data
 * and re-running (paying twice), pull the completed dataset directly and
 * run the exact same post-processing stageProfile() would have run on it.
 *
 * DATASET_ID must be set to the salvage target's defaultDatasetId (from
 * GET /v2/actor-runs/{runId}) before running. Used three times this
 * session so far: 2026-08-26 AU run (dataset Pbt7kLIJpjftaMN3a), the US
 * run (dataset GdaULJMB5Ahprx9I1), and the CA run (dataset
 * SGltnjldiC1wpnymA) -- update the constant per use.
 */
import "dotenv/config";
import { config } from "../config.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const DATASET_ID = "SGltnjldiC1wpnymA";

async function main() {
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) throw new Error("APIFY_TOKEN must be set.");
  const supabase = getSupabaseClient();

  const res = await fetch(
    `https://api.apify.com/v2/datasets/${DATASET_ID}/items?token=${apifyToken}&format=json&clean=true`
  );
  if (!res.ok) throw new Error(`Failed to fetch dataset: ${res.status} ${res.statusText}`);
  const items = (await res.json()) as Record<string, unknown>[];
  console.log(`Fetched ${items.length} item(s) from salvaged dataset.`);

  const { data: pending, error } = await supabase
    .from("discovery_candidates")
    .select("candidate_id, handle")
    .is("followers", null)
    // Same fix as stageProfile in discover.ts -- without this, every
    // already-confirmed-dead handle from an earlier sweep gets mixed
    // into this salvage's "pending" set too.
    .is("gate_result", null);
  if (error) throw new Error(`Failed to read discovery_candidates: ${error.message}`);
  if (!pending || pending.length === 0) {
    console.log("No candidates need profiling.");
    return;
  }

  const itemsByHandle = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;
    const handle = String(author.name ?? author.uniqueId ?? item.uniqueId ?? "");
    if (!handle) continue;
    if (!itemsByHandle.has(handle)) itemsByHandle.set(handle, []);
    itemsByHandle.get(handle)!.push(item);
  }

  const byHandle = new Map<string, string>(pending.map((p) => [p.handle, p.candidate_id]));
  const gates = config.DISCOVERY_GATES;

  let updated = 0;
  let cheapFailed = 0;
  let noData = 0;
  for (const p of pending) {
    const handleItems = itemsByHandle.get(p.handle);
    if (!handleItems || handleItems.length === 0) {
      noData += 1;
      continue;
    }
    const item = handleItems[0];
    const author = (item.authorMeta ?? item.author ?? {}) as Record<string, unknown>;

    const recentCaptions = handleItems
      .map((i) => String(i.text ?? ""))
      .filter((t) => t.length > 0)
      .slice(0, 3);

    const followers = Number(author.fans ?? author.followerCount ?? item.fans ?? 0) || null;
    const isPrivate = Boolean(author.privateAccount ?? author.isPrivate ?? item.privateAccount ?? false);

    const failReasons: string[] = [];
    if (followers === null || followers < gates.minFollowers) {
      failReasons.push(`followers=${followers} < ${gates.minFollowers}`);
    }
    if (isPrivate) {
      failReasons.push("is_private=true");
    }

    const cheapGateFailed = failReasons.length > 0;
    if (cheapGateFailed) cheapFailed += 1;

    const { error: updateError } = await supabase
      .from("discovery_candidates")
      .update({
        followers,
        bio: author.signature ?? item.signature ?? null,
        is_private: isPrivate,
        recent_captions: recentCaptions,
        gate_result: cheapGateFailed ? "fail" : null,
        gate_fail_reason: cheapGateFailed ? failReasons.join("; ") : null,
      })
      .eq("candidate_id", p.candidate_id);
    if (!updateError) updated += 1;
  }
  console.log(`Updated ${updated} candidate(s). ${cheapFailed} failed a cheap gate (followers/private). ${noData} had no items in the salvaged dataset (will need a re-run or manual review).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
