/**
 * Removes nationality-segmented and visa/sponsorship content from the
 * corpus, and deactivates accounts that produce little else.
 *
 * Triggered by a request to drop Pakistan content. It's removed as a genre
 * rather than as one row, because the Pakistan post is one entry in a
 * "top 10 countries by sponsorship grants" countdown -- the same content
 * exists for every other country in the list, and it breaks the same two
 * rules:
 *
 *   Never ships item 2 -- no generalisations about ethnic, national or
 *   religious communities. Sorting an audience by passport is exactly that.
 *
 *   Proof bank rule 4 -- never state or imply anything about visa outcomes
 *   or sponsorship eligibility. Immigration assistance is a regulated
 *   activity in Australia and Ark is a career accelerator, not a migration
 *   agent.
 *
 * So this isn't a taste filter; it's enforcing the brand's own standing
 * rules against material the scoring kept surfacing because
 * country-ranking countdowns get comments.
 *
 * Usage: npm run purge-nationality -- [--apply]
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

// Country-ranking / sponsorship-statistics content. Deliberately narrow:
// it targets content that SORTS PEOPLE BY NATIONALITY or trades in
// visa/sponsorship numbers -- not any mention of a country. A hook about
// "no local experience in Australia" is core audience material and must
// not be caught here.
export const NATIONALITY_VISA_PATTERN =
  /by nationality|nationalit(y|ies)|top \d+ countr|countr(y|ies) (list|ranking|breakdown)|overseas.born|sponsorship (grant|by|numbers)|\b482\b|sponsored by their employer|permanent residen|\bPR pathway/i;

interface Row {
  hook_id: string;
  competitor_id: string;
  sub_topic: string | null;
  content_angle: string | null;
  opening_line: string | null;
  narrative_structure: string | null;
  competitors: { handle: string; active: boolean } | null;
}

const DEACTIVATE_THRESHOLD = 0.6;

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hook_library")
    .select("hook_id, competitor_id, sub_topic, content_angle, opening_line, narrative_structure, competitors(handle, active)");
  if (error) throw new Error(`Failed to read hook_library: ${error.message}`);

  const rows = (data ?? []) as unknown as Row[];
  const text = (h: Row) =>
    `${h.sub_topic ?? ""} ${h.content_angle ?? ""} ${h.opening_line ?? ""} ${h.narrative_structure ?? ""}`;
  const hits = rows.filter((h) => NATIONALITY_VISA_PATTERN.test(text(h)));

  const tally = new Map<string, { handle: string; total: number; bad: number; active: boolean }>();
  for (const h of rows) {
    if (!h.competitors) continue;
    const e = tally.get(h.competitor_id) ?? { handle: h.competitors.handle, total: 0, bad: 0, active: h.competitors.active };
    e.total++;
    if (NATIONALITY_VISA_PATTERN.test(text(h))) e.bad++;
    tally.set(h.competitor_id, e);
  }
  const toDeactivate = Array.from(tally.entries()).filter(
    ([, e]) => e.active && e.total > 0 && e.bad / e.total >= DEACTIVATE_THRESHOLD
  );

  const { data: drafts } = await supabase.from("generated_drafts").select("draft_id, hook, script");
  const draftHits = (drafts ?? []).filter((d) => NATIONALITY_VISA_PATTERN.test(`${d.hook} ${d.script}`));

  console.log("hooks to delete:");
  for (const h of hits) console.log(`  ${h.competitors?.handle}: ${h.sub_topic}`);
  console.log(`\ndrafts to delete: ${draftHits.length}`);
  for (const d of draftHits) console.log(`  ${d.hook.slice(0, 80)}`);
  console.log(`\naccounts to deactivate: ${toDeactivate.length}`);
  for (const [, e] of toDeactivate) console.log(`  ${e.handle} (${e.bad}/${e.total})`);

  if (!apply) {
    console.log("\n(dry run -- pass --apply)");
    return;
  }

  for (const h of hits) await supabase.from("hook_library").delete().eq("hook_id", h.hook_id);
  for (const d of draftHits) await supabase.from("generated_drafts").delete().eq("draft_id", d.draft_id);
  for (const [id, e] of toDeactivate) {
    const { error: err } = await supabase.from("competitors").update({ active: false }).eq("competitor_id", id);
    console.log(err ? `  FAILED ${e.handle}: ${err.message}` : `  deactivated ${e.handle}`);
  }

  const { count: h } = await supabase.from("hook_library").select("*", { count: "exact", head: true });
  const { count: d } = await supabase.from("generated_drafts").select("*", { count: "exact", head: true });
  const { count: a } = await supabase
    .from("competitors")
    .select("*", { count: "exact", head: true })
    .eq("active", true)
    .eq("handle_verified", true);
  console.log(`\nhooks: ${h} | drafts: ${d} | active competitors: ${a}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
