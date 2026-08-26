import { daysSince } from "./format";

// Row-level scrape_cadence overrides this when set, but it's not populated
// on every competitor -- schedule.md's actual design is tier-driven (T1
// weekly, T2 fortnightly, T3 monthly; see config.ts's SCRAPE_CADENCE_DAYS),
// so that's the reliable fallback.
const TIER_CADENCE_DAYS: Record<string, number> = { T1: 7, T2: 14, T3: 30 };
const NAMED_CADENCE_DAYS: Record<string, number> = { weekly: 7, fortnightly: 14, monthly: 30 };

export function expectedCadenceDays(tier: string, scrapeCadence: string | null): number {
  if (scrapeCadence && NAMED_CADENCE_DAYS[scrapeCadence]) return NAMED_CADENCE_DAYS[scrapeCadence];
  return TIER_CADENCE_DAYS[tier] ?? 30;
}

export function isOverdue(lastScrapedAt: string | null, tier: string, scrapeCadence: string | null): boolean {
  const since = daysSince(lastScrapedAt);
  if (since === null) return true; // never scraped
  return since > expectedCadenceDays(tier, scrapeCadence);
}
