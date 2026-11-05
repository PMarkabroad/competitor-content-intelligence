/**
 * Renders each ready-made post into its publishable Instagram format.
 *
 * generated_drafts holds one script and one caption. This turns that into
 * either a reel caption or a carousel -- one format per draft, alternating,
 * so a run of 50 drafts produces 25 of each.
 *
 * It used to produce ten versions of every draft across Instagram, LinkedIn,
 * Facebook and X. Ark publishes on Instagram; the rest were generated,
 * stored, shown on a page and never used. Narrowing to what ships is not
 * less output -- the same budget now buys more Instagram posts instead of
 * the same idea restated for channels Ark is not on.
 *
 * The character limit is Instagram's HARD CEILING, not a target, so each
 * format also carries a `target` -- the length that actually reads well --
 * and the model is aimed at that. char_limit only exists to catch a
 * violation; the DB rejects an over-limit row outright.
 *
 * Model is claude-sonnet-5, not opus: this is re-expressing an angle that
 * has already been decided, not deciding it. generate_from_analysis does the
 * strategy on opus and hands the result here.
 *
 * Usage: npm run generate-formats -- [--limit=N] [--regenerate]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { recordStage, canRunStage } from "./lib/stage_check.ts";
import { assertApiCredit } from "./lib/api_credit.ts";

const VOICE_DOC_PATH = new URL("../reference/arkabroad-voice.md", import.meta.url);
const BUSINESS_DEF_PATH = new URL("../reference/business-definition.md", import.meta.url);

interface FormatSpec {
  platform: "instagram";
  format: "reel" | "carousel";
  label: string;
  charLimit: number | null;
  target: string;
  brief: string;
}

/**
 * The only two formats ready-made posts are produced in.
 *
 * There used to be ten, across Instagram, LinkedIn, Facebook and X. Every
 * draft cost a model call for each of them, and the output for the three
 * other platforms was stored, shown on a page, and not used -- Ark publishes
 * on Instagram. Narrowing to what ships is not a reduction in output: the
 * same budget now buys MORE Instagram posts rather than the same idea
 * restated for channels Ark is not on.
 *
 * single_image, story and carousel_story went with them. The first two were
 * never really posts. carousel_story was a real format and half the carousel
 * mix, but a story carousel and a framework carousel built from one idea
 * were the one place this generator reliably produced two pieces that read
 * as the same post twice.
 *
 * migrations/023_instagram_only_formats.sql holds the CHECK constraints that
 * stop any of this returning by accident -- a stale prompt or a hand-written
 * insert now fails at the database rather than quietly repopulating a
 * channel Ark does not publish on.
 */
const FORMATS: FormatSpec[] = [
  {
    platform: "instagram",
    format: "reel",
    label: "Instagram reel caption",
    charLimit: 2200,
    target: "150-400 characters",
    brief:
      "Caption only -- the script already exists and is spoken, so do not repeat it. The caption adds the one thing the video could not say, then asks for the comment.",
  },
  {
    platform: "instagram",
    format: "carousel",
    label: "Instagram carousel",
    charLimit: 2200,
    target: "600-1200 characters",
    brief:
      "FRAMEWORK carousel. Write the slides, then the caption. Format as SLIDE 1: through SLIDE 6: (5-8 slides), each slide one idea in under 15 words, then a blank line and CAPTION: with the supporting text. Slide 1 is the hook; the last slide is the ask. Numbered, structural, one step or one rule per slide.",
  },
];

interface Variant {
  format: string;
  body: string;
}

/**
 * Which single format this draft becomes.
 *
 * One format per draft, alternating, so a run of 50 drafts produces 25 reels
 * and 25 carousels. The unit of output is now a POST, not a draft expanded
 * into a set of channel versions -- 50 posts means 50 distinct ideas, each
 * rendered once, rather than 25 ideas rendered twice.
 *
 * Keyed on the draft's position in the whole live set rather than in this
 * batch, so re-running on a few stragglers does not restart the alternation
 * and hand every one of them the same format.
 */
function formatsFor(index: number): FormatSpec[] {
  return [FORMATS[index % FORMATS.length]];
}

function arg(name: string): string | null {
  const f = process.argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : null;
}

