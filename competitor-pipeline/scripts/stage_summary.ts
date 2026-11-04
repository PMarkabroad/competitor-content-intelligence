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

import "dotenv/config";
import { ledgerSummary } from "./lib/stage_check.ts";
import { getSupabaseClient } from "./lib/supabaseClient.ts";
import { STALE_AFTER_DAYS, describeFreshness, type RosterFreshness } from "./lib/freshness.ts";

/**
 * How old the data this run worked on actually is.
 *
 * Read from the database, not the ledger: a content run does no harvesting,
 * and the ledger is cleared at the start of every run, so the harvest entry
 * from Sunday 19:00 is long gone by the time the 21:00 content run reports.
 * `competitors.last_scraped_at` is the watermark a harvest updates, so the
 * most recent one across the active roster IS "data as of".
 */
async function freshnessLine(): Promise<{ text: string; stale: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("competitors")
    .select("handle, last_scraped_at")
    .eq("active", true)
    .eq("handle_verified", true);

  if (error) {
    // Not fatal. This line is context for the verdict above it, not the
    // verdict -- failing the run because a freshness lookup broke would be
    // the tail wagging the dog.
    return { text: `Data age: could not be read (${error.message})`, stale: false };
  }
  return describeFreshness((data ?? []) as RosterFreshness[]);
}

const { text, failed, skipped, recorded } = ledgerSummary();
console.log(text);

const freshness = await freshnessLine();
console.log(`\n${freshness.text}`);
if (freshness.stale) {
  // A warning, not a failure: the user asked to be told, and stale data is a
  // reason to look at last Sunday's run rather than to fail this one. The run
  // that actually broke is the one that should be red, and it already is.
  console.warn(
    `*** STALE DATA: older than ${STALE_AFTER_DAYS} days, so at least one weekly harvest did not land. ` +
      `Check the most recent T2/T3 harvest run before trusting anything built on this. ***`
  );
}

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
