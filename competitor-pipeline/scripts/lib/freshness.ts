/**
 * How old is the data a run is working on?
 *
 * Separate from stage_check.ts because it answers a different question. The
 * stage ledger says whether THIS run did its work; this says whether the data
 * that work was done ON is current. A content run can be perfectly healthy and
 * still be building posts from a fortnight-old harvest, and nothing in the
 * ledger would show it -- the harvest it depended on ran in a different job,
 * in a different process, hours earlier, against a ledger since cleared.
 */

/**
 * Older than this many days and a weekly harvest has been missed.
 *
 * 8, not 7: the cadence is Sunday-to-Sunday, so healthy data is up to 7 days
 * old by the following Saturday. 8 is the first age that cannot be explained
 * by the schedule itself.
 */
export const STALE_AFTER_DAYS = 8;

/**
 * How old the data this run worked on actually is.
 *
 * Read from the database, not the ledger: a content run does no harvesting,
 * and the ledger is cleared at the start of every run, so the harvest entry
 * from Sunday 19:00 is long gone by the time the 21:00 content run reports.
 * `competitors.last_scraped_at` is the watermark a harvest updates, so the
 * most recent one across the active roster IS "data as of".
 *
 * The oldest is checked too. A headline built on the newest watermark alone
 * would read "0 days old" while a whole tier had silently stopped being
 * harvested -- the most recent account would be fresh and the claim would be
 * true of almost nothing. When the oldest is stale and the newest is not,
 * that is said in the same line rather than left to be discovered.
 */
export interface RosterFreshness {
  handle: string;
  last_scraped_at: string | null;
}

/**
 * Turns roster watermarks into the one-line freshness verdict.
 *
 * Pure, and takes `now` as an argument, so every branch below -- fresh, stale,
 * partly stale, never harvested -- is testable without waiting a week or
 * editing the database. The database read is the caller's job.
 */
export function describeFreshness(
  rows: RosterFreshness[],
  now: number = Date.now()
): { text: string; stale: boolean } {
  if (rows.length === 0) return { text: "Data age: no active, verified competitors.", stale: false };

  const scraped = rows.filter((r) => r.last_scraped_at != null);
  const neverScraped = rows.length - scraped.length;
  if (scraped.length === 0) {
    return {
      text: `Data age: none of the ${rows.length} active competitor(s) has ever been harvested.`,
      stale: true,
    };
  }

  const daysOld = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  const ages = scraped
    .map((r) => ({ handle: r.handle, days: daysOld(r.last_scraped_at as string), at: r.last_scraped_at as string }))
    .sort((a, b) => a.days - b.days);
  const newest = ages[0];
  const oldest = ages[ages.length - 1];

  let text = `Data as of ${newest.at.slice(0, 10)}, ${newest.days} day(s) old.`;

  // The headline is true of the freshest account. Say how far that is from
  // being true of all of them whenever the gap matters: a whole tier can stop
  // being harvested while the newest watermark still reads "0 days old", and
  // the claim would then be true of almost nothing.
  const staleCount = ages.filter((a) => a.days >= STALE_AFTER_DAYS).length;
  if (staleCount > 0 && newest.days < STALE_AFTER_DAYS) {
    text += ` NOTE: ${staleCount} of ${rows.length} account(s) are ${STALE_AFTER_DAYS}+ days stale (oldest @${oldest.handle}, ${oldest.days} days).`;
  }
  if (neverScraped > 0) text += ` ${neverScraped} account(s) never harvested.`;

  return { text, stale: newest.days >= STALE_AFTER_DAYS || staleCount > 0 };
}