/**
 * Parses the model's reply, repairing the one way it reliably breaks.
 *
 * Several formats here ask for multi-line bodies -- SLIDE 1: ... SLIDE 2:,
 * FRAME 1: ... -- and the model writes those line breaks as REAL newlines
 * inside the JSON string rather than as \n. That is invalid JSON, and it
 * cost 3 of the first 4 failures on a 68-draft run: a whole draft's nine
 * versions thrown away over a line break.
 *
 * Asking the prompt more firmly for escaped newlines does not fix it --
 * the model is producing exactly the text that was asked for and only the
 * transport is wrong -- so the newlines are escaped here instead. Only
 * control characters INSIDE a string literal are touched; the JSON's own
 * formatting between tokens is left alone.
 */
function parseVariants(raw: string): Variant[] {
  try {
    return JSON.parse(raw) as Variant[];
  } catch {
    let out = "";
    let inString = false;
    let escaped = false;
    for (const ch of raw) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        out += ch;
        continue;
      }
      if (inString && ch === "\n") out += "\\n";
      else if (inString && ch === "\r") out += "\\r";
      else if (inString && ch === "\t") out += "\\t";
      else out += ch;
    }
    return JSON.parse(out) as Variant[];
  }
}

async function main() {
  // Nothing to expand if the drafts were never written.
  if (!canRunStage("channel_formats")) return;

  const limitArg = arg("limit");
  const limit = limitArg ? Number(limitArg) : null;
  const regenerate = process.argv.includes("--regenerate");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set.");
  // Before any draft is rendered. This step chains straight off draft
  // generation, so without its own check it would fail once per draft.
  await assertApiCredit(apiKey, "format rendering");

  const supabase = getSupabaseClient();
  const voiceDoc = readFileSync(VOICE_DOC_PATH, "utf-8");
  const businessDef = readFileSync(BUSINESS_DEF_PATH, "utf-8");

  // Dismissed drafts are skipped: they failed the relevance audit, so
  // producing nine channel versions of one is nine times the wasted work.
  const { data: drafts, error } = await supabase
    .from("generated_drafts")
    .select("draft_id, hook, script, caption, market")
    .neq("status", "dismissed")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to read drafts: ${error.message}`);

  // Every (draft, format) pair that already exists, so a draft is only asked
  // for what it is missing. An early backfill regenerated four existing
  // pieces per draft to add one new carousel -- 80% wasted work, and an hour
  // instead of twelve minutes.
  const { data: existing } = await supabase.from("draft_formats").select("draft_id, format");
  const have = new Map<string, Set<string>>();
  for (const r of existing ?? []) {
    if (!have.has(r.draft_id)) have.set(r.draft_id, new Set());
    have.get(r.draft_id)!.add(r.format);
  }
  // A draft is done once it has ANY format row. It used to be keyed on
  // carousel_story specifically, as the newest format, so that drafts
  // written under an older mix would be topped up -- carousel_story no
  // longer exists, and with one format per draft "has a row" is exactly the
  // right question again.
  const haveFormats = new Set([...have.entries()].filter(([, f]) => f.size > 0).map(([id]) => id));

  const todo = (drafts ?? []).filter((d) => regenerate || !haveFormats.has(d.draft_id));
  const batch = limit ? todo.slice(0, limit) : todo;

  if (batch.length === 0) {
    console.log("Every live draft already has channel versions. Nothing to do.");
    // Recorded even though there was nothing to do. A stage that runs and
    // records NOTHING is indistinguishable in the summary from one that died
    // before reaching its check -- which is the exact ambiguity this ledger
    // exists to remove. 0 of 0 is a real, healthy outcome and says so.
    recordStage({ stage: "channel_formats", expected: 0, actual: 0, detail: "every live draft already expanded" });
    return;
  }
  console.log(`${batch.length} draft(s) to render -- one format each, alternating reel and carousel.` + String.fromCharCode(10));

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });

  const system = `You adapt one Ark Abroad post into versions for different social channels, in the founder's voice.

${voiceDoc}

---

${businessDef}

---

You are given ONE post that has already been written and approved: its hook, its script and its caption. The angle is decided. Your job is NOT to invent a new idea -- it is to render THIS idea properly in the format asked for.

Rules:
- The version says the same thing as the source. Same claim, same mechanism, same proof. Only the shape changes.
- Never invent a fact that is not in the source post. No new numbers, no new employers, no new prices, no new job postings -- not even as illustration.
- Write for a reader IN AUSTRALIA who already holds Australian work rights.
- Instagram register throughout. This is the only channel Ark publishes on.
- Respect the target length. The character LIMIT is a hard ceiling you must never exceed; the TARGET is what you actually aim for.
- Where the format asks for SLIDE structure, follow that structure exactly.

Output ONLY a JSON array, no markdown fences, no preamble:
[{"format": "<the format key>", "body": "<the full text>"}]
One object, using exactly the format key listed under CHANNELS TO WRITE -- no others.`;

  let written = 0;
  let failed = 0;

  for (const [i, d] of batch.entries()) {
    // Rotation is keyed on the draft's position in the whole live set, not
    // in this batch, so re-running on a few stragglers does not restart the
    // cycle and hand every one of them the same three formats.
    const position = (drafts ?? []).findIndex((x) => x.draft_id === d.draft_id);
    const already = have.get(d.draft_id) ?? new Set<string>();
    const draftFormats = formatsFor(position < 0 ? i : position).filter(
      (f) => regenerate || !already.has(f.format)
    );
    if (draftFormats.length === 0) {
      console.log(`  [${i + 1}/${batch.length}] nothing missing, skipped.`);
      continue;
    }
    const specSheet = draftFormats
      .map((f) => `${f.format} -- ${f.label}` + String.fromCharCode(10) + `  hard limit: ${f.charLimit ?? "none"}` + String.fromCharCode(10) + `  target: ${f.target}` + String.fromCharCode(10) + `  ${f.brief}`)
      .join(String.fromCharCode(10, 10));

    const user = `SOURCE POST (market ${d.market})

HOOK: ${d.hook}

SCRIPT: ${d.script}

CAPTION: ${d.caption}

---

CHANNELS TO WRITE:

${specSheet}`;

    let variants: Variant[];
    try {
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-5",
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "max_tokens") throw new Error("truncated at max_tokens");
      const block = msg.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no text block returned");
      const raw = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      variants = parseVariants(raw);
    } catch (e) {
      console.error(`  [${i + 1}/${batch.length}] FAILED: ${(e as Error).message}`);
      failed++;
      continue;
    }

    const rows = [];
    const overLimit: string[] = [];
    for (const v of variants) {
      const spec = draftFormats.find((f) => f.format === v.format);
      if (!spec || !v.body?.trim()) continue;
      const body = v.body.trim();
      // Refused here as well as by the DB constraint, so an over-limit body
      // is reported against its own format rather than surfacing as an
      // opaque constraint violation that loses the whole draft.
      if (spec.charLimit != null && body.length > spec.charLimit) {
        overLimit.push(`${v.format} ${body.length}>${spec.charLimit}`);
        continue;
      }
      rows.push({
        draft_id: d.draft_id,
        platform: spec.platform,
        format: spec.format,
        body,
        char_limit: spec.charLimit,
        char_count: body.length,
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length === 0) {
      console.error(`  [${i + 1}/${batch.length}] nothing usable returned.`);
      failed++;
      continue;
    }

    const { error: upErr } = await supabase
      .from("draft_formats")
      .upsert(rows, { onConflict: "draft_id,platform,format" });
    if (upErr) {
      console.error(`  [${i + 1}/${batch.length}] save failed: ${upErr.message}`);
      failed++;
      continue;
    }

    written += rows.length;
    const flag = overLimit.length > 0 ? `  (dropped over-limit: ${overLimit.join(", ")})` : "";
    console.log(`  [${i + 1}/${batch.length}] ${rows.length} version(s): ${String(d.hook).slice(0, 58)}${flag}`);
  }

  console.log(`\n${written} channel version(s) written across ${batch.length - failed} draft(s). ${failed} failed.`);

  // Measured in DRAFTS, not channel rows: nine versions of one draft is one
  // unit of work here, and counting rows would let a single draft expanding
  // nine ways mask eight drafts that got nothing.
  recordStage({
    stage: "channel_formats",
    expected: batch.length,
    actual: batch.length - failed,
    detail: `${written} channel version(s)`,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
