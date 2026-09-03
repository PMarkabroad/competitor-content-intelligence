import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ARK_VOICE_GUIDE } from "@/lib/voice-guide";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface DraftRequest {
  competitor_name: string;
  market: string;
  post_id?: string | null;
  hook_pattern?: string | null;
  format?: string | null;
  content_angle?: string | null;
  narrative_structure?: string | null;
  cta?: string | null;
  why_it_performed?: string | null;
  opening_line?: string | null;
  transcript?: string | null;
  caption?: string | null;
  views?: number | null;
  vpf?: number | null;
  outlier_score?: number | null;
}

const SYSTEM_PROMPT = `You are drafting social content for Ark Abroad, following the brand voice guide below exactly.

${ARK_VOICE_GUIDE}

---

You are given a high-performing post from a COMPETITOR account, as competitive intelligence -- not something Ark posted. Your job is NOT to copy or closely paraphrase their words. It is to identify the underlying mechanism (the hook pattern, structure, or angle that made it work) and build an ORIGINAL Ark Abroad piece around that same mechanism, using Ark's own story material, vocabulary, and rules from the guide above.

Follow "Never ships" strictly, with no exceptions.

On numbers: the guide above includes the full proof bank. Every figure you write must appear there verbatim. Do not extrapolate from it, round it up, combine figures into a new one, or invent a plausible-sounding statistic. If you want a number the proof bank doesn't have, write the sentence without a number instead. The voice demands cost accounting, but an unverifiable figure in a migration-adjacent business is a complaint, not a hook.

This applies to INVENTED EXAMPLES too, not just claims about Ark. Do not write a specific vacancy, employer, city, or salary as though it exists -- no "a mining company in Perth is hiring a data analyst for $95,000", no "two hundred people will apply", no invented job posting used to illustrate a point. A reader cannot tell an illustration from a real market claim, and neither can a complainant. Make the same point with the mechanism instead of a fabricated instance: describe what a job posting does, not a job posting you made up. Naming a real employer is separately banned by Never ships item 6.

On visas: never state or imply anything about visa outcomes, sponsorship eligibility, or migration pathways. Immigration assistance is a regulated activity in Australia and Ark Abroad is a career accelerator, not a migration agent. If the competitor's post makes visa or immigration claims, drop them entirely rather than adapting them -- do not carry over any specific legal claim.

On personal history: Green-tier story material only. Never use Amber-tier detail (health, family finances, relationships, mental health, rage-bait history), even if the competitor's post does something similar.

Output ONLY valid JSON, no markdown code fences, no commentary before or after, in exactly this shape:
{"hook": "the opening line, one or two sentences, following 'open cold'", "script": "the full reel voiceover or carousel script, ready to read or post, following the four-part core and sentence mechanics", "caption": "a short Instagram caption, following the Instagram caption register (none to one mild profanity)"}`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on this deployment." }, { status: 500 });
  }

  let body: DraftRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.competitor_name || !body.market || (!body.transcript && !body.caption)) {
    return NextResponse.json({ error: "Missing competitor name, market, or any source material (transcript/caption)." }, { status: 400 });
  }

  const sourceLines: string[] = [];
  sourceLines.push(`Competitor: ${body.competitor_name} (${body.market} market)`);
  if (body.outlier_score != null) sourceLines.push(`Outlier score: ${body.outlier_score.toFixed(1)}x baseline`);
  if (body.views != null) sourceLines.push(`Views: ${body.views}`);
  if (body.vpf != null) sourceLines.push(`Views per follower: ${body.vpf.toFixed(4)}`);
  if (body.hook_pattern) sourceLines.push(`Hook pattern: ${body.hook_pattern}`);
  if (body.format) sourceLines.push(`Format: ${body.format}`);
  if (body.content_angle) sourceLines.push(`Angle: ${body.content_angle}`);
  if (body.narrative_structure) sourceLines.push(`Structure: ${body.narrative_structure}`);
  if (body.cta) sourceLines.push(`CTA used: ${body.cta}`);
  if (body.why_it_performed) sourceLines.push(`Analyst note on why it performed: ${body.why_it_performed}`);
  if (body.opening_line) sourceLines.push(`Opening line: "${body.opening_line}"`);
  if (body.transcript) {
    sourceLines.push("");
    sourceLines.push("Full transcript:");
    sourceLines.push(body.transcript);
  } else if (body.caption) {
    sourceLines.push("");
    sourceLines.push(`Caption only (post not yet transcribed): "${body.caption}"`);
  }

  const userPrompt = `Competitor post to analyze and adapt for Ark Abroad:\n\n${sourceLines.join("\n")}`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No text returned from the model." }, { status: 502 });
    }

    // The system prompt says "no markdown code fences" and the model wraps
    // the response in ```json anyway often enough to fail real runs -- two
    // of 30 in the first pre-generation batch. discover.ts's classify stage
    // hit the identical failure and strips defensively rather than trusting
    // the instruction; same fix here.
    const jsonText = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: { hook: string; script: string; caption: string };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return NextResponse.json({ error: "Model did not return valid JSON.", raw: jsonText.slice(0, 500) }, { status: 502 });
    }

    // Persist so the draft survives a page refresh / is visible on the Ready-made posts page.
    // A save failure shouldn't block returning the draft to the person waiting on it.
    try {
      const supabase = getSupabaseServerClient();
      await supabase.from("generated_drafts").insert({
        competitor_name: body.competitor_name,
        market: body.market,
        source_post_id: body.post_id ?? null,
        source_caption: body.caption ?? null,
        source_views: body.views ?? null,
        source_vpf: body.vpf ?? null,
        source_outlier_score: body.outlier_score ?? null,
        hook: parsed.hook,
        script: parsed.script,
        caption: parsed.caption,
      });
    } catch (saveErr) {
      console.error("Failed to persist generated draft:", saveErr);
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Generation failed: ${message}` }, { status: 502 });
  }
}
