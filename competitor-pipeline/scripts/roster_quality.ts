/**
 * Per-account contribution report: which competitors are actually
 * producing usable hook intelligence, and which are costing harvest spend
 * to collect noise.
 *
 * The scoring chain is deliberately RELATIVE -- v_outliers compares a post
 * against its own account's median vpf -- which is correct for finding
 * "this landed unusually well for them", but has a side effect: an account
 * that mostly posts off-topic content still yields outliers, and a viral
 * travel clip from a career account outranks that account's genuinely good
 * career advice. Nothing upstream filters on what a post is ABOUT.
 *
 * So relevance has to be judged from the hook_library tags a human (or
 * draft_hook_tags.ts) has already written. This script reads nothing new
 * from any paid API -- it's a pure Supabase read over data already
 * collected.
 *
 * Verdict column is a SUGGESTION for a human, never applied automatically:
 * deactivating a competitor is a judgement call about what Ark wants to
 * track, and a low-signal account may still be worth watching.
 *
 * Usage: npm run roster-quality
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

interface Row {
  competitor_id: string;
  name: string;
  market: string;
  tier: string;
  platform: string;
  posts: number;
  tagged: number;
  fitYes: number;
  fitWith: number;
  fitNo: number;
  subTopics: string[];
  relevance?: "on_topic" | "mixed" | "off_topic";
  relevanceNote?: string;
}

/**
 * Topical relevance is a SEPARATE axis from brand_fit and has to be judged
 * separately. brand_fit answers "could Ark rebuild something on this
 * structure" -- a travel vlog's cold-open shape scores 'with_changes' quite
 * legitimately. That says nothing about whether the account is worth
 * spending harvest budget on. An early version of this report conflated the
 * two and recommended KEEP for an account whose only two outliers were
 * "sunset lifestyle travel moment" and "weather resilience travel vlog".
 */
