/**
 * Assigns topic_slug to hooks that have none.
 *
 * A third of the usable library was unclassified, not because the subjects
 * were unclear but because the taxonomy only covered getting hired --
 * migration 015 widened it. This backfills against the wider set.
 *
 * Rules are explicit rather than model-inferred: the mapping from a
 * sub_topic to a slug is a judgement about Ark's audience, and the same
 * judgement has to hold for every future run of draft_hook_tags. A rule
 * table is reviewable; a model call on 29 rows is not reproducible.
 *
 * Anything that matches nothing stays NULL on purpose. Some of these
 * subjects -- resigning, counteroffers, executive presence blocking a
 * promotion -- belong to someone already established in a corporate career,
 * not to a reader in a survival job trying to enter one. Giving them a slug
 * would pull the content strategy toward the wrong audience.
 *
 * Usage: npm run backfill-topic-slugs -- [--apply]
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const RULES: { slug: string; test: RegExp }[] = [
  // Largest and best-performing cluster in the library, including its
  // single highest-scoring hook at 225x.
  { slug: "ai-in-job-search", test: /\bAI\b|certificat|upskill/i },
  // Landing the role is where our reader's problem starts, not ends.
  { slug: "first-90-days", test: /first (weeks|days|90)|new (corporate )?role|corporate culture|receiving feedback|onboard/i },
  { slug: "workplace-bias", test: /bias|accent|sexist|professionalism|discriminat|harass/i },
  { slug: "pay-and-conditions", test: /unpaid|overtime|\bPTO\b|salary|negotiat|raise\b|benefits/i },
  // What an overseas degree is actually worth here -- the core of the
  // audience's problem.
  { slug: "credential-translation", test: /\bPhD\b|\bMBA\b|degree|academia|qualification|credential/i },
  // Existing slugs still apply to some of the unclassified rows.
  { slug: "volume-no-results", test: /job search timeline|benchmark|application screening|government job/i },
  { slug: "linkedin-networking", test: /portfolio domain|personal (site|website)|network/i },
];

// Checked before the rules: these match a rule's wording but are out of
// scope, and a silent match would put them in the library as if they were
// ours to write about.
const OUT_OF_SCOPE = /resign|quitting|counteroffer|executive presence/i;

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hook_library")
    .select("hook_id, sub_topic, outlier_score, brand_fit, topic_slug")
    .neq("brand_fit", "no");
  if (error) throw new Error(`Failed to read hook_library: ${error.message}`);

  const pending = (data ?? []).filter((h) => !h.topic_slug && (h.sub_topic ?? "").trim());
  console.log(`${pending.length} usable hook(s) with no topic_slug.\n`);

  let matched = 0;
  const skipped: string[] = [];

  for (const h of pending) {
    const subject = String(h.sub_topic);

    if (OUT_OF_SCOPE.test(subject)) {
      skipped.push(`${subject} (out of scope: already established in a corporate career)`);
      continue;
    }

    const rule = RULES.find((r) => r.test.test(subject));
    if (!rule) {
      skipped.push(`${subject} (no rule matched)`);
      continue;
    }

    console.log(`  ${rule.slug.padEnd(22)} ${subject}`);
    matched++;

    if (apply) {
      const { error: upErr } = await supabase
        .from("hook_library")
        .update({ topic_slug: rule.slug, updated_at: new Date().toISOString() })
        .eq("hook_id", h.hook_id);
      if (upErr) console.error(`    FAILED: ${upErr.message}`);
    }
  }

  console.log(`\n${matched} classified, ${skipped.length} deliberately left NULL:`);
  for (const s of skipped) console.log(`  - ${s}`);
  if (!apply) console.log("\nReport only. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
