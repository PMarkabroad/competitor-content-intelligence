export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatVpf(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(4);
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}x`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
};

export function isOverdue(lastScrapedAt: string | null | undefined, cadence: string | null | undefined): boolean {
  const since = daysSince(lastScrapedAt);
  if (since === null) return true; // never scraped at all
  const expected = cadence ? CADENCE_DAYS[cadence] : undefined;
  if (!expected) return false;
  return since > expected;
}
