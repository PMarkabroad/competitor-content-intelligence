import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getMonthToDateApifySpend, MONTHLY_APIFY_SPEND_CAP_USD } from "@/lib/apifyUsage";
import { runTiktokTranscriptActor, buildTranscriptRow, TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD } from "@/lib/apifyTranscribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface OutlierRow {
  post_id: string;
  competitor_id: string;
  outlier_score: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "5");
  const apifyToken = searchParams.get("apifyToken") ?? undefined;
  return runTranscriptionBatch({ limit, apifyToken });
}

export async function POST(request: NextRequest) {
  let body: { limit?: number; apifyToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body -- expected JSON with apifyToken." }, { status: 400 });
  }
  return runTranscriptionBatch({ limit: body.limit, apifyToken: body.apifyToken });
}

async function runTranscriptionBatch({ limit: limitInput, apifyToken: tokenInput }: { limit?: number; apifyToken?: string }) {
  const apifyToken = tokenInput || process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: "No Apify token provided and APIFY_TOKEN is not configured on this deployment." }, { status: 400 });
  }

  let limit = 5;
  if (typeof limitInput === "number" && limitInput > 0) limit = Math.min(limitInput, 25);

  const supabase = getSupabaseServerClient();

  const { data: outliers, error } = await supabase
    .from("v_outliers")
    .select("post_id, competitor_id, outlier_score")
    .order("outlier_score", { ascending: false });
  if (error) return NextResponse.json({ error: `Failed to read v_outliers: ${error.message}` }, { status: 500 });

  const rows = ((outliers ?? []) as OutlierRow[]).slice(0, limit);
  if (rows.length === 0) {
    return NextResponse.json({ message: "No outliers pending transcription.", transcribed: 0, noCaptions: 0, failed: 0, skippedNonTiktok: 0 });
  }

  const competitorIds = Array.from(new Set(rows.map((r) => r.competitor_id)));
  const { data: competitors, error: cErr } = await supabase
    .from("competitors")
    .select("competitor_id, platform")
    .in("competitor_id", competitorIds);
  if (cErr) return NextResponse.json({ error: `Failed to read competitors: ${cErr.message}` }, { status: 500 });
  const platformById = new Map((competitors ?? []).map((c) => [c.competitor_id, c.platform]));

  const postIds = rows.map((r) => r.post_id);
  const { data: posts, error: pErr } = await supabase.from("competitor_posts").select("post_id, post_url").in("post_id", postIds);
  if (pErr) return NextResponse.json({ error: `Failed to read competitor_posts: ${pErr.message}` }, { status: 500 });
  const urlByPostId = new Map((posts ?? []).map((p) => [p.post_id, p.post_url]));

  const tiktokRows = rows.filter((r) => platformById.get(r.competitor_id) === "tiktok");
  const skippedNonTiktok = rows.length - tiktokRows.length;

  const targets = tiktokRows
    .map((r) => ({ postId: r.post_id, postUrl: urlByPostId.get(r.post_id) }))
    .filter((t): t is { postId: string; postUrl: string } => !!t.postUrl);

  if (targets.length === 0) {
    return NextResponse.json({ message: "No TikTok outliers with a post_url to transcribe.", transcribed: 0, noCaptions: 0, failed: 0, skippedNonTiktok });
  }

  // Same cap check as the CLI script -- real month-to-date spend, not just this run's estimate.
  const cap = MONTHLY_APIFY_SPEND_CAP_USD;
  const spentSoFar = await getMonthToDateApifySpend(apifyToken);
  const estimate = targets.length * TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD;
  if (cap != null && spentSoFar != null && spentSoFar + estimate > cap) {
    return NextResponse.json(
      { error: `Skipped: real spend $${spentSoFar.toFixed(4)} + estimated $${estimate.toFixed(4)} would exceed the $${cap} monthly cap.` },
      { status: 409 }
    );
  }

  let transcribed = 0;
  let noCaptions = 0;
  let failed = 0;
  const details: { postId: string; result: string }[] = [];

  for (const target of targets) {
    try {
      const item = await runTiktokTranscriptActor(target.postUrl, apifyToken);
      const row = item ? buildTranscriptRow(target.postId, item) : null;
      if (!row) {
        noCaptions++;
        details.push({ postId: target.postId, result: "no native captions" });
        continue;
      }
      const { error: upsertErr } = await supabase.from("competitor_transcripts").upsert(row, { onConflict: "post_id" });
      if (upsertErr) throw new Error(upsertErr.message);
      transcribed++;
      details.push({ postId: target.postId, result: "transcribed" });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      details.push({ postId: target.postId, result: `failed: ${message}` });
    }
  }

  return NextResponse.json({ transcribed, noCaptions, failed, skippedNonTiktok, spentBeforeUsd: spentSoFar, estimatedUsd: estimate, details });
}
