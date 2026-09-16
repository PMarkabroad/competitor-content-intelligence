/**
 * Retries a Supabase write on transient failure.
 *
 * On 2026-09-13 the scheduled T3 harvest died on "competitor_posts upsert
 * failed: Gateway Timeout" -- one 504 from Supabase, after Apify had already
 * been paid for the pull. The run was unattended, so nobody was there to
 * press the button again, and the posts for that account waited a week.
 *
 * Only transient errors are retried. A constraint violation, a bad column,
 * a type error -- those fail on the first attempt exactly as before, because
 * retrying a real bug three times is three times the wrong answer plus a
 * delay before finding out.
 */

const TRANSIENT =
  /gateway timeout|timed? ?out|504|502|503|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|too many connections/i;

export function isTransient(message: string | null | undefined): boolean {
  return TRANSIENT.test(String(message ?? ""));
}

export async function withRetry<T extends { error: { message: string } | null }>(
  label: string,
  attempt: () => PromiseLike<T>,
  { retries = 3, baseDelayMs = 2000 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i <= retries; i++) {
    last = await attempt();
    if (!last.error) return last;
    if (!isTransient(last.error.message) || i === retries) return last;
    // 2s, 4s, 8s. A 504 usually clears within seconds; if it has not
    // cleared in fourteen, waiting longer inside one run is not the fix.
    const delay = baseDelayMs * 2 ** i;
    console.warn(`  ${label}: transient error (${last.error.message}), retry ${i + 1}/${retries} in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
  }
  return last as T;
}
