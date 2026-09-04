/**
 * Scores every existing hook_library row and generated_draft against
 * reference/business-definition.md and reports what fails, so drift that
 * predates the definition can be cleaned out.
 *
 * Reports by default. Only writes with --apply, and even then it never
 * DELETES a hook: an off-business hook is still a true record of what a
 * competitor did, so it is marked brand_fit='no' and kept. Drafts are
 * different -- a draft is something we would publish, so an off-business
 * one is set status='dismissed' rather than left in the ready-to-post
 * queue.
 *
 * Usage: npm run audit-relevance -- [--apply]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const BUSINESS_DEF = readFileSync(new URL("../reference/business-definition.md", import.meta.url), "utf-8");
const BATCH = 12;

type Verdict = { id: string; relevant: boolean; reason: string };

async function judge(anthropic: any, kind: string, items: { id: string; text: string }[]): Promise<Verdict[]> {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4000,
    system: `You decide whether content is relevant to Ark Abroad.

${BUSINESS_DEF}

You will be given ${kind}. For each, decide relevant true/false against the definition above, and give a short reason. Judge the SUBJECT, not the wording. A hook borrowed from a US competitor is still relevant if its subject applies to an internationally-trained person already in Australia -- format transfers, market does not. Mark false only where the subject genuinely fails the definition.

Output ONLY a JSON array, no fences: [{"id":"...","relevant":true,"reason":"..."}]`,
    messages: [{ role: "user", content: items.map((i) => `id=${i.id}\n${i.text}`).join("\n\n---\n\n") }],
  });
  const block = msg.content.find((b: any) => b.type === "text");
  const raw = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(raw); } catch { console.error("  (batch unparseable, skipped)"); return []; }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseClient();
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { data: hooks } = await supabase
    .from("hook_library")
    .select("hook_id, opening_line, sub_topic, content_angle, brand_fit");
  const hookItems = (hooks ?? [])
    .filter((h: any) => h.brand_fit !== "no")
    .map((h: any) => ({ id: h.hook_id, text: `HOOK: ${h.opening_line ?? ""}\nSUBJECT: ${h.sub_topic ?? ""} ${h.content_angle ?? ""}` }));

  const { data: drafts } = await supabase
    .from("generated_drafts")
    .select("draft_id, hook, script, market, status");
  const draftItems = (drafts ?? [])
    .filter((d: any) => d.status !== "dismissed")
    .map((d: any) => ({ id: d.draft_id, text: `MARKET TAG: ${d.market}\nHOOK: ${d.hook}\nSCRIPT: ${String(d.script).slice(0, 700)}` }));

  for (const [kind, items, table, idCol] of [
    ["competitor hooks", hookItems, "hook_library", "hook_id"],
    ["Ark Abroad post drafts we would publish", draftItems, "generated_drafts", "draft_id"],
  ] as const) {
    console.log(`\n=== ${kind}: ${items.length} to check ===`);
    const bad: Verdict[] = [];
    for (let i = 0; i < items.length; i += BATCH) {
      const v = await judge(anthropic, kind, items.slice(i, i + BATCH));
      bad.push(...v.filter((x) => !x.relevant));
      process.stdout.write(`  ${Math.min(i + BATCH, items.length)}/${items.length}\r`);
    }
    console.log(`\n  ${bad.length} off-business:`);
    for (const b of bad.slice(0, 40)) console.log(`    - ${b.reason}`);
    if (apply && bad.length) {
      for (const b of bad) {
        const patch = table === "hook_library"
          ? { brand_fit: "no", brand_fit_note: `Off-business: ${b.reason}` }
          : { status: "dismissed" };
        await supabase.from(table).update(patch).eq(idCol, b.id);
      }
      console.log(`  applied to ${bad.length} row(s).`);
    }
  }
  if (!apply) console.log("\nReport only. Re-run with --apply to write.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
