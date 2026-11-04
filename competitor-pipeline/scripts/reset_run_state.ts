/**
 * Clears the stage ledger at the start of a run.
 *
 * Each stage runs as its own `npm run` in its own process, so the ledger
 * that carries "did harvest succeed?" from one stage to the next lives in
 * logs/run-state.json rather than in memory. Without this, a run would
 * inherit last week's verdicts: a harvest that failed on Sunday would still
 * be marked failed the following Sunday, and every dependent stage would
 * skip itself over a failure that had already been fixed.
 *
 * Usage: npm run reset-run-state
 */

import { resetLedger } from "./lib/stage_check.ts";

resetLedger();
console.log("Stage ledger cleared -- logs/run-state.json");
