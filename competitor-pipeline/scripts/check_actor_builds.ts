/**
 * Verifies every actor in apify/actors.json can actually start, before a run
 * spends anything.
 *
 * On 2026-09-26 the monthly discovery sweep reported SUCCESS while producing
 * nothing. The cause: Apify had deleted every one of the eight builds pinned
 * in apify/actors.json, so each run came back "403 Forbidden" -- really
 * "Build with number 0.0.597 was not found". The 20 September harvest had
 * worked, so the builds aged out somewhere in that week. It happened twice
 * more (4 Oct, 4 Nov), and on the third occasion this check reported a build
 * "ok" roughly an hour before the run endpoint answered 403 for it.
 *
 * So the pins are gone: every actor now rides the `latest` TAG, and output
 * drift is caught where it shows up -- in the response, on every call, by
 * scripts/lib/response_shape.ts. See apify/actors.json's verifiedVia note.
 *
 * What is left to check here is what a floating tag can still get wrong, and
 * it is not nothing: an actor can be renamed, unpublished or made private,
 * the token can lose access to it, and a tag can point at a build whose own
 * status is FAILED rather than SUCCEEDED. Each of those fails every run that
 * touches the actor, and each is visible for free before the run starts.
 *
 * Exits non-zero on any of them, so the workflow step goes red. This one
 * deliberately has no continue-on-error: there is no point running a harvest
 * whose actors cannot start.
 *
 * Usage: npm run check-actor-builds
 */

import "dotenv/config";
import { loadActors, type ActorPin } from "./lib/harvest.ts";

interface ActorMeta {
  name?: string;
  username?: string;
  taggedBuilds?: Record<string, { buildNumber?: string; buildId?: string }>;
}

async function main() {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be set.");

  const cfg = loadActors() as unknown as Record<string, ActorPin>;
  const problems: string[] = [];

  // One actor can appear under several keys (tiktok-scraper is both the
  // search and the posts entry), so it is only fetched once.
  const metaCache = new Map<string, ActorMeta | null>();
  const fetchMeta = async (actorId: string): Promise<ActorMeta | null> => {
    if (metaCache.has(actorId)) return metaCache.get(actorId) ?? null;
    let meta: ActorMeta | null = null;
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${actorId.replace("/", "~")}?token=${token}`);
      if (res.ok) {
        meta = ((await res.json()) as { data?: ActorMeta }).data ?? null;
      } else {
        // 404 here is the finding: the actor is gone, renamed, or this token
        // cannot see it. That is a hard stop, not a transient blip.
        problems.push(`${actorId}: actor lookup returned ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      problems.push(`${actorId}: could not reach Apify -- ${err instanceof Error ? err.message : String(err)}`);
    }
    metaCache.set(actorId, meta);
    return meta;
  };

  // A tag can point at a build that failed to compile. The run endpoint then
  // answers 400 rather than 403, which reads as a bad input rather than a bad
  // actor and sends whoever is debugging it in the wrong direction.
  const buildStatus = async (buildId: string): Promise<string | null> => {
    try {
      const res = await fetch(`https://api.apify.com/v2/actor-builds/${buildId}?token=${token}`);
      if (!res.ok) return null;
      return ((await res.json()) as { data?: { status?: string } }).data?.status ?? null;
    } catch {
      return null;
    }
  };

  for (const [key, pin] of Object.entries(cfg)) {
    const meta = await fetchMeta(pin.actorId);
    if (!meta) {
      console.error(`  FAIL    ${key.padEnd(20)} ${pin.actorId}: not reachable (see above)`);
      continue;
    }

    const tagged = meta.taggedBuilds ?? {};
    const tag = tagged[pin.build];

    if (!tag) {
      // Either the entry names a tag this actor does not publish, or it still
      // carries an exact build number. Both land here; the message says which.
      const known = Object.keys(tagged).join(", ") || "none";
      const looksLikeNumber = /^\d+\.\d+\.\d+$/.test(pin.build);
      const why = looksLikeNumber
        ? `build "${pin.build}" is an exact number, not a tag. Exact pins expire on Apify's rolling retention window -- use "latest" and let scripts/lib/response_shape.ts catch drift`
        : `no build tagged "${pin.build}" (this actor publishes: ${known})`;
      console.error(`  FAIL    ${key.padEnd(20)} ${pin.actorId}: ${why}`);
      problems.push(`${key}: ${why}`);
      continue;
    }

    const status = tag.buildId ? await buildStatus(tag.buildId) : null;
    if (status && status !== "SUCCEEDED") {
      const why = `the "${pin.build}" tag points at build ${tag.buildNumber ?? tag.buildId} whose status is ${status}, not SUCCEEDED`;
      console.error(`  FAIL    ${key.padEnd(20)} ${pin.actorId}: ${why}`);
      problems.push(`${key}: ${why}`);
      continue;
    }

    console.log(
      `  ok      ${key.padEnd(20)} ${pin.actorId}:${pin.build} -> ${tag.buildNumber ?? "?"}` +
        (status ? ` (${status})` : "")
    );
  }

  if (problems.length > 0) {
    console.error(
      `\n${problems.length} actor(s) cannot start. Every run that touches them fails:\n` +
        problems.map((m) => `  ${m}`).join("\n")
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${Object.keys(cfg).length} actor(s) resolvable and built.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
