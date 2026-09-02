/**
 * Drafts the STRUCTURED fields of hook_library from already-collected
 * transcripts, so the human tagging job becomes "review a draft and write
 * one sentence" instead of "watch 64 videos and fill ten fields each".
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it never writes `why_it_performed`.
 * That field is human-written by explicit standing rule -- the whole point
 * of it is a person's judgement about why a hook landed, and an inferred
 * one would be indistinguishable from a real one once it's in the table.
 * Every row this script writes therefore lands with why_it_performed NULL
 * and tagged_by = 'claude-code-draft', so a human can find them.
 *
 * `format` is usually left NULL on purpose too: talking_head vs
 * screen_walkthrough vs text_on_screen_broll is a VISUAL property, and a
 * transcript is audio-only. It's filled in only when the speech itself
 * gives it away ("as you can see on my screen"). Guessing it from topic
 * would put fabricated data into a column a human is meant to trust.
 *
 * `topic_slug` is constrained to a fixed 8-value list, two of which
 * (visa-time-pressure, visa-pr-blocker) are deliberately EXCLUDED from new
 * tagging -- see KNOWN_LIMITATIONS.md. Anything that doesn't fit one of the
 * six remaining slugs gets topic_slug NULL and its real subject in the free-
 * text `sub_topic` instead, rather than being forced into a bad slug.
 *
 * Model: claude-opus-5, NOT the claude-haiku-4-5 used by discover.ts
 * --classify. That stage is bulk four-bucket filtering; this one is
 * editorial judgement against a subtle brand-voice document, and its
 * output (brand_fit_note, transplant_note) is read directly by a human and
 * shapes content strategy. The volume is ~60 items, so the cost difference
 * is immaterial and quality is the only thing that matters here.
 *
 * Usage: npm run draft-hook-tags -- [--limit=N] [--dry-run]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const VOICE_DOC_PATH = new URL("../reference/arkabroad-voice.md", import.meta.url);

const HOOK_PATTERNS = [
  "contrarian_inversion", "cost_accounting", "empathy_pivot", "subdivision_teaching",
  "receipt", "direct_question", "cold_open_story", "curiosity", "warning", "list",
  "problem", "bold_statement",
] as const;

const FORMATS = [
  "talking_head", "screen_walkthrough", "text_on_screen_broll",
  "greenscreen_react", "carousel_as_reel", "pov",
] as const;

// The two visa-* slugs the schema still allows are intentionally omitted:
// they track an audience pain point, but Ark never gives migration advice,
// so new tagging must not reach for them. See KNOWN_LIMITATIONS.md.
const TOPIC_SLUGS = [
  "linkedin-networking", "interview-performance", "resume-not-working",
  "no-local-experience", "volume-no-results", "no-callbacks",
] as const;

const TRI_STATE = ["yes", "no", "with_changes"] as const;

const BATCH_SIZE = 4;

interface Candidate {
  post_id: string;
  competitor_id: string;
  competitor_name: string;
  market: string;
  caption: string | null;
  transcript: string;
  outlier_score: number | null;
  vpf: number | null;
  duration_seconds: number | null;
}

interface DraftTag {
  post_id: string;
  hook_pattern: string | null;
  format: string | null;
  topic_slug: string | null;
  sub_topic: string | null;
  content_angle: string | null;
  cta: string | null;
  narrative_structure: string | null;
  opening_line: string | null;
  au_transplant: string | null;
  transplant_note: string | null;
  brand_fit: string | null;
  brand_fit_note: string | null;
}

// Scraped text occasionally carries a lone UTF-16 surrogate (a mangled
// emoji). JSON.stringify emits it happily but the bytes aren't valid UTF-8
// and the Anthropic API rejects the entire request body, silently losing
// the whole batch. Same fix as discover.ts's classify stage.
const sanitize = (s: string) =>
  s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "").replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

function buildSystemPrompt(voiceDoc: string): string {
  return `You are tagging competitor short-form videos for Ark Abroad, a Melbourne talent accelerator helping internationally-trained professionals land corporate roles in Australia. You are given transcripts of competitors' HIGH-PERFORMING videos. Your job is to extract reusable structural intelligence from them.

Here is Ark Abroad's brand voice document. You must judge brand_fit strictly against it, especially its "Never ships" list:

<brand_voice_document>
${voiceDoc}
</brand_voice_document>

For each video, return these fields:

hook_pattern -- the rhetorical move of the OPENING, one of exactly:
${HOOK_PATTERNS.join(", ")}
Pick the dominant one. The first four map 1:1 to the voice doc's four core patterns; use them when they genuinely apply, not aspirationally.

format -- the VISUAL format, one of exactly: ${FORMATS.join(", ")}
CRITICAL: you are reading an audio transcript, so you usually CANNOT know this. Return null unless the speech itself proves it (e.g. "as you can see on my screen" => screen_walkthrough). Do NOT infer format from the topic. A wrong value here is worse than null.

topic_slug -- one of exactly: ${TOPIC_SLUGS.join(", ")}
Return null if the video doesn't clearly fit one of those six. Do not force a fit. Never invent a slug outside this list.

sub_topic -- free text, 2-6 words, the actual specific subject (e.g. "salary negotiation counteroffer", "ATS resume formatting"). Always fill this in, especially when topic_slug is null.

content_angle -- free text, one short phrase: the argumentative stance taken (e.g. "recruiters are not your advocate", "your degree taught the wrong tools").

cta -- free text: what the video actually asks the viewer to do. If there is no call to action, return null. Do not invent one.

narrative_structure -- free text, one short phrase describing the SHAPE of the video (e.g. "cold open incident -> reveal -> after-state", "myth -> mechanism -> proof", "numbered list of five").

opening_line -- the actual first spoken line, verbatim from the transcript, trimmed to one sentence.

au_transplant -- one of: ${TRI_STATE.join(", ")} -- could this video's STRUCTURE be rebuilt for an Australian internationally-trained-professional audience?
transplant_note -- free text: what specifically would carry over and what would need changing. Be concrete, cite details from the transcript. Flag any country-specific claims (US visa law, US salary bands) that would not survive the move.

brand_fit -- one of: ${TRI_STATE.join(", ")} -- would Ark Abroad actually publish something built on this?
brand_fit_note -- free text, and this is the most important field you write. Judge against the voice document above. Cite the specific rule or check you are applying. Say "no" whenever the content trips a "Never ships" item (advice to lie or misrepresent, revenge framing, ethnic generalisations, claims racism doesn't exist, naming individuals/employers as villains, unverified outcome numbers). Say "with_changes" when the structure is usable but the substance is generic-career-coach filler, has no real mechanism, has no numbers, or promotes a third-party paid program. Be specific and evidence-based, not vague.

Return ONLY a JSON array, no markdown fences, no preamble:
[{"post_id": "...", "hook_pattern": "...", "format": null, "topic_slug": null, "sub_topic": "...", "content_angle": "...", "cta": null, "narrative_structure": "...", "opening_line": "...", "au_transplant": "...", "transplant_note": "...", "brand_fit": "...", "brand_fit_note": "..."}]
One object per video, in the order given, with post_id copied exactly.`;
}

async function draftBatch(
  anthropic: { messages: { create: (args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[] }> } },
  voiceDoc: string,
  batch: Candidate[]
): Promise<DraftTag[]> {
  const userContent = batch
    .map(
      (c, i) =>
        `--- VIDEO ${i + 1} ---
post_id: ${c.post_id}
competitor: ${sanitize(c.competitor_name)} (${c.market})
performance: ${c.outlier_score?.toFixed(1) ?? "?"}x above this account's median
caption: ${sanitize((c.caption ?? "(none)").slice(0, 400))}
transcript: ${sanitize(c.transcript.slice(0, 6000))}`
    )
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: buildSystemPrompt(voiceDoc),
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock?.text) throw new Error("Draft response had no text block.");

  // Same defensive fence-stripping as discover.ts --classify: the prompt
  // says "no markdown fences" and models wrap the response anyway often
  // enough that trusting the instruction alone silently loses batches.
  const jsonText = textBlock.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(jsonText) as DraftTag[];
  } catch {
    throw new Error(`Failed to parse draft response as JSON: ${jsonText.slice(0, 400)}`);
  }
}

// Anything the model returns that isn't in the allowed set becomes null
// rather than failing the row -- a NULL is an honest "not tagged", a
// rejected insert loses the other nine good fields with it.
function coerce<T extends readonly string[]>(value: unknown, allowed: T): string | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : null;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
  const dryRun = process.argv.includes("--dry-run");

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY must be set.");

  const supabase = getSupabaseClient();
  const voiceDoc = readFileSync(VOICE_DOC_PATH, "utf-8");

  const { data: transcripts, error: tErr } = await supabase
    .from("competitor_transcripts")
    .select("post_id, transcript");
  if (tErr) throw new Error(`Failed to read transcripts: ${tErr.message}`);

  const { data: tagged, error: hErr } = await supabase.from("hook_library").select("post_id");
  if (hErr) throw new Error(`Failed to read hook_library: ${hErr.message}`);
  const taggedIds = new Set((tagged ?? []).map((h) => h.post_id));

  const pendingIds = (transcripts ?? [])
    .filter((t) => !taggedIds.has(t.post_id) && (t.transcript ?? "").trim().length > 0)
    .map((t) => t.post_id);

  if (pendingIds.length === 0) {
    console.log("Every transcript already has a hook_library row. Nothing to draft.");
    return;
  }

  const { data: posts, error: pErr } = await supabase
    .from("competitor_posts")
    .select("post_id, competitor_id, caption, duration_seconds")
    .in("post_id", pendingIds);
  if (pErr) throw new Error(`Failed to read posts: ${pErr.message}`);

  const { data: metrics } = await supabase
    .from("v_post_metrics")
    .select("post_id, vpf")
    .in("post_id", pendingIds);
  const vpfByPost = new Map((metrics ?? []).map((m) => [m.post_id, m.vpf as number | null]));

  // outlier_score is computed from its DEFINITION (post vpf / that account's
  // baseline median vpf) rather than read out of v_outliers. v_outliers
  // excludes posts that already have a transcript -- that's the whole point
  // of it, it answers "what should we spend transcription budget on next" --
  // so in the normal transcribe-then-tag order every post has already
  // dropped out of it by the time this runs, and reading the score from
  // there silently writes null. That happened to 64 of the first 66 rows.
  const { data: baselines } = await supabase
    .from("v_competitor_baseline")
    .select("competitor_id, baseline_median_vpf");
  const baseByComp = new Map(
    (baselines ?? []).map((b) => [b.competitor_id, b.baseline_median_vpf as number])
  );

  const competitorIds = Array.from(new Set((posts ?? []).map((p) => p.competitor_id)));
  const { data: competitors } = await supabase
    .from("competitors")
    .select("competitor_id, name, market")
    .in("competitor_id", competitorIds);
  const compById = new Map((competitors ?? []).map((c) => [c.competitor_id, c]));

  const transcriptByPost = new Map((transcripts ?? []).map((t) => [t.post_id, t.transcript as string]));

  let candidates: Candidate[] = (posts ?? []).map((p) => {
    const vpf = vpfByPost.get(p.post_id) ?? null;
    const median = baseByComp.get(p.competitor_id);
    // No baseline means no DEFINED relative score (too few scoreable posts,
    // or a non-scoreable tier -- T1 is excluded from scoring by design), so
    // it stays null rather than being invented.
    const outlierScore = vpf != null && median && median > 0 ? vpf / median : null;
    return {
      post_id: p.post_id,
      competitor_id: p.competitor_id,
      competitor_name: compById.get(p.competitor_id)?.name ?? "(unknown)",
      market: compById.get(p.competitor_id)?.market ?? "?",
      caption: p.caption,
      transcript: transcriptByPost.get(p.post_id) ?? "",
      outlier_score: outlierScore,
      vpf,
      duration_seconds: p.duration_seconds,
    };
  });

  candidates.sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0));
  if (limit) candidates = candidates.slice(0, limit);

  console.log(`Drafting hook tags for ${candidates.length} transcribed post(s) in batches of ${BATCH_SIZE}.`);
  console.log(`Anthropic API only -- no Apify spend. why_it_performed is left NULL for a human.${dryRun ? " (DRY RUN, nothing will be written)" : ""}\n`);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: anthropicApiKey }) as unknown as Parameters<typeof draftBatch>[0];

  let written = 0;
  let failedBatches = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const label = `[${i + 1}-${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}]`;
    try {
      const drafts = await draftBatch(anthropic, voiceDoc, batch);
      const byPostId = new Map(drafts.map((d) => [d.post_id, d]));

      for (const c of batch) {
        const d = byPostId.get(c.post_id);
        if (!d) {
          console.log(`  ${label} ${c.competitor_name}: no draft returned, skipped`);
          continue;
        }
        const row = {
          post_id: c.post_id,
          competitor_id: c.competitor_id,
          hook_pattern: coerce(d.hook_pattern, HOOK_PATTERNS),
          format: coerce(d.format, FORMATS),
          topic_slug: coerce(d.topic_slug, TOPIC_SLUGS),
          sub_topic: clean(d.sub_topic),
          content_angle: clean(d.content_angle),
          cta: clean(d.cta),
          narrative_structure: clean(d.narrative_structure),
          opening_line: clean(d.opening_line),
          au_transplant: coerce(d.au_transplant, TRI_STATE),
          transplant_note: clean(d.transplant_note),
          brand_fit: coerce(d.brand_fit, TRI_STATE),
          brand_fit_note: clean(d.brand_fit_note),
          outlier_score: c.outlier_score,
          vpf: c.vpf,
          duration_seconds: c.duration_seconds,
          why_it_performed: null, // human-written only, by standing rule
          tagged_by: "claude-code-draft",
        };

        if (dryRun) {
          console.log(`  ${label} ${c.competitor_name}: ${row.hook_pattern} / brand_fit=${row.brand_fit} / ${row.sub_topic}`);
          written++;
          continue;
        }

        const { error } = await supabase.from("hook_library").insert(row);
        if (error) {
          console.error(`  ${label} ${c.competitor_name}: INSERT FAILED -- ${error.message}`);
          continue;
        }
        written++;
        console.log(`  ${label} ${c.competitor_name}: ${row.hook_pattern} / brand_fit=${row.brand_fit} / ${row.sub_topic}`);
      }
    } catch (err) {
      failedBatches++;
      console.error(`  ${label} BATCH FAILED -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. ${written} row(s) ${dryRun ? "would be written" : "written"}, ${failedBatches} batch(es) failed.`);
  if (!dryRun && written > 0) {
    console.log(`All have why_it_performed = NULL and tagged_by = 'claude-code-draft' -- that's the human's half.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
