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

// Overdue logic lives in lib/cadence.ts -- it needs tier as a fallback
// since competitors.scrape_cadence isn't populated on every row.

export function formatChange(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

// TikTok/Instagram actor payloads carry a thumbnail under different keys.
// competitor_posts.thumbnail_url is schema-only (nothing in scripts/
// populates it yet), so existing rows fall back to deriving one from the
// already-stored raw jsonb at read time.
export function deriveThumbnailUrl(thumbnailUrl: string | null, raw: unknown): string | null {
  if (thumbnailUrl) return thumbnailUrl;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const videoMeta = r.videoMeta as Record<string, unknown> | undefined;
  if (videoMeta?.coverUrl && typeof videoMeta.coverUrl === "string") return videoMeta.coverUrl;
  if (typeof r.displayUrl === "string") return r.displayUrl;
  if (typeof r.thumbnailUrl === "string") return r.thumbnailUrl;
  if (typeof r.imageUrl === "string") return r.imageUrl;
  return null;
}
