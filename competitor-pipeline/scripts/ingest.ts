/**
 * Apify webhook handler. Accepts a run-finished payload, fetches the
 * dataset via the Apify API, detects which role produced it (profile /
 * posts / transcript), strips personal-identifier fields, and upserts
 * into the matching table.
 *
 * Data minimisation: comment-author handles/names and any other
 * per-commenter personal data are stripped from `raw` before insert, on
 * every row, regardless of role. This is enforced here in code because the
 * schema only enforces it by omission (no columns for that data exist) --
 * the raw jsonb blob from the actor could still contain it otherwise.
 *
 * A T1 account returning zero rows is flagged, not passed through
 * silently -- an empty result set from a T1 (close competitor, weekly
 * cadence) account almost always means a broken handle or a deprecated
 * actor, not a quiet week. That flag goes to stdout as a structured error
 * and to a file under logs/.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const LOG_DIR = new URL("../logs/", import.meta.url);

type Role = "profile" | "posts" | "transcript";

interface WebhookPayload {
  resource: {
    defaultDatasetId: string;
  };
  eventData?: {
    actorRunId?: string;
  };
}

// Fields that can carry per-commenter or other personal identifiers.
// Extend this list if a new actor's output surfaces new personal fields --
// do not assume an actor's schema is safe by default.
const PERSONAL_FIELD_KEYS = new Set([
  "commenterHandle",
  "commenterUsername",
  "commenterName",
  "commenterId",
  "authorFullName",
  "ownerFullName",
  "taggedUsers",
  "mentions",
  "comments", // if an actor nests full comment objects (author + text) inside raw, drop the whole array -- typed comment COUNT lives in competitor_posts.comments, not here
]);

function stripPersonalFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPersonalFields);
  }
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

function detectRole(item: Record<string, unknown>): Role {
  if ("transcript" in item || "captionText" in item) return "transcript";
  if ("followers" in item || "followersCount" in item) return "profile";
  return "posts";
}

// A repost during a posting gap gets algorithmic resurfacing to a wider
// audience than its original run, which can produce a high vpf that
// reflects distribution mechanics, not a hook landing today -- excluded
// from v_outliers the same way paid_partnership is (migration 011).
// There's no structured "is this a repost" field in the actor's output,
// so this is a caption-text heuristic (same patterns as migration 011's
// SQL backfill, kept in sync): it catches explicit self-disclosure
// ("revisiting", "repost", ...), not every repost -- a caption that
// doesn't mention it will read as false here.
const REPOST_SIGNAL_PATTERN = /revisit|repost|re-post|throwback|flashback|resharing|re-sharing|from the archive/i;

function detectRepost(caption: unknown): boolean {
  return typeof caption === "string" && REPOST_SIGNAL_PATTERN.test(caption);
}

function logFlag(message: string, context: Record<string, unknown>) {
  const entry = {
    level: "error",
    message,
    context,
    at: new Date().toISOString(),
  };
  console.error(JSON.stringify(entry));
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(
    new URL(`ingest-${new Date().toISOString().slice(0, 10)}.log`, LOG_DIR),
    JSON.stringify(entry) + "\n"
  );
}

async function fetchDataset(datasetId: string, apifyToken: string): Promise<Record<string, unknown>[]> {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch dataset ${datasetId}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

export async function ingestProfile(
  supabase: SupabaseClient,
  competitorId: string,
  item: Record<string, unknown>,
  runId: string
) {
  const raw = stripPersonalFields(item);
  // scraped_at is stamped server-side by trg_competitor_snapshots_scraped_at
  // (migration 003) -- any value sent from here would be overwritten, so it's
  // deliberately omitted rather than sent and ignored.
  const { error } = await supabase.from("competitor_snapshots").insert({
    competitor_id: competitorId,
    followers: item.followersCount ?? item.followers ?? null,
    following: item.followingCount ?? item.following ?? null,
    post_count: item.postsCount ?? item.postCount ?? null,
    bio: item.biography ?? item.bio ?? null,
    run_id: runId,
    raw,
  });
  if (error) throw new Error(`competitor_snapshots insert failed: ${error.message}`);

  await supabase
    .from("competitors")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("competitor_id", competitorId);
}

/**
 * followers_at_scrape is the vpf denominator, frozen at ingest time rather
 * than joined dynamically at query time (migration 003 -- the join used to
 * silently re-point old posts at newer snapshots on every re-scrape,
 * changing their historical vpf after the fact). It comes from the most
 * recent competitor_snapshots row for this competitor -- normally the one
 * ingestProfile just wrote moments earlier in the same run, since profile
 * is always ingested before posts. Callers that already have the profile
 * item in memory (e.g. smoke_test.ts) may pass followersAtScrapeOverride
 * to skip the extra round trip; handleWebhook's posts-only delivery path
 * relies on the DB lookup since it never sees the profile item.
 */
