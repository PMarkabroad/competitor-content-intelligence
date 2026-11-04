/**
 * "Did this stage actually write anything?" -- plus what to skip when it
 * didn't.
 *
 * Exit code 0 is not evidence of work. This project produced three
 * silently-successful no-ops in six weeks: the 26 September discovery sweep
 * reported SUCCESS while every actor returned 403 build-not-found; the
 * archive copy created its tables, hit a 413 on the first insert and left
 * them empty looking finished; and a harvest collected 460 posts with every
 * view count null, so nothing downstream could score. Each was found days
 * later by someone happening to check a row count.
 *
 * Every stage now declares what it expected to write and what it actually
 * wrote, fails loudly when those disagree, and declares what depends on it
 * -- because drafts built on a partial harvest are worse than no drafts:
 * they look finished and are quietly wrong.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A stage, and the stage it cannot run without. */
export const STAGE_DEPENDENCIES: Record<string, string | null> = {
  // Independent: these do not consume this run's fresh data, so a harvest
  // failure must not stop them.
  harvest: null,
  archive: null,
  discovery: null,
  // Dependent chain.
  transcription: "harvest",
  hook_tagging: "transcription",
  insights: "hook_tagging",
  drafts: "hook_tagging",
  channel_formats: "drafts",
};

/**
 * Minimum fraction of expected rows that must actually be written.
 *
 * Read as "at least this much", not "allowed to lose this much". Each value
 * reflects how much loss is LEGITIMATE for that stage:
 *
 *   harvest 0.9        -- one account going private or rate-limited should
 *                         not fail the night; the accounts that returned
 *                         nothing are named in the log.
 *   transcription 0.5  -- empty returns are normal and measured: TikTok
 *                         speech-to-text comes back empty on every
 *                         subtitle-less video, and some outliers are
 *                         carousels with no audio at all.
 *   hook_tagging 0.8   -- the content filters (job listings, visa,
 *                         non-English) legitimately drop a fifth of input
 *                         before the model is ever called.
 *   drafts 0.9         -- an occasional LLM call failing or being filtered
 *                         should not kill the run; skipped ones are logged.
 *   archive 1.0        -- a partial copy is a broken backup.
 */
export const MIN_RATIO: Record<string, number> = {
  harvest: 0.9,
  transcription: 0.5,
  hook_tagging: 0.8,
  insights: 0.9,
  drafts: 0.9,
  channel_formats: 0.9,
  archive: 1.0,
  discovery: 0.9,
};

export interface StageResult {
  stage: string;
  expected: number;
  actual: number;
  /** Minimum fraction of `expected` that must be written. Defaults to MIN_RATIO[stage] ?? 1. */
  minRatio?: number;
  /** Named items that produced nothing, so a shortfall is diagnosable from the log alone. */
  emptyItems?: string[];
  detail?: string;
}

export function formatStageResult(r: StageResult): string {
  const pct = r.expected > 0 ? ` (${Math.round((r.actual / r.expected) * 100)}%)` : "";
  return `[${r.stage}] wrote ${r.actual} of ${r.expected} expected${pct}${r.detail ? ` -- ${r.detail}` : ""}`;
}

/** A failure message, or null when the stage is healthy. */
export function stageFailure(r: StageResult): string | null {
  // Nothing was expected, so nothing is missing. A quiet week is not a fault.
  if (r.expected === 0) return null;

  const minRatio = r.minRatio ?? MIN_RATIO[r.stage] ?? 1;
  const named = r.emptyItems?.length ? `\n  Produced nothing: ${r.emptyItems.join(", ")}` : "";

  if (r.actual === 0) {
    return (
      `${formatStageResult(r)}${named}\n` +
      `  STAGE WROTE NOTHING despite having ${r.expected} item(s) to process. ` +
      `This exits non-zero on purpose: a green tick on a no-op run is how this pipeline ` +
      `lost two weeks of data in September.`
    );
  }

  const ratio = r.actual / r.expected;
  if (ratio < minRatio) {
    return (
      `${formatStageResult(r)}${named}\n` +
      `  Below this stage's ${Math.round(minRatio * 100)}% minimum. Re-running is safe ` +
      `(every stage skips completed work), but find out why first.`
    );
  }

  return null;
}

// --- cross-process ledger ----------------------------------------------
//
// Each stage runs as its own `npm run` in its own process, so an in-memory
// ledger cannot see what the previous stage did. Run state therefore lives
// in a file that every stage appends to and the summary step reads.
//
// The ledger file is gitignored and the workflow uploads logs/ on always()
// -- so it survives a run that fails outright, which is when it matters
// most. It is cleared at the start of every run (reset_run_state.ts);
// without that, a run would inherit the previous run's verdicts.

const LOGS_DIR = new URL("../../logs/", import.meta.url);
const LEDGER_PATH = fileURLToPath(new URL("run-state.json", LOGS_DIR));

export interface LedgerEntry {
  stage: string;
  outcome: "ok" | "failed" | "skipped";
  expected: number;
  actual: number;
  detail?: string;
  emptyItems?: string[];
  blockedBy?: string;
  at: string;
}

function readLedger(): LedgerEntry[] {
  try {
    if (!existsSync(LEDGER_PATH)) return [];
    return JSON.parse(readFileSync(LEDGER_PATH, "utf-8")) as LedgerEntry[];
  } catch {
    // A corrupt ledger must not take the pipeline down with it.
    return [];
  }
}

