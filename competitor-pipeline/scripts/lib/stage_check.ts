/**
 * "Did this stage actually write anything?" -- plus what to skip when it
 * didn't.
 *
 * Exit code 0 is not evidence of work. This project has produced two
 * silently-successful no-ops: the 26 September discovery sweep reported
 * SUCCESS while every actor returned 403 build-not-found, and the archive
 * copy created its tables, hit a 413 on the first insert, and left empty
 * tables behind looking finished. Both were found days later by someone
 * happening to check a row count.
 *
 * Every stage now declares what it expected to write and what it actually
 * wrote, fails loudly when those disagree, and -- because a failed harvest
 * must not produce drafts from stale data -- declares what depends on it.
 */

/** A stage, and the stage it cannot run without. */
export const STAGE_DEPENDENCIES: Record<string, string | null> = {
  // Independent: these do not consume this run's fresh data, so a harvest
  // failure must not stop them.
  harvest: null,
  archive: null,
  discovery: null,
  // Dependent chain. Drafts built on a partial harvest are worse than no
  // drafts: they look finished and are quietly wrong.
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
 * reflects how much loss is LEGITIMATE for that stage, not how much is
 * tolerable:
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
 *                         should not kill the run; the skipped ones are
 *                         logged.
 *   archive 1.0        -- a partial copy is a broken backup. No tolerance.
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

/**
 * Tracks stage outcomes across a run so dependants can be skipped and one
 * alert can summarise the night.
 */
export class RunLedger {
  private outcomes = new Map<string, "ok" | "failed" | "skipped">();
  private messages: string[] = [];

  /**
   * True when this stage may run: its dependency chain is intact. A skipped
   * stage is recorded as skipped, NOT as success -- the whole point is that
   * "did not run" and "ran fine" stop looking alike.
   */
  canRun(stage: string): boolean {
    const blocker = this.blockedBy(stage);
    if (!blocker) return true;
    this.outcomes.set(stage, "skipped");
    this.messages.push(`[${stage}] skipped due to ${blocker} failure`);
    console.error(`\nSKIPPED [${stage}] -- skipped due to ${blocker} failure (not a success)`);
    return false;
  }

  /** The nearest failed ancestor, walking the dependency chain. */
  private blockedBy(stage: string): string | null {
    let dep = STAGE_DEPENDENCIES[stage] ?? null;
    const seen = new Set<string>();
    while (dep && !seen.has(dep)) {
      seen.add(dep);
      const o = this.outcomes.get(dep);
      if (o === "failed" || o === "skipped") {
        // Report the stage that actually failed, not the intermediate that
        // was merely skipped -- otherwise the alert blames the wrong thing.
        return o === "failed" ? dep : this.blockedBy(dep) ?? dep;
      }
      dep = STAGE_DEPENDENCIES[dep] ?? null;
    }
    return null;
  }

  /** Records a stage's result. Returns true when healthy. */
  record(r: StageResult): boolean {
    const failure = stageFailure(r);
    if (failure) {
      this.outcomes.set(r.stage, "failed");
      this.messages.push(`[${r.stage}] FAILED: ${formatStageResult(r)}`);
      console.error(`\nFAILED ${failure}`);
      return false;
    }
    this.outcomes.set(r.stage, "ok");
    this.messages.push(`[${r.stage}] ok: ${formatStageResult(r)}`);
    console.log(`\nOK ${formatStageResult(r)}`);
    return true;
  }

  get failed(): string[] {
    return [...this.outcomes.entries()].filter(([, o]) => o === "failed").map(([s]) => s);
  }

  get skipped(): string[] {
    return [...this.outcomes.entries()].filter(([, o]) => o === "skipped").map(([s]) => s);
  }

  /** One summary for the run's single alert. */
  summary(): string {
    const lines = ["RUN SUMMARY", ...this.messages.map((m) => `  ${m}`)];
    if (this.failed.length > 0) {
      lines.push(
        ``,
        `FAILED: ${this.failed.join(", ")}`,
        this.skipped.length > 0 ? `SKIPPED as a result: ${this.skipped.join(", ")}` : `Nothing was skipped.`
      );
    } else {
      lines.push(``, `All stages healthy.`);
    }
    return lines.join("\n");
  }

  /** Non-zero when anything failed or was skipped, so CI cannot read it as a pass. */
  applyExitCode(): void {
    if (this.failed.length > 0 || this.skipped.length > 0) process.exitCode = 1;
  }
}
