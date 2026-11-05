import { daysSince } from "./format";

// How long before an account is overdue for a harvest.
//
// One cadence now. This used to be tier-driven (T1 weekly, T2 fortnightly,
// T3 monthly), but migration 020 retired tiers and the scheduler harvests
// the whole roster in a single weekly run -- so every account is on the same
// clock, and a per-account expectation would be describing a schedule that
// no longer exists.
//
// A row-level scrape_cadence still overrides, for an account deliberately
// put on a slower clock.
const WEEKLY_CADENCE_DAYS = 7;
const NAMED_CADENCE_DAYS: Record<string, number> = { weekly: 7, fortnightly: 14, monthly: 30 };

// A day of grace over the cadence: the harvest runs Sunday evening UTC, so
// an account checked on a Monday is legitimately 7-and-a-bit days old.
const GRACE_DAYS = 1;

export function expectedCadenceDays(scrapeCadence: string | null): number {
  if (scrapeCadence && NAMED_CADENCE_DAYS[scrapeCadence]) return NAMED_CADENCE_DAYS[scrapeCadence];
  return WEEKLY_CADENCE_DAYS;
}

export function isOverdue(lastScrapedAt: string | null, scrapeCadence: string | null): boolean {
  const since = daysSince(lastScrapedAt);
  if (since === null) return true; // never scraped
  return since > expectedCadenceDays(scrapeCadence) + GRACE_DAYS;
}
