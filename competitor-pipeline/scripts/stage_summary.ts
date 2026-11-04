/**
 * The run's one verdict, read from the stage ledger.
 *
 * Every stage records what it expected to write against what it actually
 * wrote (scripts/lib/stage_check.ts). This prints all of it once, at the end,
 * and exits non-zero if anything failed -- so the run is red exactly when the
 * data is wrong, not when a step happened to throw.
 *
 * It is the ONLY place the run fails as a whole. Individual content steps
 * carry continue-on-error so one dead stage costs one stage rather than the
 * night, which on its own would make every run green; this is the other half
 * of that bargain.
 *
 * Usage: npm run stage-summary
 */

import { ledgerSummary } from "./lib/stage_check.ts";

const { text, failed, skipped, recorded } = ledgerSummary();
console.log(text);

// Nothing recorded is a failure, not a quiet week. Every content step starts
// (if: always()) and either records a result or records its own skip, so an
// empty ledger means all of them died before reaching their check and
// continue-on-error swallowed it -- precisely the green-tick no-op this
// pipeline lost two weeks of September to.
if (recorded === 0) {
  console.error(
    "\n*** RUN FAILED: no stage reached its own check ***\n" +
      "Every step starts regardless of what came before it, so an empty ledger " +
      "means they all died early -- a missing secret or a bad dependency install, " +
      "not a quiet week. Check the earlier steps' logs."
  );
  process.exitCode = 1;
} else if (failed.length > 0) {
  console.error(
    `\n*** RUN FAILED: ${failed.join(", ")}` +
      (skipped.length > 0 ? ` (and so skipped: ${skipped.join(", ")})` : "") +
      " ***\n" +
      "Re-running is safe -- every stage skips work it has already done. " +
      "logs/ is attached to this run as an artifact."
  );
  process.exitCode = 1;
}
