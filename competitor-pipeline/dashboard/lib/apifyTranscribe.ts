import "server-only";

// Ported from competitor-pipeline/scripts/lib/harvest.ts + ingest.ts.
// Kept self-contained and duplicated here (not imported) because this
// dashboard is deployed as its own isolated Vercel project -- only
// dashboard/ is uploaded, so ../../scripts/... doesn't exist in the
// deployed filesystem. See lib/apifyUsage.ts for the same pattern.

// Pinned 2026-08-26 -- see competitor-pipeline/apify/actors.json's
// tiktokTranscript entry for the verification note. DOWNLOAD_SUBTITLES
// mode reuses TikTok's own native captions (no real speech-to-text),
// charges a flat ~$0.003/video BRONZE "Video" event, no per-run minimum.
const ACTOR_ID = "clockworks/tiktok-transcript-extractor";
const ACTOR_BUILD = "0.0.68";
export const TIKTOK_TRANSCRIPT_COST_PER_VIDEO_USD = 0.003;

const PERSONAL_FIELD_KEYS = new Set([
  "commenterHandle",
  "commenterUsername",
  "commenterName",
  "commenterId",
  "authorFullName",
  "ownerFullName",
  "taggedUsers",
  "mentions",
  "comments",
]);

function stripPersonalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPersonalFields);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (PERSONAL_FIELD_KEYS.has(key)) continue;
      out[key] = stripPersonalFields(v);
    }
    return out;
  }
  return value;
}

export async function runTiktokTranscriptActor(
  postUrl: string,
  apifyToken: string
): Promise<Record<string, unknown> | null> {
  const pathActorId = ACTOR_ID.replace("/", "~");
  const url =
    `https://api.apify.com/v2/acts/${pathActorId}/run-sync-get-dataset-items` +
    `?token=${apifyToken}&build=${encodeURIComponent(ACTOR_BUILD)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postURLs: [postUrl], downloadSubtitlesOptions: "DOWNLOAD_SUBTITLES" }),
  });
  if (!res.ok) {
    throw new Error(`Apify actor ${ACTOR_ID}:${ACTOR_BUILD} failed: ${res.status} ${res.statusText}`);
  }
  const items = (await res.json()) as Record<string, unknown>[];
  return items[0] ?? null;
}

export interface TranscriptUpsertRow {
  post_id: string;
  transcript: string;
  opening_line: string | null;
  seconds_to_first_claim: unknown;
  raw: unknown;
}

export function buildTranscriptRow(postId: string, item: Record<string, unknown>): TranscriptUpsertRow | null {
  const transcript = String(item.transcript ?? item.captionText ?? "");
  if (!transcript) return null;
  return {
    post_id: postId,
    transcript,
    opening_line: transcript.split(/[.!?\n]/)[0]?.trim() ?? null,
    seconds_to_first_claim: item.secondsToFirstClaim ?? null,
    raw: stripPersonalFields(item),
  };
}
