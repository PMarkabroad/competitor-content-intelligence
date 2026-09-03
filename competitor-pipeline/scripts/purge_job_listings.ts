/**
 * Removes job-listing content from the corpus and deactivates the accounts
 * that produce nothing else.
 *
 * "Remote work-from-home job" posts are a whole genre in this space: an
 * account reads out a live vacancy -- pay, duties, who qualifies, where to
 * apply. They score well because listings get saved and shared, so the
 * relative-to-own-baseline scoring surfaces them constantly. But they carry
 * no hook craft to learn from, and Ark does not post job boards. They were
 * crowding Content ideas, Insights and the drafts.
 *
 * Accounts whose output is ENTIRELY listings get deactivated -- there's
 * nothing to keep. Accounts with a listing or two among otherwise good
 * content keep the account and lose the listing rows only.
 *
 * Usage: npm run purge-job-listings -- [--apply]
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

export const JOB_LISTING_PATTERN =
  /remote (job|role|work)|work from home|job (lead|listing|drop|alert|posting)|hiring (right )?now|now hiring|wfh\b|apply (now|here)|vacanc/i;

// An account this far into listings has nothing else to offer the corpus.
const DEACTIVATE_THRESHOLD = 0.8;

interface Row {
  hook_id: string;
  competitor_id: string;
  sub_topic: string | null;
  content_angle: string | null;
  opening_line: string | null;
  competitors: { handle: string; market: string; active: boolean } | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hook_library")
    .select("hook_id, competitor_id, sub_topic, content_angle, opening_line, competitors(handle, market, active)");
  if (error) throw new Error(`Failed to read hook_library: ${error.message}`);

  const rows = (data ?? []) as unknown as Row[];
  const isListing = (h: Row) =>
    JOB_LISTING_PATTERN.test(`${h.sub_topic ?? ""} ${h.content_angle ?? ""} ${h.opening_line ?? ""}`);

  const listingHooks = rows.filter(isListing);

  const tally = new Map<string, { handle: string; total: number; listing: number; active: boolean }>();
  for (const h of rows) {
    if (!h.competitors) continue;
    const e = tally.get(h.competitor_id) ?? {
      handle: h.competitors.handle,
      total: 0,
      listing: 0,
      active: h.competitors.active,
    };
    e.total++;
    if (isListing(h)) e.listing++;
    tally.set(h.competitor_id, e);
  }

  const toDeactivate = Array.from(tally.entries()).filter(
    ([, e]) => e.active && e.total > 0 && e.listing / e.total >= DEACTIVATE_THRESHOLD
  );

  const { data: drafts } = await supabase.from("generated_drafts").select("draft_id, hook, script");
  const listingDrafts = (drafts ?? []).filter((d) => JOB_LISTING_PATTERN.test(`${d.hook} ${d.script}`));

  console.log(`hooks to delete:        ${listingHooks.length} of ${rows.length}`);
  console.log(`drafts to delete:       ${listingDrafts.length} of ${(drafts ?? []).length}`);
  console.log(`accounts to deactivate: ${toDeactivate.length}`);
  for (const [, e] of toDeactivate) console.log(`  ${e.handle} (${e.listing}/${e.total} listings)`);

  if (!apply) {
    console.log("\n(dry run -- pass --apply)");
    return;
  }

  for (const h of listingHooks) {
    await supabase.from("hook_library").delete().eq("hook_id", h.hook_id);
  }
  for (const d of listingDrafts) {
    await supabase.from("generated_drafts").delete().eq("draft_id", d.draft_id);
  }
  for (const [id, e] of toDeactivate) {
    const { error: err } = await supabase.from("competitors").update({ active: false }).eq("competitor_id", id);
    console.log(err ? `  FAILED ${e.handle}: ${err.message}` : `  deactivated ${e.handle}`);
  }

  const { count: hooksLeft } = await supabase.from("hook_library").select("*", { count: "exact", head: true });
  const { count: draftsLeft } = await supabase.from("generated_drafts").select("*", { count: "exact", head: true });
  const { count: activeLeft } = await supabase
    .from("competitors")
    .select("*", { count: "exact", head: true })
    .eq("active", true)
    .eq("handle_verified", true);
  console.log(`\nhooks: ${hooksLeft} | drafts: ${draftsLeft} | active competitors: ${activeLeft}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
