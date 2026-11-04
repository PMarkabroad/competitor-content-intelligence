/**
 * Inserts the 2026-11-04 competitor roster, verifying each handle against
 * Instagram first.
 *
 * Every handle is resolved through the profile actor before insert, and
 * handle_verified is set from that result rather than assumed. That flag is
 * what scheduled_harvest filters on, so an unresolved handle lands inactive
 * and flagged instead of failing a Sunday run -- "flag it, don't fail the
 * run", enforced by the data rather than by a note.
 *
 * tier follows category: niche_competitor -> T2, viral_creator -> T3. Both
 * are in SCOREABLE_TIERS so both still produce hooks; the exclusion of
 * viral accounts from BENCHMARKS is the category column's job, not the
 * tier's. Putting viral accounts in T1 would have been the other option and
 * is wrong -- T1 is exempt from scoring, so they would produce no hooks at
 * all, which is the only reason they are tracked.
 *
 * market is 'AU' for all of them, decided by the user on 2026-11-04. The
 * column is NOT NULL with a CHECK of AU/US/CA and the pipeline has no
 * country detection, so this is a stated assumption, not a detection.
 *
 * Usage: npm run seed-competitors -- [--confirm]
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const ACTORS_PATH = new URL("../apify/actors.json", import.meta.url);

const VIRAL_CREATOR = [
  "psych.actually",
  "globetrottingheels",
  "vaiibhavnarula",
  "indians_in_brisbane_est",
  "wanderess_priyanka",
  "johnny_migrationlawyer",
  "pri_for_real",
  "angelawanders_",
  "vaishnavikataria__13",
];

const NICHE_COMPETITOR = [
  "rishikaa.tiwari1",
  "usmanobaid.pov",
  "thariq.ikram",
  "jobsearchwithpal",
  "luke.stne",
  "ayushifromsomewhere",
  "tusharbareja23",
  "ankitxrajputtt",
  "manroo_ps_in_aus",
  "imginoz",
  "tejaswani_r11",
  "prag___goyal",
  "ishaan_manga",
  "kapslock_yt",
];

interface Resolved {
  handle: string;
  category: "viral_creator" | "niche_competitor";
  found: boolean;
  isPrivate: boolean;
  followers: number | null;
  name: string | null;
  note: string;
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be set.");

  const actors = JSON.parse(readFileSync(ACTORS_PATH, "utf-8")) as Record<string, { actorId: string; build: string }>;
  const pin = actors.profile;

  const planned: { handle: string; category: Resolved["category"] }[] = [
    ...VIRAL_CREATOR.map((h) => ({ handle: h, category: "viral_creator" as const })),
    ...NICHE_COMPETITOR.map((h) => ({ handle: h, category: "niche_competitor" as const })),
  ];
  console.log(`${planned.length} handle(s) to verify and insert.\n`);

  // One call for all of them -- the profile actor takes a usernames array,
  // and per-handle calls would be 23x the overhead for the same result.
  const url =
    `https://api.apify.com/v2/acts/${pin.actorId.replace("/", "~")}/run-sync-get-dataset-items` +
    `?token=${token}&build=${encodeURIComponent(pin.build)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: planned.map((p) => p.handle) }),
  });
  if (!res.ok) throw new Error(`Apify ${pin.actorId}:${pin.build} failed: ${res.status} ${res.statusText}`);
  const items = (await res.json()) as Record<string, unknown>[];

  const byHandle = new Map<string, Record<string, unknown>>();
  for (const it of items) {
    const u = String(it.username ?? it.inputUrl ?? "").toLowerCase().replace(/^.*instagram\.com\//, "").replace(/\/$/, "");
    if (u) byHandle.set(u, it);
  }

  const resolved: Resolved[] = planned.map((p) => {
    const it = byHandle.get(p.handle.toLowerCase());
    if (!it || it.error) {
      return {
        handle: p.handle,
        category: p.category,
        found: false,
        isPrivate: false,
        followers: null,
        name: null,
        note: `Did not resolve on 2026-11-04 (${String(it?.error ?? "not returned by profile actor")}).`,
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
      note: isPrivate ? "Resolved but PRIVATE on 2026-11-04 -- posts cannot be collected." : "",
    };
  });

  for (const r of resolved) {
    const status = !r.found ? "NOT FOUND" : r.isPrivate ? "PRIVATE  " : "ok       ";
    console.log(`  ${status} ${r.category === "viral_creator" ? "viral" : "niche"}  @${r.handle.padEnd(24)} ${r.followers ?? "-"} followers`);
  }

  const usable = resolved.filter((r) => r.found && !r.isPrivate);
  const flagged = resolved.filter((r) => !r.found || r.isPrivate);
  console.log(`\n${usable.length} usable, ${flagged.length} flagged.`);

  if (!confirm) {
    console.log("\nNot confirmed -- pass --confirm to insert. Nothing written.");
    return;
  }

  const supabase = getSupabaseClient();
  const rows = resolved.map((r) => ({
    name: r.name || r.handle,
    handle: r.handle,
    platform: "instagram",
    // Stated assumption, not detection -- see the header comment.
    market: "AU",
    category: r.category,
    tier: r.category === "niche_competitor" ? "T2" : "T3",
    profile_url: `https://instagram.com/${r.handle}`,
    posts_per_run: 20,
    scrape_cadence: "weekly",
    // ON for both categories. Turning it off for viral_creator was wrong:
    // hooks come from transcripts, and hooks are the entire reason a viral
    // account is tracked at all. What viral accounts are excluded from is
    // BENCHMARKS, not hook extraction.
    transcripts_enabled: true,
    // The harvest filters on this, so an unresolved handle cannot quietly
    // break a Sunday run -- it simply is not picked up.
    handle_verified: r.found && !r.isPrivate,
    active: r.found && !r.isPrivate,
    notes:
      `Seeded 2026-11-04 roster reset. category=${r.category}. market=AU is a stated assumption (column is NOT NULL, ` +
      `pipeline has no country detection). ${r.note}`.trim(),
  }));

  const { error } = await supabase.from("competitors").insert(rows);
  if (error) throw new Error(`Insert failed: ${error.message}`);
  console.log(`\nInserted ${rows.length} competitor(s): ${usable.length} active, ${flagged.length} inactive and flagged.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
