/**
 * Removes non-English content from the library and the ready-made queue.
 *
 * Ark publishes in English to a reader in Australia. A Spanish carousel or
 * a Korean punchline can never become an Ark post, and worse, it scores:
 * the 198x hook sitting third in the library was the line "사랑합니다"
 * attached to an English subject about AI auto-apply.
 *
 * Detection lives in lib/language.ts, shared with draft_hook_tags so the
 * same judgement blocks new content and cleans up old.
 *
 * Hooks are marked brand_fit='no' rather than deleted -- an off-language
 * hook is still a true record of what a competitor did, and the dashboard
 * already hides that value. Drafts are dismissed. Posts are left in place:
 * they are raw harvested data we paid for, and removing them would only
 * corrupt the baselines computed from them. Blocking them from BECOMING a
 * hook is the part that matters, and draft_hook_tags now does that.
 *
 * Usage: npm run purge-non-english -- [--apply]
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { nonEnglishReason } from "./lib/language.ts";

async function pageAll(
  supabase: ReturnType<typeof getSupabaseClient>,
  table: string,
  cols: string
) {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseClient();

  const hooks = await pageAll(supabase, "hook_library", "hook_id, opening_line, brand_fit, outlier_score");
  const badHooks = hooks.filter(
    (h) => h.brand_fit !== "no" && nonEnglishReason(h.opening_line as string)
  );
  console.log(`HOOKS: ${badHooks.length} non-English of ${hooks.filter((h) => h.brand_fit !== "no").length} usable`);
  for (const h of badHooks) {
    console.log(
      `   ${Math.round(Number(h.outlier_score ?? 0))}x [${nonEnglishReason(h.opening_line as string)}] ${String(h.opening_line).slice(0, 60)}`
    );
  }

  const drafts = await pageAll(supabase, "generated_drafts", "draft_id, hook, script, status");
  const badDrafts = drafts.filter(
    (d) => d.status !== "dismissed" && (nonEnglishReason(d.hook as string) || nonEnglishReason(d.script as string))
  );
  console.log(`\nDRAFTS: ${badDrafts.length} non-English of ${drafts.filter((d) => d.status !== "dismissed").length} live`);
  for (const d of badDrafts) console.log(`   ${String(d.hook).slice(0, 66)}`);

  // Reported, not deleted -- see the header comment.
  const posts = await pageAll(supabase, "competitor_posts", "post_id, caption");
  const badPosts = posts.filter((p) => nonEnglishReason(p.caption as string));
  console.log(
    `\nPOSTS: ${badPosts.length} non-English of ${posts.length} (left in place -- raw data, and baselines are computed from it; they are blocked from becoming hooks instead)`
  );

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to write.");
    return;
  }

  for (const h of badHooks) {
    await supabase
      .from("hook_library")
      .update({
        brand_fit: "no",
        brand_fit_note: `Not English (${nonEnglishReason(h.opening_line as string)}). Ark publishes in English to a reader in Australia.`,
      })
      .eq("hook_id", h.hook_id as string);
  }
  for (const d of badDrafts) {
    await supabase.from("generated_drafts").update({ status: "dismissed" }).eq("draft_id", d.draft_id as string);
  }
  console.log(`\nApplied: ${badHooks.length} hook(s) marked brand_fit='no', ${badDrafts.length} draft(s) dismissed.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
