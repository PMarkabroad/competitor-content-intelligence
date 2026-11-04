/**
 * Shared rules for "what's working" rankings.
 *
 * Three rules, all of which existed as scattered inline filters or not at
 * all before:
 *
 *   1. MIN_VIDEOS -- a pattern seen in one or two videos is an anecdote.
 *      Averaging two scores and printing it next to a pattern backed by
 *      thirty invites the reader to treat them as comparable, and the
 *      single-video entries were routinely topping the list because one
 *      outlier IS the average when n=1.
 *
 *   2. Benchmark rankings exclude viral_creator. Those accounts are tracked
 *      for hook craft, not as performance peers: a lifestyle reel at 400x
 *      its own modest baseline outranks a career coach's genuinely strong
 *      12x, and the pooled average then describes a market Ark is not in.
 *      Per-account baselines are unaffected -- v_competitor_baseline groups
 *      by competitor_id, so no account's median was ever polluted by
 *      another's.
 *
 *   3. usableLine -- an empty or whitespace opening line is a tagging gap,
 *      not a hook. Printing a blank row in a swipe file wastes the slot.
 */

/** Below this, an average is an anecdote rather than a finding. */
export const MIN_VIDEOS = 5;

export interface Rankable {
  outlier_score: number | null;
  competitors?: { category?: string | null } | null;
  category?: string | null;
}

/** The category on a row, whether it arrived joined or flat. */
export function categoryOf(row: Rankable): string | null {
  return row.competitors?.category ?? row.category ?? null;
}

/**
 * Rows that may inform a BENCHMARK. Viral creators are excluded; rows with
 * no category are kept, because an unset category is a gap to fill rather
 * than a reason to silently drop real data.
 */
export function benchmarkRows<T extends Rankable>(rows: T[]): T[] {
  return rows.filter((r) => categoryOf(r) !== "viral_creator");
}

/** An opening line worth showing: present, and not just whitespace. */
export function usableLine(line: string | null | undefined): boolean {
  return typeof line === "string" && line.trim().length > 0;
}

export interface Ranked {
  name: string;
  n: number;
  score: number;
}

/**
 * The groups that did NOT clear MIN_VIDEOS -- shown separately as early
 * signals rather than hidden entirely.
 *
 * A thin pattern is not nothing; it is not yet a finding. Hiding it made an
 * honest empty state look like a broken page, while mixing it into the
 * ranking would let a single video outrank thirty. Separate block, counts
 * visible, so the reader can see both that something is emerging and that it
 * is not yet evidence.
 */
export function earlySignals(
  entries: { key: string | null | undefined; score: number | null }[],
  limit = 6
): Ranked[] {
  const buckets = new Map<string, number[]>();
  for (const e of entries) {
    if (!e.key || e.score == null) continue;
    if (!buckets.has(e.key)) buckets.set(e.key, []);
    buckets.get(e.key)!.push(e.score);
  }
  return Array.from(buckets.entries())
    .filter(([, scores]) => scores.length > 0 && scores.length < MIN_VIDEOS)
    .map(([key, scores]) => ({
      name: key.replace(/_/g, " "),
      n: scores.length,
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    // Most-evidenced first: 4 videos is closer to a finding than 1.
    .sort((a, b) => b.n - a.n || b.score - a.score)
    .slice(0, limit);
}

export function rankByAverage(
  entries: { key: string | null | undefined; score: number | null }[],
  limit = 4
): Ranked[] {
  const buckets = new Map<string, number[]>();
  for (const e of entries) {
    if (!e.key || e.score == null) continue;
    if (!buckets.has(e.key)) buckets.set(e.key, []);
    buckets.get(e.key)!.push(e.score);
  }
  return Array.from(buckets.entries())
    .filter(([, scores]) => scores.length >= MIN_VIDEOS)
    .map(([key, scores]) => ({
      name: key.replace(/_/g, " "),
      n: scores.length,
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
