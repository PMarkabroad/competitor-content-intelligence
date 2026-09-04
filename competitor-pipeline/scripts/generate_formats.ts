/**
 * Turns each ready-made post into per-channel versions.
 *
 * generated_drafts holds one script and one caption, which is a reel and
 * nothing else. Publishing the same idea as a LinkedIn post, a carousel, a
 * story or a tweet meant rewriting it by hand every time -- exactly the work
 * this pipeline exists to remove.
 *
 * The character limits below are each platform's HARD CEILING, not a target.
 * Facebook's 63,206 is a technical maximum nobody should ever write to, so
 * every format also carries a `target` -- the length that actually reads
 * well there -- and the model is aimed at that. char_limit only exists to
 * catch a violation; the DB rejects an over-limit row outright.
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

const VOICE_DOC_PATH = new URL("../reference/arkabroad-voice.md", import.meta.url);
const BUSINESS_DEF_PATH = new URL("../reference/business-definition.md", import.meta.url);

interface FormatSpec {
  platform: "instagram" | "linkedin" | "facebook" | "twitter";
  format: string;
  label: string;
  charLimit: number | null;
  target: string;
  brief: string;
}

const FORMATS: FormatSpec[] = [
  {
    platform: "instagram",
    format: "single_image",
    label: "Instagram single image",
    charLimit: 2200,
    target: "300-700 characters",
    brief:
      "Caption for one static image. Only the first ~125 characters show before the More link, so the hook must land inside them. Line breaks between beats.",
  },
  {
    platform: "instagram",
    format: "carousel",
    label: "Instagram carousel",
    charLimit: 2200,
    target: "600-1200 characters",
    brief:
      "Write the slides, then the caption. Format as SLIDE 1: through SLIDE 6: (5-8 slides), each slide one idea in under 15 words, then a blank line and CAPTION: with the supporting text. Slide 1 is the hook; the last slide is the ask.",
  },
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
    format: "story",
    label: "Instagram story",
    charLimit: null,
    target: "3-5 frames, under 20 words each",
    brief:
      "Format as FRAME 1: and so on. Text on screen, not narration. One idea per frame, last frame a poll, question sticker or link prompt. No fixed platform limit, but the text has to fit on a phone screen over an image.",
  },
  {
    platform: "linkedin",
    format: "post",
    label: "LinkedIn post",
    charLimit: 3000,
    target: "1200-2000 characters",
    brief:
      "Long-form is rewarded here. Only the first ~200 characters show before the see-more fold. Professional register -- same substance, none of the Instagram punctuation or emoji. Short paragraphs, plenty of white space, a real point of view, and a closing question a peer could disagree with.",
  },
  {
    platform: "linkedin",
    format: "carousel_pdf",
    label: "LinkedIn carousel (PDF)",
    charLimit: 3000,
    target: "8-10 slides plus 600-1200 characters of post text",
    brief:
      "Format as SLIDE 1: through the last slide, then a blank line and POST TEXT:. Slides carry a headline and one supporting line each. The character limit applies to the POST TEXT accompanying the document.",
  },
  {
    platform: "facebook",
    format: "facebook_post",
    label: "Facebook post",
    charLimit: 63206,
    target: "400-900 characters",
    brief:
      "The 63,206 limit is technical -- never write anywhere near it. Facebook's audience skews older and reads more narrative, so lead with the story beat rather than the framework. Plain paragraphs, no hashtag stacks.",
  },
  {
    platform: "facebook",
    format: "facebook_carousel",
    label: "Facebook carousel",
    charLimit: 63206,
    target: "3-5 cards plus 300-600 characters of caption",
    brief:
      "Format as CARD 1: headline | description per card (headline under 40 characters, description under 20 words), then a blank line and CAPTION:. Cards are read fast in-feed.",
  },
  {
    platform: "twitter",
    format: "tweet",
    label: "X / Twitter",
    charLimit: 270,
    target: "under 270 characters INCLUDING hashtags",
    brief:
      "One tweet. The hardest constraint here -- cut to the single sharpest claim. Include 1-2 relevant hashtags and count them inside the 270. No thread, no thread tease.",
  },
];

interface Variant {
  format: string;
  body: string;
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
  const limitArg = arg("limit");
  const limit = limitArg ? Number(limitArg) : null;
  const regenerate = process.argv.includes("--regenerate");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set.");

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

  const { data: existing } = await supabase.from("draft_formats").select("draft_id");
  const haveFormats = new Set((existing ?? []).map((r) => r.draft_id));

  const todo = (drafts ?? []).filter((d) => regenerate || !haveFormats.has(d.draft_id));
  const batch = limit ? todo.slice(0, limit) : todo;

  if (batch.length === 0) {
    console.log("Every live draft already has channel versions. Nothing to do.");
    return;
  }
  console.log(`${batch.length} draft(s) to expand into ${FORMATS.length} channel version(s) each.\n`);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });

  const system = `You adapt one Ark Abroad post into versions for different social channels, in the founder's voice.

${voiceDoc}

---

${businessDef}

---

You are given ONE post that has already been written and approved: its hook, its script and its caption. The angle is decided. Your job is NOT to invent a new idea -- it is to express THIS idea properly on each channel.

Rules:
- Every version says the same thing. Same claim, same mechanism, same proof. Only the shape and the register change.
- Never invent a fact that is not in the source post. No new numbers, no new employers, no new prices, no new job postings -- not even as illustration.
- Write for a reader IN AUSTRALIA who already holds Australian work rights.
- Match each channel's register. A LinkedIn post is not an Instagram caption with the emoji stripped out; it is written for a peer who might argue back.
- Respect the target length given for each format. The character LIMIT is a hard ceiling you must never exceed; the TARGET is what you actually aim for.
- Where a format asks for SLIDE, FRAME or CARD structure, follow that structure exactly.

Output ONLY a JSON array, no markdown fences, no preamble:
[{"format": "<the format key>", "body": "<the full text for that channel>"}]
One object per format, using these exact format keys: ${FORMATS.map((f) => f.format).join(", ")}.`;

  const specSheet = FORMATS.map(
    (f) => `${f.format} -- ${f.label}\n  hard limit: ${f.charLimit ?? "none"}\n  target: ${f.target}\n  ${f.brief}`
  ).join("\n\n");

  let written = 0;
  let failed = 0;

  for (const [i, d] of batch.entries()) {
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
      const spec = FORMATS.find((f) => f.format === v.format);
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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