export async function ingestPost(
  supabase: SupabaseClient,
  competitorId: string,
  item: Record<string, unknown>,
  runId: string,
  followersAtScrapeOverride?: number | null
) {
  const raw = stripPersonalFields(item);
  const platformPostId = String(item.id ?? item.postId ?? item.shortcode ?? "");
  if (!platformPostId) {
    throw new Error("Post item missing a platform post id (id/postId/shortcode).");
  }

  let followersAtScrape = followersAtScrapeOverride;
  if (followersAtScrape === undefined) {
    const { data: latestSnapshot, error: snapshotError } = await supabase
      .from("competitor_snapshots")
      .select("followers")
      .eq("competitor_id", competitorId)
      .order("scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotError) {
      throw new Error(`Could not look up latest snapshot for followers_at_scrape: ${snapshotError.message}`);
    }
    followersAtScrape = latestSnapshot?.followers ?? null;
  }

  // last_scraped_at is stamped server-side by
  // trg_competitor_posts_last_scraped_at (migration 003) regardless of what's
  // sent here -- omitted for the same reason as scraped_at above.
  const { error } = await supabase.from("competitor_posts").upsert(
    {
      competitor_id: competitorId,
      platform_post_id: platformPostId,
      post_url: item.url ?? item.postUrl ?? null,
      post_type: item.type ?? item.postType ?? null,
      caption: item.caption ?? item.text ?? null,
      posted_at: item.timestamp ?? item.postedAt ?? null,
      views: item.videoViewCount ?? item.viewCount ?? item.views ?? null,
      likes: item.likesCount ?? item.likeCount ?? item.likes ?? null,
      comments: item.commentsCount ?? item.commentCount ?? item.comments ?? null,
      shares: item.sharesCount ?? item.shareCount ?? item.shares ?? null,
      duration_seconds: item.videoDuration ?? item.durationSeconds ?? null,
      paid_partnership: item.paidPartnership ?? null,
      is_repost: detectRepost(item.caption ?? item.text),
      followers_at_scrape: followersAtScrape,
      run_id: runId,
      raw,
    },
    { onConflict: "competitor_id,platform_post_id" }
  );
  if (error) throw new Error(`competitor_posts upsert failed: ${error.message}`);
}

export async function ingestTranscript(
  supabase: SupabaseClient,
  postId: string,
  item: Record<string, unknown>
) {
  const raw = stripPersonalFields(item);
  const transcript = String(item.transcript ?? item.captionText ?? "");
  const openingLine = transcript.split(/[.!?\n]/)[0]?.trim() ?? null;

  const { error } = await supabase.from("competitor_transcripts").upsert(
    {
      post_id: postId,
      transcript,
      opening_line: openingLine,
      seconds_to_first_claim: item.secondsToFirstClaim ?? null,
      raw,
    },
    { onConflict: "post_id" }
  );
  if (error) throw new Error(`competitor_transcripts upsert failed: ${error.message}`);
}

/**
 * Entry point for a single webhook delivery. `competitorId` (and, for
 * transcript payloads, `postId`) must be supplied by whatever triggers
 * this -- e.g. encoded in the Apify run's webhook payload template as
 * custom data, since Apify itself has no notion of our competitor_id.
 */
export async function handleWebhook(
  payload: WebhookPayload,
  meta: { competitorId: string; competitorName: string; tier: string; postId?: string }
) {
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    throw new Error("APIFY_TOKEN must be set (see .env.example).");
  }
  const supabase = getSupabaseClient();

  const items = await fetchDataset(payload.resource.defaultDatasetId, apifyToken);
  const runId = crypto.randomUUID();

  if (items.length === 0) {
    if (meta.tier === "T1") {
      logFlag("T1 competitor returned zero rows -- likely broken handle or deprecated actor", {
        competitorId: meta.competitorId,
        competitorName: meta.competitorName,
        datasetId: payload.resource.defaultDatasetId,
      });
    } else {
      console.log(
        `${meta.competitorName} (${meta.tier}) returned zero rows -- not flagged (non-T1).`
      );
    }
    return;
  }

  for (const item of items) {
    const role = detectRole(item);
    try {
      if (role === "profile") {
        await ingestProfile(supabase, meta.competitorId, item, runId);
      } else if (role === "posts") {
        // No in-memory profile item on this delivery path (posts arrive in
        // their own webhook, separate from profile) -- ingestPost falls
        // back to looking up the latest snapshot itself.
        await ingestPost(supabase, meta.competitorId, item, runId);
      } else if (role === "transcript") {
        if (!meta.postId) {
          throw new Error("Transcript payload requires meta.postId.");
        }
        await ingestTranscript(supabase, meta.postId, item);
      }
    } catch (err) {
      logFlag(`Failed to ingest ${role} item`, {
        competitorId: meta.competitorId,
        competitorName: meta.competitorName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`Ingested ${items.length} ${detectRole(items[0])} item(s) for ${meta.competitorName}.`);
}
