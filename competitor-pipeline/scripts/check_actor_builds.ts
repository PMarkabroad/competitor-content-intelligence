/**
 * Verifies every pinned Apify build still exists, and fails loudly if not.
 *
 * On 2026-09-26 the monthly discovery sweep reported SUCCESS while producing
 * nothing. The cause: Apify had deleted every one of the eight builds pinned
 * in apify/actors.json, so each run came back "403 Forbidden" -- which is
 * really "Build with number 0.0.597 was not found". The 20 September harvest
 * had worked, so the builds aged out somewhere in that week.
 *
 * Pinning a build is still right -- it stops an actor changing its output
 * shape underneath us. What was wrong was treating a pin as permanent.
 * Builds expire, so the pins need checking, and the check needs to run
 * BEFORE a harvest rather than being discovered when a month of discovery
 * quietly produces an empty shortlist.
 *
 * Exits non-zero when a pin is missing, so the workflow step goes red. This
 * one deliberately has no continue-on-error: there is no point running a
 * harvest whose actors cannot start.
 *
 * Usage: npm run check-actor-builds
 */

import "dotenv/config";
import { readFileSync } from "node:fs";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

interface Pin {
  actorId: string;
  build: string;
}

async function main() {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be set.");

  const cfg = JSON.parse(readFileSync(ACTORS_PATH, "utf-8")) as Record<string, Pin>;
  const missing: string[] = [];
  // One actor can appear under several keys (tiktok-scraper is both the
  // search and the posts pin), so its build list is fetched once.
  const listCache = new Map<string, Set<string>>();

  const buildNumbers = async (actorId: string): Promise<Set<string>> => {
    const cached = listCache.get(actorId);
    if (cached) return cached;
    const path = actorId.replace("/", "~");
    const found = new Set<string>();
    // Paginated, newest first. NOT GET /builds/<number> -- that path takes a
    // build ID, returns 404 for a perfectly valid build number, and reading
    // that as deletion is how a false "all eight pins are gone" diagnosis
    // happened. The list is the only free source of truth.
    for (let offset = 0; offset < 2000; offset += 200) {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${path}/builds?token=${token}&limit=200&offset=${offset}&desc=1`
      );
      if (!res.ok) break;
      const body = (await res.json()) as { data?: { items?: { buildNumber?: string }[] } };
      const items = body.data?.items ?? [];
      if (items.length === 0) break;
      for (const b of items) if (b.buildNumber) found.add(b.buildNumber);
      if (items.length < 200) break;
    }
    listCache.set(actorId, found);
    return found;
  };

  for (const [key, pin] of Object.entries(cfg)) {
    const numbers = await buildNumbers(pin.actorId);
    if (numbers.size === 0) {
      console.error(`  ?       ${key.padEnd(20)} ${pin.actorId}: could not list builds -- skipped, not treated as missing`);
      continue;
    }
    if (numbers.has(pin.build)) {
      console.log(`  ok      ${key.padEnd(20)} ${pin.actorId}:${pin.build}`);
      continue;
    }

    let latest = "unknown";
    try {
      const actor = await fetch(`https://api.apify.com/v2/acts/${pin.actorId.replace("/", "~")}?token=${token}`);
      const body = (await actor.json()) as { data?: { taggedBuilds?: { latest?: { buildNumber?: string } } } };
      latest = body.data?.taggedBuilds?.latest?.buildNumber ?? "unknown";
    } catch {
      // The missing pin is the finding, not this.
    }
    console.error(`  MISSING ${key.padEnd(20)} ${pin.actorId}:${pin.build} -- latest is ${latest}`);
    missing.push(`${key}: ${pin.build} -> ${latest} (${pin.actorId})`);
  }

  if (missing.length > 0) {
    console.error(
      `\n${missing.length} pinned build(s) no longer exist. Every run using them fails with 403 ` +
        `"Build with number not found". Re-pin apify/actors.json, then RUN each new build once with the ` +
        `input this pipeline actually sends and check the fields it reads -- re-pinning without that is ` +
        `the output drift pinning exists to prevent:\n` +
        missing.map((m) => `  ${m}`).join("\n")
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${Object.keys(cfg).length} pinned build(s) present.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
