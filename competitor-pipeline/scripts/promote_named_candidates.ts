/**
 * One-off: promote a specific, named set of already-gated discovery_candidates
 * into competitors, mirroring stagePromote()'s insert shape. Used for the
 * Prompt 4 Step 1 promotion list, which needed a manual classification
 * re-check first (see classify_pre_classify_candidates.ts) rather than the
 * normal CSV shortlist -> --promote flow.
 */
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const HANDLES = process.argv.slice(3);
const REVIEWED_BY = process.argv[2];

if (!REVIEWED_BY || HANDLES.length === 0) {
  console.error("Usage: tsx scripts/promote_named_candidates.ts <reviewed_by> <handle> [handle...]");
  process.exit(1);
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: candidates, error } = await supabase
    .from("discovery_candidates")
    .select("candidate_id, handle, display_name, platform, market_guess, found_via, video_posts_90d, median_vpf_90d, classification, promoted")
    .in("handle", HANDLES);
  if (error) throw new Error(error.message);

  for (const handle of HANDLES) {
    const row = candidates?.find((c) => c.handle === handle);
    if (!row) {
      console.log(`SKIPPED (not found in discovery_candidates): ${handle}`);
      continue;
    }
    if (row.classification === "regulated") {
      console.log(`REFUSED (classification=regulated): ${handle}`);
      continue;
    }
    if (row.promoted) {
      console.log(`SKIPPED (already promoted): ${handle}`);
      continue;
    }

    const { error: insertError } = await supabase.from("competitors").insert({
      name: row.display_name?.trim() || row.handle,
      tier: "T2",
      market: "AU",
      platform: row.platform || "tiktok",
      handle: row.handle,
      handle_verified: true,
      active: true,
      notes: `Promoted from discovery pass ${new Date().toISOString().slice(0, 10)} by ${REVIEWED_BY}. found_via="${row.found_via}", video_posts_90d=${row.video_posts_90d}, median_vpf_90d=${row.median_vpf_90d}, classification=${row.classification}.`,
    });
    if (insertError) {
      console.error(`Failed to insert ${handle} into competitors: ${insertError.message}`);
      continue;
    }

    await supabase
      .from("discovery_candidates")
      .update({
        reviewed_by: REVIEWED_BY,
        reviewed_at: new Date().toISOString(),
        proposed_tier: "T2",
        promoted: true,
      })
      .eq("candidate_id", row.candidate_id);

    console.log(`PROMOTED: ${handle} -> competitors (T2, AU, ${row.platform})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
