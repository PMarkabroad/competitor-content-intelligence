/**
 * Asserts an Apify actor still returns the fields this pipeline reads.
 *
 * This is the safety that makes pinning `latest` acceptable. An exact build
 * pin froze a version but told us nothing about whether its output still
 * fitted; worse, Apify deletes old builds on a short rolling window, so the
 * pin produced three outages in six weeks (26 Sep, 4 Oct, 4 Nov) -- once
 * reporting a build healthy about an hour before the run endpoint answered
 * 403 for it. The pin was buying a guarantee it could not keep.
 *
 * A shape assertion checks the thing actually depended on, on every call,
 * for free. If an actor renames `videoViewCount`, this fails loudly naming
 * that field instead of silently ingesting nulls and quietly making every
 * vpf and every outlier score wrong.
 *
 * Deliberately checks only the fields READ by the pipeline, not the whole
 * response. An actor adding fields is fine; an actor losing one we parse is
 * not. Over-specifying would turn every harmless upstream addition into a
 * failed Sunday.
 */

/**
 * Required fields per actor key in apify/actors.json. At least one field
 * from each group must be present -- the Instagram post actor has always
 * returned view count under either videoViewCount OR videoPlayCount
 * depending on post type, and ingest.ts reads both.
 */
const REQUIRED: Record<string, string[][]> = {
  profile: [["username"], ["followersCount"]],
  posts: [["id", "shortCode"], ["caption"], ["timestamp"], ["videoViewCount", "videoPlayCount", "type"]],
  transcript: [["id", "shortCode"], ["transcript", "captionText"]],
  tiktokSearch: [["id"], ["authorMeta", "authorUsername"]],
  tiktokPosts: [["id"], ["authorMeta", "authorUsername"], ["playCount", "videoMeta"]],
  tiktokProfile: [["authorMeta"]],
  tiktokTranscript: [["videoMeta", "postURL", "text"]],
  instagramDiscovery: [["ownerUsername"], ["videoViewCount", "videoPlayCount", "type"]],
};

/**
 * An item that is only an error envelope, not real data. The Instagram post
 * actor returns `{error: "no_items"}` on an empty incremental pull, and
 * shape-checking that would fail every quiet week.
 */
function isEnvelope(item: Record<string, unknown>): boolean {
  if (item.error) return true;
  const keys = Object.keys(item);
  return keys.length <= 3 && keys.every((k) => ["url", "error", "errorDescription", "inputUrl"].includes(k));
}

export interface ShapeResult {
  ok: boolean;
  checked: boolean;
  missing: string[];
}

export function checkResponseShape(
  actorKey: string,
  items: Record<string, unknown>[]
): ShapeResult {
  const groups = REQUIRED[actorKey];
  // An unlisted actor is not an error -- it just has nothing declared yet.
  if (!groups) return { ok: true, checked: false, missing: [] };

  const real = items.find((i) => !isEnvelope(i));
  // Nothing real to inspect. An empty result is a legitimate outcome (no new
  // posts this week), and is caught by the stage's own row-count check, not
  // here -- conflating "returned nothing" with "returned the wrong shape"
  // would make a quiet week look like a broken actor.
  if (!real) return { ok: true, checked: false, missing: [] };

  // Non-null, not merely present. Build 0.0.655 of the Instagram post
  // actor returns videoViewCount as an explicit null while the real number
  // moved to videoPlayCount -- a key-presence check passed that happily and
  // 460 posts landed with no views at all. Presence is not data.
  const missing = groups
    .filter((group) => !group.some((field) => real[field] != null))
    .map((group) => group.join(" or "));

  return { ok: missing.length === 0, checked: true, missing };
}

/** Throws with a message naming the actor, the pin and the lost fields. */
export function assertResponseShape(
  actorKey: string,
  actorId: string,
  build: string,
  items: Record<string, unknown>[]
): void {
  const r = checkResponseShape(actorKey, items);
  if (r.ok) return;
  throw new Error(
    `Actor ${actorId} (build=${build}, key=${actorKey}) no longer returns field(s) this pipeline reads: ` +
      `${r.missing.join("; ")}. The actor's output changed. Do NOT work around this by ignoring the field -- ` +
      `every score derived from it would silently become wrong. Inspect one raw response, update the parser ` +
      `in ingest.ts/harvest.ts and the REQUIRED list in scripts/lib/response_shape.ts together.`
  );
}
