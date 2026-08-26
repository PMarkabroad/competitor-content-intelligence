import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";

// Without this, Next statically prerenders this page at build time (no
// dynamic API like searchParams/cookies forces it otherwise, since a
// Supabase call isn't Next's own fetch()) -- it would serve whatever the
// roster looked like at the last `next build` forever, not live data.
export const dynamic = "force-dynamic";
import { Badge } from "@/components/Badge";
import { formatNumber, formatDate, daysSince } from "@/lib/format";
import { isOverdue, expectedCadenceDays } from "@/lib/cadence";

interface Competitor {
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
  scrape_cadence: string | null;
}

const TIERS = ["T1", "T2", "T3"];

export default async function RosterPage() {
  const supabase = getSupabaseServerClient();

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("competitor_id, name, handle, platform, tier, market, active, handle_verified, low_median_flag, last_scraped_at, scrape_cadence")
    .order("tier")
    .order("market")
    .order("name");
  if (error) throw new Error(`Failed to load competitors: ${error.message}`);

  const rows = (competitors ?? []) as Competitor[];
  const ids = rows.map((r) => r.competitor_id);

  // Latest snapshot per competitor -- Supabase JS has no DISTINCT ON, so
  // fetch ordered-desc and keep the first hit per competitor_id. Small
  // scale (a few dozen competitors at most) makes this fine client-side.
  const followersByCompetitor = new Map<string, number | null>();
  if (ids.length > 0) {
    const { data: snapshots, error: snapError } = await supabase
      .from("competitor_snapshots")
      .select("competitor_id, followers, scraped_at")
      .in("competitor_id", ids)
      .order("scraped_at", { ascending: false });
    if (snapError) throw new Error(`Failed to load competitor_snapshots: ${snapError.message}`);
    for (const s of snapshots ?? []) {
      if (!followersByCompetitor.has(s.competitor_id)) {
        followersByCompetitor.set(s.competitor_id, s.followers);
      }
    }
  }

  const postCountByCompetitor = new Map<string, number>();
  if (ids.length > 0) {
    const { data: posts, error: postsError } = await supabase
      .from("competitor_posts")
      .select("competitor_id")
      .in("competitor_id", ids);
    if (postsError) throw new Error(`Failed to load competitor_posts: ${postsError.message}`);
    for (const p of posts ?? []) {
      postCountByCompetitor.set(p.competitor_id, (postCountByCompetitor.get(p.competitor_id) ?? 0) + 1);
    }
  }

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Roster</h1>
      <p className="mb-4 text-xs text-[var(--color-text-dim)]">{rows.length} competitor(s), grouped by tier and market.</p>

      {TIERS.map((tier) => {
        const tierRows = rows.filter((r) => r.tier === tier);
        if (tierRows.length === 0) return null;
        const markets = Array.from(new Set(tierRows.map((r) => r.market))).sort();

        return (
          <div key={tier} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              {tier} <span className="normal-case text-[var(--color-text-dim)]">({tierRows.length})</span>
            </h2>
            {markets.map((market) => {
              const marketRows = tierRows.filter((r) => r.market === market);
              return (
                <div key={market} className="mb-3 overflow-x-auto rounded border border-[var(--color-border)]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-raised)] text-[var(--color-text-faint)]">
                        <th className="px-2 py-1.5 font-medium">{market}</th>
                        <th className="px-2 py-1.5 font-medium">Platform</th>
                        <th className="px-2 py-1.5 font-medium text-right">Followers</th>
                        <th className="px-2 py-1.5 font-medium">Active</th>
                        <th className="px-2 py-1.5 font-medium">Verified</th>
                        <th className="px-2 py-1.5 font-medium">Low median</th>
                        <th className="px-2 py-1.5 font-medium">Last scraped</th>
                        <th className="px-2 py-1.5 font-medium text-right">Posts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketRows.map((row) => {
                        const overdue = row.active && isOverdue(row.last_scraped_at, row.tier, row.scrape_cadence);
                        const since = daysSince(row.last_scraped_at);
                        return (
                          <tr key={row.competitor_id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-hover)]">
                            <td className="px-2 py-1.5">
                              <Link href={`/roster/${row.handle}`} className="font-medium text-[var(--color-brand)] hover:underline">
                                {row.handle}
                              </Link>
                              <div className="text-[var(--color-text-faint)]">{row.name}</div>
                            </td>
                            <td className="px-2 py-1.5 text-[var(--color-text-dim)]">{row.platform}</td>
                            <td className="px-2 py-1.5 text-right">{formatNumber(followersByCompetitor.get(row.competitor_id))}</td>
                            <td className="px-2 py-1.5">
                              <Badge tone={row.active ? "good" : "neutral"}>{row.active ? "active" : "inactive"}</Badge>
                            </td>
                            <td className="px-2 py-1.5">
                              <Badge tone={row.handle_verified ? "good" : "warn"}>{row.handle_verified ? "verified" : "unverified"}</Badge>
                            </td>
                            <td className="px-2 py-1.5">{row.low_median_flag && <Badge tone="warn">low median</Badge>}</td>
                            <td className="px-2 py-1.5">
                              <span className={overdue ? "text-[var(--color-bad)]" : "text-[var(--color-text-dim)]"}>
                                {formatDate(row.last_scraped_at)}
                                {row.active && (
                                  <span className="ml-1 text-[10px]">
                                    ({since === null ? "never" : `${since}d ago`}, expects every {expectedCadenceDays(row.tier, row.scrape_cadence)}d)
                                  </span>
                                )}
                              </span>
                              {overdue && <span className="ml-1"><Badge tone="bad">overdue</Badge></span>}
                            </td>
                            <td className="px-2 py-1.5 text-right">{postCountByCompetitor.get(row.competitor_id) ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
