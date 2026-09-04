/**
 * Generates original Ark posts from the AGGREGATE intelligence, not from a
 * single competitor video.
 *
 * pregenerate_drafts.ts adapts one competitor post at a time -- useful, but
 * it can only ever produce a variation on something one account already
 * made. This script feeds the model what the whole corpus says: which hook
 * patterns actually score, which video shapes score, which subjects are
 * proven but barely covered, and how the three markets differ. Then it asks
 * for posts that put a winning pattern onto an uncovered subject -- a
 * combination no single competitor has made yet.
 *
 * Same voice rules as the per-post path, read from the same skill files:
 * proof bank enforced, no visa or migration claims, no invented vacancies
 * or salaries, Green-tier story material only.
 *
 * Stored in generated_drafts with source_post_id = null, so /drafts and
 * /content-ideas can tell an analysis-derived post from an adaptation.
 * source_caption carries the evidence the post was built on, so a human
 * can see why it was suggested.
 *
 * Usage: npm run generate-from-analysis -- [--count=5] [--dry-run]
 *
 * Any --count above BATCH_SIZE is generated across several calls, each one
 * told which hooks the earlier batches already used so the batches don't
 * converge on the same few highest-scoring gaps.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const BUSINESS_DEF_PATH = new URL("../reference/business-definition.md", import.meta.url);
const SKILL_DIR = new URL("../reference/arkabroad-voice-skill/", import.meta.url);

interface HookRow {
  post_id: string;
  hook_pattern: string | null;
  narrative_structure: string | null;
  sub_topic: string | null;
  content_angle: string | null;
  opening_line: string | null;
  outlier_score: number | null;
  brand_fit: string | null;
  competitor_id: string;
  competitors: { name: string; market: string; active: boolean } | null;
}

function arg(name: string): string | null {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : null;
}

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
}

function buildVoiceGuide(): string {
  const strip = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const read = (rel: string) => readFileSync(new URL(rel, SKILL_DIR), "utf-8").trim();
  return [
    strip(read("SKILL.md")),
    "\n---\n# Reference: proof bank\n",
    "These are the ONLY approved numbers. If a figure is not here, it does not go in the post.",
    read("references/proof-bank.md"),
    "\n---\n# Reference: voice bank\n",
    "Cadence samples. Match the rhythm; do not quote these lines as copy.",
    read("references/voice-bank.md"),
  ].join("\n");
}

async function main() {
  const count = Number(arg("count") ?? 5);
  // Posts per API call. Five fits comfortably inside max_tokens alongside
  // adaptive thinking; 25 did not.
  const BATCH_SIZE = 5;
  // Which market(s) the batch may write for. Left open, the model picks the
  // market itself and picks AU nearly every time -- a 25-post run came back
  // 24 AU / 1 CA / 0 US, because the voice doc and proof bank are written
  // in Australian specifics and that is the path of least resistance. It is
  // not wrong about the evidence; it just never reaches the other two
  // markets on its own. --market pins it.
  // --market is gone on purpose. It briefly existed to force variety after
  // a run came back 24 AU / 1 CA / 0 US, on the assumption that Ark served
  // all three markets. arkabroad.com says otherwise -- Australia only,
  // "built for the Australian market, not generic advice" -- and what the
  // flag actually produced was the founder's Melbourne story stamped [US].
  // The AU skew was the model being right about the business.
  if (arg("market")) {
    throw new Error(
      "--market is no longer supported: Ark Abroad serves the Australian market only " +
        "(see reference/business-definition.md). Every draft is written for a reader in Australia."
    );
  }
  const dryRun = process.argv.includes("--dry-run");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set.");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("hook_library")
    .select(
      "post_id, hook_pattern, narrative_structure, sub_topic, content_angle, opening_line, outlier_score, brand_fit, competitor_id, competitors(name, market, active)"
    )
    .order("outlier_score", { ascending: false });
  if (error) throw new Error(`Failed to read hook_library: ${error.message}`);

  // Same exclusions the dashboard applies: nothing that trips a
  // Never-ships rule, nothing from an account we've since dropped.
  const rows = ((data ?? []) as unknown as HookRow[]).filter(
    (r) => r.brand_fit !== "no" && r.competitors?.active !== false && r.outlier_score != null
  );
  if (rows.length === 0) {
    console.log("No usable tagged hooks. Run the tagging pass first.");
    return;
  }

  // Pattern performance
  const byPattern = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.hook_pattern) continue;
    if (!byPattern.has(r.hook_pattern)) byPattern.set(r.hook_pattern, []);
    byPattern.get(r.hook_pattern)!.push(r.outlier_score!);
  }
  const patterns = Array.from(byPattern.entries())
    .map(([p, s]) => ({ pattern: p, n: s.length, score: avg(s) }))
    .sort((a, b) => b.score - a.score);

  // Subject coverage -- proven but thinly covered is where the opening is.
  const bySubject = new Map<string, HookRow[]>();
  for (const r of rows) {
    const k = r.sub_topic?.trim();
    if (!k) continue;
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k)!.push(r);
  }
  const subjects = Array.from(bySubject.entries()).map(([subject, rs]) => ({
    subject,
    n: rs.length,
    accounts: new Set(rs.map((r) => r.competitor_id)).size,
    score: avg(rs.map((r) => r.outlier_score!)),
  }));
  // Visa/sponsorship subjects are stripped from the gap list before the
  // model ever sees it. They score well and are barely covered, so they
  // rank high as "opportunities" -- but immigration assistance is a
  // regulated activity in Australia and Ark is not a migration agent, so
  // they are not opportunities, they are a compliance problem. The prompt
  // forbids them too; this stops them being offered in the first place
  // rather than relying on the model to decline a suggestion we made.
  const REGULATED = /\bvisa|sponsorship|sponsored|\b482\b|migration|immigration|\bPR\b|permanent residen/i;
  const excludedGaps = subjects.filter((s) => s.accounts <= 2 && REGULATED.test(s.subject));

  const gaps = subjects
    .filter((s) => s.accounts <= 2 && !REGULATED.test(s.subject))
    .sort((a, b) => b.score / (b.accounts || 1) - a.score / (a.accounts || 1))
    .slice(0, 12);

  if (excludedGaps.length > 0) {
    console.log(
      `(excluded ${excludedGaps.length} regulated-topic subject(s) from the gap list: ${excludedGaps
        .map((g) => g.subject)
        .join("; ")})\n`
    );
  }

  // Market split
  const byMarket = new Map<string, number[]>();
  for (const r of rows) {
    const m = r.competitors?.market;
    if (!m) continue;
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(r.outlier_score!);
  }

  const topStructures = rows
    .filter((r) => r.narrative_structure && r.narrative_structure !== "null")
    .slice(0, 12)
    .map((r) => `${r.outlier_score!.toFixed(1)}x — ${r.narrative_structure}`);

  const evidence = [
    `CORPUS: ${rows.length} tagged high-performing competitor videos across ${byMarket.size} markets (AU/US/CA).`,
    "",
    "HOOK PATTERNS BY AVERAGE OUTLIER SCORE (score = how far above that account's own median the video landed):",
    ...patterns.map((p) => `  ${p.pattern.replace(/_/g, " ")}: ${p.score.toFixed(1)}x across ${p.n} video(s)`),
    "",
    "HIGH-PERFORMING VIDEO STRUCTURES (the running order competitors actually used):",
    ...topStructures.map((s) => `  ${s}`),
    "",
    "PROVEN BUT BARELY COVERED SUBJECTS (strong score, two or fewer accounts covering it — this is where the opening is):",
    ...gaps.map((g) => `  ${g.subject}: ${g.score.toFixed(1)}x, ${g.accounts} account(s), ${g.n} video(s)`),
    "",
    "MARKET COMPARISON:",
    ...Array.from(byMarket.entries()).map(([m, s]) => `  ${m}: ${avg(s).toFixed(1)}x average across ${s.length} video(s)`),
  ].join("\n");

  console.log(evidence);
  console.log(`\nAsking for ${count} post(s) built from this.\n`);
  if (dryRun) {
    console.log("Dry run -- nothing generated.");
    return;
  }

  const system = `You are the content strategist for Ark Abroad, writing in the founder's voice per the guide below.

${buildVoiceGuide()}

---

WHO THIS IS FOR AND WHAT IS OUT OF SCOPE. Read this before writing anything. If a post would fail it, do not write that post -- pick a different angle from the evidence.

${readFileSync(BUSINESS_DEF_PATH, "utf-8")}

---

You are given AGGREGATE competitive intelligence: what is actually working across dozens of competitor videos in the Australian, US and Canadian career-content markets. You are NOT adapting any single competitor video.

The US and Canadian videos are in the evidence for their HOOK PATTERNS and STRUCTURES only. Borrow the shape; never borrow the market. Every post you write is for a reader IN AUSTRALIA who already holds Australian work rights.

Your job: propose original Ark Abroad posts that put a high-scoring hook pattern and structure onto a subject the data shows is proven but barely covered. The combination should be one no competitor in the data has made yet. Ground every choice in the evidence given -- say which pattern and which gap each post is built on.

HARD RULES, no exceptions:
- Every number must appear verbatim in the proof bank above. If the proof bank doesn't have it, write the line without a number.
- Never invent a specific vacancy, employer, salary or city as though it exists, and never invent WHAT SOMETHING COSTS -- not what a coach or service charges, not what a process costs a person. No made-up job postings and no made-up prices, even as illustration. A reader can't tell an illustration from a market claim.
- Never state or imply anything about visa outcomes, sponsorship eligibility or migration pathways. Immigration assistance is a regulated activity in Australia; Ark is a career accelerator, not a migration agent.
- Green-tier founder story material only.
- PERSON. Every script must contain all three of these, and you should be able to point at them:
  (a) an empathy-pivot stack written in THIRD person, at least three sentences with the same opener, about the people this is for -- "They're taking action. They're executing like crazy. They're working hard in their survival jobs." Do NOT write this stack as "you";
  (b) at least one FIRST person beat from the founder's own history -- "I applied to 1,000 to 2,000 roles with no replies";
  (c) second person only where you are telling one person what to do.
  Do not open consecutive sentences with "You" or "Your". If three sentences in a row begin with "You", rewrite two of them. Measured against the founder's real transcripts, drafts have been running "you/your" at nearly twice his rate, and it reads as nagging rather than as him.
- Follow "Never ships" in full.

Output ONLY valid JSON, no markdown fences, no preamble:
[{"market":"AU|US|CA","built_on":"one sentence naming the pattern and the gap subject this uses, citing the numbers from the evidence","hook":"the opening line, opening cold","script":"the full reel or carousel script, ready to read","caption":"a short Instagram caption at the Instagram register"}]
Exactly ${BATCH_SIZE} objects. Every object's "market" is "AU" -- Ark serves Australia only.`;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });

  // Generated in batches rather than one call. Asking for 25 posts at once
  // overran max_tokens -- adaptive thinking draws from the same budget as
  // the output -- and the reply came back as JSON truncated mid-string,
  // which threw away every post in the batch, not just the last one.
  // Batching caps the blast radius too: one bad batch now costs BATCH_SIZE
  // posts instead of the whole run.
  type Post = { market: string; built_on: string; hook: string; script: string; caption: string };
  const posts: Post[] = [];

  for (let batch = 0; posts.length < count; batch++) {
    const remaining = count - posts.length;
    const askFor = Math.min(BATCH_SIZE, remaining);

    // Each batch is a fresh call with no memory of the last one, so without
    // this the model re-derives the same highest-scoring gaps every time and
    // returns near-duplicates.
    const avoid = posts.length
      ? "\n\nAlready written -- do NOT repeat these angles or reopen with these lines:\n" +
        posts.map((x) => `- ${x.hook}`).join("\n")
      : "";

    const stream = anthropic.messages.stream({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: system.replace(`Exactly ${BATCH_SIZE} objects.`, `Exactly ${askFor} objects.`),
      messages: [{ role: "user", content: evidence + avoid }],
    });
    const message = await stream.finalMessage();

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      console.error(`  batch ${batch + 1}: no text block returned, skipping.`);
      continue;
    }
    const jsonText = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: Post[];
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // A truncated batch loses only its own posts; the run carries on.
      console.error(
        `  batch ${batch + 1}: could not parse response as JSON (stop_reason=${message.stop_reason}), skipping. Starts: ${jsonText.slice(0, 120)}`
      );
      continue;
    }
    posts.push(...parsed);
    console.log(`  batch ${batch + 1}: ${parsed.length} post(s) (${posts.length}/${count})`);

    if (batch >= Math.ceil(count / BATCH_SIZE) + 2) {
      console.error("  too many failed batches, stopping early.");
      break;
    }
  }

  let saved = 0;
  for (const p of posts) {
    const { error: insErr } = await supabase.from("generated_drafts").insert({
      competitor_name: "Cross-competitor analysis",
      // Always AU. The column stays because older rows carry other values.
      market: "AU",
      source_post_id: null,
      source_caption: `Built on: ${p.built_on}`,
      hook: p.hook,
      script: p.script,
      caption: p.caption,
    });
    if (insErr) {
      console.error(`  FAILED to save: ${insErr.message}`);
      continue;
    }
    saved++;
    console.log(`  [${p.market}] ${p.hook.slice(0, 90)}`);
    console.log(`        built on: ${p.built_on.slice(0, 120)}`);
  }

  console.log(`\nSaved ${saved} analysis-derived post(s). They're on /drafts.`);

  // Channel versions are generated here rather than left as a step someone
  // has to remember. A draft with no LinkedIn or carousel version still has
  // to be rewritten by hand, which is the work this pipeline exists to
  // remove. Failure is reported, not thrown: the posts are already saved
  // and are useful without their variants.
  if (saved > 0) {
    console.log("\nExpanding into channel versions...");
    try {
      const { execSync } = await import("node:child_process");
      execSync("npm run generate-formats", {
        stdio: "inherit",
        cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      });
    } catch {
      console.error("Channel versions failed -- the posts are saved. Run `npm run generate-formats` to retry.");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
