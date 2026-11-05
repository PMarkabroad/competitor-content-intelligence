/**
 * Adds competitors from a handle list, verifying each one against Instagram
 * before inserting.
 *
 * Replaces the one-shot seed_competitors.ts, which hardcoded the 2026-11-04
 * roster and is now history. This takes the handles as data so the next
 * batch does not need another script.
 *
 * Three things it refuses to do silently:
 *
 *   * Insert a handle already on the roster. Duplicates are reported and
 *     skipped, not merged or overwritten -- an existing row may carry a
 *     category, notes or a posts_per_run someone chose deliberately.
 *   * Mark a handle verified without resolving it. handle_verified is set
 *     from the profile actor's answer, and the harvest filters on that flag,
 *     so a dead or private handle lands inactive and flagged rather than
 *     failing a Sunday run.
 *   * Write anything at all without --confirm.
 *
 * market is a STATED ASSUMPTION, not a detection: the column is NOT NULL
 * with a CHECK of AU/US/CA and this pipeline has no country detection.
 *
 * Usage:
 *   npm run add-competitors -- --file roster/<batch>.json [--market AU] [--confirm]
 *
 * File shape: { "niche_competitor": ["handle", ...], "viral_creator": [...] }
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { config } from "../config.ts";
import { loadActors } from "./lib/harvest.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

type Category = "niche_competitor" | "viral_creator";

interface Resolved {
  handle: string;
  category: Category;
  found: boolean;
  isPrivate: boolean;
  followers: number | null;
  name: string | null;
  note: string;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const file = arg("file");
  const market = arg("market") ?? "AU";
  if (!file) throw new Error("Usage: add_competitors.ts --file <path.json> [--market AU] [--confirm]");

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be set.");

  const raw = JSON.parse(readFileSync(join(repoRoot, file), "utf-8")) as Record<string, string[]>;
  const planned: { handle: string; category: Category }[] = [];
  for (const category of ["niche_competitor", "viral_creator"] as const) {
    for (const handle of raw[category] ?? []) planned.push({ handle: handle.trim(), category });
  }
  if (planned.length === 0) throw new Error(`${file} contained no handles.`);

  const supabase = getSupabaseClient();
  const { data: existingRows, error: exErr } = await supabase.from("competitors").select("handle, category, active");
  if (exErr) throw new Error(`Could not read the existing roster: ${exErr.message}`);
  const existing = new Map((existingRows ?? []).map((c) => [String(c.handle).toLowerCase(), c]));

  const skipped = planned.filter((p) => existing.has(p.handle.toLowerCase()));
  const toAdd = planned.filter((p) => !existing.has(p.handle.toLowerCase()));

  console.log(`${planned.length} handle(s) requested. ${skipped.length} already tracked, ${toAdd.length} to verify.\n`);
  if (skipped.length > 0) {
    console.log("ALREADY TRACKED -- skipped, not overwritten:");
    for (const s of skipped) {
      const e = existing.get(s.handle.toLowerCase())!;
      console.log(`  @${s.handle.padEnd(26)} already ${e.category ?? "uncategorised"}, active=${e.active}`);
    }
    console.log("");
  }
  if (toAdd.length === 0) {
    console.log("Nothing new to add.");
    return;
  }

  // One call for all of them -- the profile actor takes a usernames array,
  // and per-handle calls would multiply the overhead for the same result.
  const pin = loadActors().profile;
  const url =
    `https://api.apify.com/v2/acts/${pin.actorId.replace("/", "~")}/run-sync-get-dataset-items` +
    `?token=${token}&build=${encodeURIComponent(pin.build)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: toAdd.map((p) => p.handle) }),
  });
  if (!res.ok) throw new Error(`Apify ${pin.actorId}:${pin.build} failed: ${res.status} ${res.statusText}`);
  const items = (await res.json()) as Record<string, unknown>[];

  const byHandle = new Map<string, Record<string, unknown>>();
  for (const it of items) {
    const u = String(it.username ?? it.inputUrl ?? "")
      .toLowerCase()
      .replace(/^.*instagram\.com\//, "")
      .replace(/\/$/, "");
    if (u) byHandle.set(u, it);
  }

  const today = new Date().toISOString().slice(0, 10);
  const resolved: Resolved[] = toAdd.map((p) => {
    const it = byHandle.get(p.handle.toLowerCase());
    if (!it || it.error) {
      return {
        handle: p.handle,
        category: p.category,
        found: false,
        isPrivate: false,
        followers: null,
        name: null,
        note: `Did not resolve on ${today} (${String(it?.error ?? "not returned by the profile actor")}).`,
      };
    }
    const isPrivate = it.private === true || it.isPrivate === true;
    return {
      handle: p.handle,
      category: p.category,
      found: true,
      isPrivate,
      followers: (it.followersCount as number) ?? null,
      name: (it.fullName as string) ?? null,
      note: isPrivate ? `Resolved but PRIVATE on ${today} -- posts cannot be collected.` : "",
    };
  });

  for (const r of resolved) {
    const status = !r.found ? "NOT FOUND" : r.isPrivate ? "PRIVATE  " : "ok       ";
    const kind = r.category === "viral_creator" ? "viral" : "niche";
    console.log(`  ${status} ${kind}  @${r.handle.padEnd(26)} ${r.followers ?? "-"} followers`);
  }

  const usable = resolved.filter((r) => r.found && !r.isPrivate);
  const flagged = resolved.filter((r) => !r.found || r.isPrivate);
  console.log(`\n${usable.length} usable, ${flagged.length} flagged.`);

  if (!confirm) {
    console.log("\nNot confirmed -- pass --confirm to insert. Nothing written.");
    return;
  }

  const rows = resolved.map((r) => ({
    name: r.name || r.handle,
    handle: r.handle,
    platform: "instagram",
    market,
    category: r.category,
    profile_url: `https://instagram.com/${r.handle}`,
    // Matches the rest of the roster. This is a CEILING -- an incremental
    // pull only fetches posts newer than the watermark -- and it is what the
    // 90-day baseline median gets computed from, so a shallower setting
    // would give a new account a noisier baseline than its peers.
    posts_per_run: config.DEFAULT_POSTS_PER_RUN,
    scrape_cadence: "weekly",
    // ON for both categories: hooks come from transcripts, and hooks are the
    // entire reason a viral account is tracked. What viral accounts are
    // excluded from is BENCHMARKS, which is the category column's job.
    transcripts_enabled: true,
    // The harvest filters on this, so an unresolved handle cannot quietly
    // break a Sunday run -- it simply is not picked up.
    handle_verified: r.found && !r.isPrivate,
    active: r.found && !r.isPrivate,
    notes:
      `Added ${today}. category=${r.category}. market=${market} is a stated assumption ` +
      `(column is NOT NULL, pipeline has no country detection). ${r.note}`.trim(),
  }));

  const { error } = await supabase.from("competitors").insert(rows);
  if (error) throw new Error(`Insert failed: ${error.message}`);
  console.log(`\nInserted ${rows.length}: ${usable.length} active, ${flagged.length} inactive and flagged.`);
  if (flagged.length > 0) {
    console.log("Flagged rows are inserted INACTIVE so they are visible on the roster rather than silently dropped:");
    for (const f of flagged) console.log(`  @${f.handle} -- ${f.note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
