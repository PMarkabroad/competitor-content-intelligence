import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { MetricCard } from "@/components/MetricCard";
import { formatNumber, formatVpf, formatScore, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const MARKETS = ["AU", "US", "CA"];
const MIN_POSTS_FOR_MEDIAN = 5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export default async function DashboardHome() {
  const supabase = getSupabaseServerClient();

  const [
    { data: summary },
    { count: postsTotal },
    { data: vpfRows },
    { count: postsThisWeek },
    { count: outlierCount },
    { data: pendingRows },
    { data: outlierRows },
  ] = await Promise.all([
    supabase.from("v_competitor_summary").select("*"),
    supabase.from("competitor_posts").select("post_id", { count: "exact", head: true }),
    supabase.from("v_post_metrics").select("vpf").not("vpf", "is", null),
    supabase
      .from("competitor_posts")
      .select("post_id", { count: "exact", head: true })
      .gte("first_seen_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    supabase.from("v_outliers").select("post_id", { count: "exact", head: true }),
    supabase.from("discovery_candidates").select("candidate_id, classification").eq("gate_result", "pass").eq("promoted", false),
    supabase.from("v_outliers").select("*").order("outlier_score", { ascending: false }).limit(5),
  ]);

  const competitors = summary ?? [];
  const { data: viewsRows } = await supabase.from("competitor_posts").select("views").not("views", "is", null);
  const sumViews = (viewsRows ?? []).reduce((sum, r) => sum + (r.views ?? 0), 0);

  const vpfValues = (vpfRows ?? []).map((r) => r.vpf as number);
  const corpusMedianVpf = median(vpfValues);

  const pendingCount = (pendingRows ?? []).filter((r) => r.classification !== "irrelevant" && r.classification !== "regulated").length;

  const byMarket = MARKETS.map((market) => {
    const rows = competitors.filter((c) => c.market === market);
    const posts = rows.reduce((sum, c) => sum + (c.posts_collected ?? 0), 0);
    const vpfs = rows.map((c) => c.median_vpf).filter((v): v is number => v !== null);
    return { market, accounts: rows.length, posts, medianVpf: median(vpfs) };
  });

  const topByVpf = [...competitors].filter((c) => c.median_vpf !== null).sort((a, b) => (b.median_vpf ?? 0) - (a.median_vpf ?? 0)).slice(0, 5);

  const topOutlierPostIds = (outlierRows ?? []).map((r) => r.post_id);
  const topOutlierCompetitorIds = Array.from(new Set((outlierRows ?? []).map((r) => r.competitor_id)));
  const [{ data: topPosts }, { data: topCompetitors }] = await Promise.all([
    topOutlierPostIds.length > 0
      ? supabase.from("competitor_posts").select("post_id, caption, post_url").in("post_id", topOutlierPostIds)
      : Promise.resolve({ data: [] as { post_id: string; caption: string | null; post_url: string | null }[] }),
    topOutlierCompetitorIds.length > 0
      ? supabase.from("competitors").select("competitor_id, name").in("competitor_id", topOutlierCompetitorIds)
      : Promise.resolve({ data: [] as { competitor_id: string; name: string }[] }),
  ]);
  const postById = new Map((topPosts ?? []).map((p) => [p.post_id, p]));
  const competitorById = new Map((topCompetitors ?? []).map((c) => [c.competitor_id, c]));

  // Recent activity: posts collected in the last 14 days, newest first.
  const { data: recentPosts } = await supabase
    .from("competitor_posts")
    .select("post_id, competitor_id, posted_at, caption, post_url, views")
    .gte("posted_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .order("posted_at", { ascending: false })
    .limit(15);
  const recentCompetitorIds = Array.from(new Set((recentPosts ?? []).map((p) => p.competitor_id)));
  const { data: recentCompetitors } = recentCompetitorIds.length > 0
    ? await supabase.from("competitors").select("competitor_id, name, market").in("competitor_id", recentCompetitorIds)
    : { data: [] as { competitor_id: string; name: string; market: string }[] };
  const recentCompetitorById = new Map((recentCompetitors ?? []).map((c) => [c.competitor_id, c]));

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Dashboard</h1>

      <div className="mb-4 grid grid-cols-3 gap-3 lg:grid-cols-6">
        <MetricCard label="Active competitors" value={competitors.length} />
        <MetricCard label="Posts collected" value={formatNumber(postsTotal ?? 0)} />
        <MetricCard label="Total views" value={formatNumber(sumViews)} />
        <MetricCard
          label="Median VPF (roster)"
          value={formatVpf(corpusMedianVpf)}
          insufficientData={vpfValues.length < MIN_POSTS_FOR_MEDIAN}
          note={vpfValues.length < MIN_POSTS_FOR_MEDIAN ? `insufficient data (${vpfValues.length} posts)` : `${vpfValues.length} posts`}
        />
        <MetricCard label="Posts added this week" value={postsThisWeek ?? 0} />
        <MetricCard label="Untranscribed outliers" value={outlierCount ?? 0} />
      </div>

      <div className="mb-4">
        <Link href="/review" className="panel block p-4 transition-colors hover:bg-surface-hover">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Review queue</p>
          <p className="text-2xl font-semibold tracking-tight text-brand">{pendingCount} candidates awaiting review →</p>
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {byMarket.map((m) => (
          <div key={m.market} className="panel p-4">
            <p className="mb-2 text-xs font-semibold text-faint">{m.market}</p>
            <div className="flex justify-between text-xs text-dim">
              <span>Accounts</span>
              <span className="font-medium text-text">{m.accounts}</span>
            </div>
            <div className="flex justify-between text-xs text-dim">
              <span>Posts</span>
              <span className="font-medium text-text">{m.posts}</span>
            </div>
            <div className="flex justify-between text-xs text-dim">
              <span>Median VPF</span>
              <span className={`font-medium ${m.medianVpf === null ? "text-faint" : "text-text"}`}>
                {m.medianVpf === null ? "insufficient data" : formatVpf(m.medianVpf)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Top 5 competitors by median VPF</h2>
          {topByVpf.length === 0 ? (
            <p className="text-xs text-faint">insufficient data</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {topByVpf.map((c) => (
                  <tr key={c.competitor_id} className="border-b border-border last:border-b-0">
                    <td className="py-1.5">
                      <Link href={`/competitors/${c.handle}`} className="text-brand hover:underline">{c.handle}</Link>
                      <span className="ml-1.5 text-faint">{c.market}</span>
                    </td>
                    <td className="py-1.5 text-right font-medium text-text">{formatVpf(c.median_vpf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Top 5 posts by outlier score</h2>
          {(outlierRows ?? []).length === 0 ? (
            <p className="text-xs text-faint">No outliers currently -- v_outliers is empty.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {(outlierRows ?? []).map((o) => {
                  const post = postById.get(o.post_id);
                  const competitor = competitorById.get(o.competitor_id);
                  return (
                    <tr key={o.post_id} className="border-b border-border last:border-b-0">
                      <td className="max-w-48 truncate py-1.5">
                        <Link href={`/reels/${o.post_id}`} className="text-brand hover:underline">
                          {competitor?.name ?? "—"}
                        </Link>
                        <span className="ml-1.5 text-faint">{post?.caption?.slice(0, 40) ?? ""}</span>
                      </td>
                      <td className="py-1.5 text-right font-semibold text-brand">{formatScore(o.outlier_score)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-2 text-xs font-semibold text-faint">Recent activity (last 14 days)</h2>
        {(recentPosts ?? []).length === 0 ? (
          <p className="text-xs text-faint">No posts collected in the last 14 days.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <tbody>
              {(recentPosts ?? []).map((p) => {
                const competitor = recentCompetitorById.get(p.competitor_id);
                return (
                  <tr key={p.post_id} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 text-dim">{formatDate(p.posted_at)}</td>
                    <td className="py-1.5">
                      <Link href={`/reels/${p.post_id}`} className="text-brand hover:underline">{competitor?.name ?? "—"}</Link>
                      <Badge tone="neutral">{competitor?.market ?? "—"}</Badge>
                    </td>
                    <td className="max-w-96 truncate py-1.5 text-dim">{p.caption}</td>
                    <td className="py-1.5 text-right text-text">{formatNumber(p.views)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
