import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatVpf, formatChange, formatDate } from "@/lib/format";
import { isOverdue } from "@/lib/cadence";

export const dynamic = "force-dynamic";

interface CompetitorSummary {
  competitor_id: string;
  name: string;
  handle: string;
  platform: string;
  tier: string;
  market: string;
  active: boolean;
  handle_verified: boolean;
  low_median_flag: boolean;
  last_scraped_at: string | null;
  followers_current: number | null;
  follower_change_30d: number | null;
  follower_change_90d: number | null;
  posts_collected: number;
  posts_per_week: number | null;
  median_vpf: number | null;
  best_post_id: string | null;
  best_post_score: number | null;
  last_activity_at: string | null;
}

const MARKETS = ["AU", "US", "CA"];
const PLATFORMS = ["tiktok", "instagram"];
const TIERS = ["T1", "T2", "T3"];

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; platform?: string; tier?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("v_competitor_summary").select("*");
  if (error) throw new Error(`Failed to load v_competitor_summary: ${error.message}`);

  let rows = (data ?? []) as CompetitorSummary[];
  if (params.market) rows = rows.filter((r) => r.market === params.market);
  if (params.platform) rows = rows.filter((r) => r.platform === params.platform);
  if (params.tier) rows = rows.filter((r) => r.tier === params.tier);

  const sortKey = (params.sort ?? "followers_current") as keyof CompetitorSummary;
  const dir = params.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  function sortLink(key: string, label: string) {
    const nextDir = sortKey === key && dir === -1 ? "asc" : "desc";
    const qs = new URLSearchParams({ ...(params.market ? { market: params.market } : {}), ...(params.platform ? { platform: params.platform } : {}), ...(params.tier ? { tier: params.tier } : {}), sort: key, dir: nextDir });
    return (
      <a href={`/competitors?${qs.toString()}`} className="hover:text-text">
        {label}
        {sortKey === key ? (dir === -1 ? " ↓" : " ↑") : ""}
      </a>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-sm font-semibold text-text">Competitors</h1>
          <p className="text-xs text-dim">{rows.length} account(s)</p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <select name="market" defaultValue={params.market ?? ""} className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text">
            <option value="">All markets</option>
            {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select name="platform" defaultValue={params.platform ?? ""} className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text">
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select name="tier" defaultValue={params.tier ?? ""} className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text">
            <option value="">All tiers</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">Apply</button>
        </form>
      </div>

      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-2 font-medium">Handle</th>
              <th className="px-2 py-2 font-medium">Tier</th>
              <th className="px-2 py-2 font-medium">Market</th>
              <th className="px-2 py-2 font-medium text-right">{sortLink("followers_current", "Followers")}</th>
              <th className="px-2 py-2 font-medium text-right">{sortLink("follower_change_30d", "Δ30d")}</th>
              <th className="px-2 py-2 font-medium text-right">{sortLink("posts_collected", "Posts")}</th>
              <th className="px-2 py-2 font-medium text-right">{sortLink("posts_per_week", "Posts/wk")}</th>
              <th className="px-2 py-2 font-medium text-right">{sortLink("median_vpf", "Median VPF")}</th>
              <th className="px-2 py-2 font-medium">Active</th>
              <th className="px-2 py-2 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.active && isOverdue(r.last_scraped_at, r.tier, null);
              return (
                <tr key={r.competitor_id} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                  <td className="px-2 py-2">
                    <Link href={`/competitors/${r.handle}`} className="font-medium text-brand hover:underline">{r.handle}</Link>
                    <div className="text-faint">{r.name} · {r.platform}</div>
                  </td>
                  <td className="px-2 py-2"><Badge tone="brand">{r.tier}</Badge></td>
                  <td className="px-2 py-2 text-dim">{r.market}</td>
                  <td className="px-2 py-2 text-right">{formatNumber(r.followers_current)}</td>
                  <td className="px-2 py-2 text-right text-dim">{formatChange(r.follower_change_30d)}</td>
                  <td className="px-2 py-2 text-right">{r.posts_collected}</td>
                  <td className="px-2 py-2 text-right text-dim">{r.posts_per_week ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-medium">{formatVpf(r.median_vpf)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={r.active ? "good" : "neutral"}>{r.active ? "active" : "inactive"}</Badge>
                    {overdue && <span className="ml-1"><Badge tone="bad">overdue</Badge></span>}
                    {r.low_median_flag && <span className="ml-1"><Badge tone="warn">low median</Badge></span>}
                  </td>
                  <td className="px-2 py-2 text-dim">{formatDate(r.last_activity_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