async function judgeRelevance(rows: Row[], anthropicApiKey: string): Promise<void> {
  const withTopics = rows.filter((r) => r.subTopics.length > 0);
  if (withTopics.length === 0) return;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const system = `Ark Abroad is a Melbourne talent accelerator helping internationally-trained professionals and skilled migrants land CORPORATE ROLES IN AUSTRALIA. They track competitor accounts to learn hook and format patterns for career/job-search content.

You are given competitor accounts and the subject matter of their best-performing videos. Judge whether each account's CONTENT is topically relevant to Ark's audience -- job search, hiring, interviews, resumes, careers, workplace navigation, professional positioning.

Relevant even if not migrant-specific: general career, job search, interview, resume, workplace and hiring content.
NOT relevant: travel vlogs, lifestyle content, student dorm life, personal relationship advice, general motivation with no career mechanism, plain job-board listing reposts with no teaching.

Return ONLY a JSON array, no fences:
[{"name": "...", "relevance": "on_topic|mixed|off_topic", "note": "one short sentence"}]
One object per account, in the order given, copying name exactly.`;

  const userContent = withTopics
    .map((r) => `name: ${r.name}\nbest-performing video subjects: ${r.subTopics.join(" | ")}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userContent }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return;
  const jsonText = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: { name: string; relevance: string; note: string }[];
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.error("Could not parse relevance response; continuing without it.");
    return;
  }

  const byName = new Map(parsed.map((p) => [p.name, p]));
  for (const r of rows) {
    const p = byName.get(r.name);
    if (!p) continue;
    if (p.relevance === "on_topic" || p.relevance === "mixed" || p.relevance === "off_topic") {
      r.relevance = p.relevance;
      r.relevanceNote = p.note;
    }
  }
}

function verdict(r: Row): { label: string; why: string } {
  if (r.tagged === 0) {
    return { label: "NO DATA", why: "no tagged outliers yet -- can't judge" };
  }
  // Topical relevance is checked FIRST and outranks brand_fit: an account
  // whose content isn't about careers at all is costing harvest spend and
  // crowding the outlier queue no matter how reusable its structures are.
  if (r.relevance === "off_topic") {
    return { label: "DROP", why: `content is off-topic -- ${r.relevanceNote ?? "not career content"}` };
  }
  const noRate = r.fitNo / r.tagged;
  const usable = r.fitYes + r.fitWith;
  if (noRate >= 0.5) {
    return { label: "DROP", why: `${r.fitNo}/${r.tagged} outliers trip a Never-ships rule` };
  }
  if (usable === 0) {
    return { label: "DROP", why: "nothing usable across all tagged outliers" };
  }
  if (r.relevance === "mixed") {
    return { label: "REVIEW", why: `mixed relevance -- ${r.relevanceNote ?? "some outliers off-topic"}` };
  }
  if (r.fitYes === 0 && r.tagged >= 3 && r.fitWith === r.tagged) {
    return { label: "KEEP", why: "all usable, but every one needs rebuilding -- structure-only value" };
  }
  return { label: "KEEP", why: `${usable}/${r.tagged} outliers usable` };
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: competitors, error: cErr } = await supabase
    .from("competitors")
    .select("competitor_id, name, market, tier, platform, active, handle_verified")
    .eq("active", true)
    .eq("handle_verified", true);
  if (cErr) throw new Error(`Failed to read competitors: ${cErr.message}`);

  const { data: hooks, error: hErr } = await supabase
    .from("hook_library")
    .select("competitor_id, brand_fit, sub_topic");
  if (hErr) throw new Error(`Failed to read hook_library: ${hErr.message}`);

  const { data: posts, error: pErr } = await supabase.from("competitor_posts").select("competitor_id");
  if (pErr) throw new Error(`Failed to read competitor_posts: ${pErr.message}`);

  const postCount = new Map<string, number>();
  for (const p of posts ?? []) {
    postCount.set(p.competitor_id, (postCount.get(p.competitor_id) ?? 0) + 1);
  }

  const rows: Row[] = (competitors ?? []).map((c) => {
    const mine = (hooks ?? []).filter((h) => h.competitor_id === c.competitor_id);
    return {
      competitor_id: c.competitor_id,
      name: c.name,
      market: c.market,
      tier: c.tier,
      platform: c.platform,
      posts: postCount.get(c.competitor_id) ?? 0,
      tagged: mine.length,
      fitYes: mine.filter((h) => h.brand_fit === "yes").length,
      fitWith: mine.filter((h) => h.brand_fit === "with_changes").length,
      fitNo: mine.filter((h) => h.brand_fit === "no").length,
      subTopics: mine.map((h) => h.sub_topic).filter((s): s is string => !!s),
    };
  });

  rows.sort((a, b) => b.tagged - a.tagged || b.posts - a.posts);

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicApiKey) {
    await judgeRelevance(rows, anthropicApiKey);
  } else {
    console.log("(ANTHROPIC_API_KEY not set -- skipping topical-relevance judgement, verdicts use brand_fit only)\n");
  }

  const totalTagged = rows.reduce((s, r) => s + r.tagged, 0);
  console.log(`Roster contribution report -- ${rows.length} active competitor(s), ${totalTagged} tagged outlier(s).\n`);

  const withData = rows.filter((r) => r.tagged > 0);
  const withoutData = rows.filter((r) => r.tagged === 0);

  console.log("ACCOUNTS WITH TAGGED OUTLIERS");
  console.log("-".repeat(100));
  for (const r of withData) {
    const v = verdict(r);
    console.log(`${v.label.padEnd(8)} ${r.name} (${r.market}/${r.tier}/${r.platform})`);
    console.log(`         ${r.posts} posts | ${r.tagged} tagged | brand_fit yes:${r.fitYes} with_changes:${r.fitWith} no:${r.fitNo} | relevance: ${r.relevance ?? "unjudged"}`);
    console.log(`         ${v.why}`);
    console.log(`         topics: ${r.subTopics.slice(0, 6).join(" | ")}${r.subTopics.length > 6 ? " ..." : ""}`);
    console.log("");
  }

  console.log("\nACCOUNTS WITH NO TAGGED OUTLIERS YET");
  console.log("-".repeat(100));
  for (const r of withoutData) {
    console.log(`  ${r.name} (${r.market}/${r.tier}/${r.platform}) -- ${r.posts} posts collected, 0 tagged`);
  }

  const drops = withData.filter((r) => verdict(r).label === "DROP");
  const reviews = withData.filter((r) => verdict(r).label === "REVIEW");
  console.log(`\nSUGGESTED: ${drops.length} DROP, ${reviews.length} REVIEW.`);
  console.log("Nothing is deactivated automatically -- set active=false by hand if you agree.");
  for (const r of drops) console.log(`  DROP   ${r.name} (${r.market}) -- ${verdict(r).why}`);
  for (const r of reviews) console.log(`  REVIEW ${r.name} (${r.market}) -- ${verdict(r).why}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
