// Mirrors the exact CASE thresholds baked into v_outliers's SQL (migration
// 007) -- not exposed as a queryable value, so replicated here for
// display purposes only. Keep in sync if that view's bands are retuned.
export interface Band {
  name: "small" | "mid" | "large";
  minMedianVpf: number;
  minOutlierViews: number;
}

const BANDS: Band[] = [
  { name: "small", minMedianVpf: 0.05, minOutlierViews: 1000 },
  { name: "mid", minMedianVpf: 0.01, minOutlierViews: 5000 },
  { name: "large", minMedianVpf: 0.005, minOutlierViews: 20000 },
];

export function resolveBand(followers: number | null | undefined): Band {
  if (followers === null || followers === undefined) return BANDS[1]; // mid, a neutral default
  if (followers < 10000) return BANDS[0];
  if (followers < 250000) return BANDS[1];
  return BANDS[2];
}
