/**
 * One-off: retroactively classify candidates that were gated 'pass' by
 * the OLD full-gate flow, before --classify existed -- their gate_result
 * is already terminal ('pass'), so the normal --classify query (which
 * only picks up gate_result IS NULL rows) never sees them. Anthropic-only
 * cost, no Apify spend.
 */
import "dotenv/config";
import { classifyBatch } from "./discover.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const HANDLES = process.argv.slice(2);

async function main() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY must be set.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const supabase = getSupabaseClient();

  const { data: candidates, error } = await supabase
    .from("discovery_candidates")
    .select("candidate_id, handle, bio, recent_captions")
    .in("handle", HANDLES);
  if (error) throw new Error(error.message);
  if (!candidates || candidates.length === 0) {
    console.log("No matching candidates found.");
    return;
  }

  const results = await classifyBatch(anthropic, candidates);

  for (const c of candidates) {
    const r = results.get(c.handle);
    if (!r) {
      console.error(`No classification returned for ${c.handle}`);
      continue;
    }
    const { error: updateError } = await supabase
      .from("discovery_candidates")
      .update({ classification: r.classification, classification_reason: r.reason })
      .eq("candidate_id", c.candidate_id);
    if (updateError) {
      console.error(`Failed to update ${c.handle}: ${updateError.message}`);
      continue;
    }
    console.log(`${c.handle}: ${r.classification} -- ${r.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