function writeLedger(entries: LedgerEntry[]): void {
  mkdirSync(fileURLToPath(LOGS_DIR), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(entries, null, 2));
}

/** Clears the ledger. Called once at the start of a run. */
export function resetLedger(): void {
  writeLedger([]);
}

/**
 * True when this stage may run: nothing it depends on has failed or been
 * skipped. Records a "skipped" entry when it may not, so a stage that did
 * not run is never mistaken for one that ran fine.
 */
export function canRunStage(stage: string): boolean {
  const entries = readLedger();
  // Deduped on write, like recordStage: generate-formats asks this twice in a
  // content run -- once chained from the draft generator, once as the
  // backfill step -- and "SKIPPED as a result: channel_formats,
  // channel_formats" reads like two separate casualties.
  const without = (s: string) => entries.filter((e) => e.stage !== s);
  const outcomeOf = (s: string) => entries.find((e) => e.stage === s)?.outcome;

  let dep = STAGE_DEPENDENCIES[stage] ?? null;
  const seen = new Set<string>();
  while (dep && !seen.has(dep)) {
    seen.add(dep);
    const o = outcomeOf(dep);
    if (o === "failed" || o === "skipped") {
      // Blame the stage that actually failed, not an intermediate that was
      // itself only skipped.
      const root = o === "failed" ? dep : entries.find((e) => e.outcome === "failed")?.stage ?? dep;
      writeLedger([
        ...without(stage),
        {
          stage,
          outcome: "skipped",
          expected: 0,
          actual: 0,
          blockedBy: root,
          at: new Date().toISOString(),
        },
      ]);
      console.error(`\nSKIPPED [${stage}] -- skipped due to ${root} failure (this is NOT a success)`);
      return false;
    }
    dep = STAGE_DEPENDENCIES[dep] ?? null;
  }
  return true;
}

/**
 * How many rows a stage actually wrote this run, or null if it never ran.
 *
 * Lets a stage ask not just "did my dependency succeed?" (canRunStage) but
 * "did it produce anything NEW?". Those are different questions: a tagging
 * stage with nothing to tag succeeds honestly, writing zero rows, and a
 * generator downstream of it would then build this week's output from last
 * week's input and present it as current.
 */
export function stageWrote(stage: string): number | null {
  const entry = readLedger().find((e) => e.stage === stage);
  if (!entry || entry.outcome === "skipped") return null;
  return entry.actual;
}

/** Records a stage result to the shared ledger. Returns true when healthy. */
export function recordStage(r: StageResult): boolean {
  const failure = stageFailure(r);
  // Replace, don't append: a stage can legitimately run twice in one night.
  // generate-formats runs once chained from the draft generator and again as
  // the backfill step that catches drafts whose chained call failed -- the
  // backfill is the authoritative result, and appending both would report
  // "FAILED: channel_formats" for a gap the backfill had already filled.
  const entries = readLedger().filter((e) => e.stage !== r.stage);
  entries.push({
    stage: r.stage,
    outcome: failure ? "failed" : "ok",
    expected: r.expected,
    actual: r.actual,
    detail: r.detail,
    emptyItems: r.emptyItems,
    at: new Date().toISOString(),
  });
  writeLedger(entries);

  if (failure) {
    console.error(`\nFAILED ${failure}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`\nOK ${formatStageResult(r)}`);
  return true;
}

/**
 * The run's single summary, for the alert.
 *
 * `recorded` is the number of stages that reached their own check. Zero is
 * NOT a pass: on a content run every step starts (if: always()) and either
 * records a result or records its own skip, so an empty ledger means every
 * one of them died before its check -- with continue-on-error swallowing it.
 * That is the exact silent no-op this file exists to catch, so the caller
 * must be able to see it rather than reading "all stages healthy".
 */
export function ledgerSummary(): { text: string; failed: string[]; skipped: string[]; recorded: number } {
  const entries = readLedger();
  const failed = entries.filter((e) => e.outcome === "failed").map((e) => e.stage);
  const skipped = entries.filter((e) => e.outcome === "skipped").map((e) => e.stage);

  const lines = ["RUN SUMMARY"];
  if (entries.length === 0) {
    // An empty ledger is not a healthy run -- it is a run where no stage
    // reached its own check. Saying "all healthy" here would be the
    // green-tick-on-a-no-op failure this whole file exists to stop.
    lines.push("  No stages recorded anything.");
    return { text: lines.join("\n"), failed, skipped, recorded: 0 };
  }
  for (const e of entries) {
    if (e.outcome === "skipped") {
      lines.push(`  [${e.stage}] skipped due to ${e.blockedBy} failure`);
    } else {
      const pct = e.expected > 0 ? ` (${Math.round((e.actual / e.expected) * 100)}%)` : "";
      lines.push(`  [${e.stage}] ${e.outcome}: wrote ${e.actual} of ${e.expected}${pct}`);
      if (e.emptyItems?.length) lines.push(`      produced nothing: ${e.emptyItems.join(", ")}`);
    }
  }
  lines.push("");
  lines.push(failed.length > 0 ? `FAILED: ${failed.join(", ")}` : "All stages healthy.");
  if (skipped.length > 0) lines.push(`SKIPPED as a result: ${skipped.join(", ")}`);

  return { text: lines.join("\n"), failed, skipped, recorded: entries.length };
}
