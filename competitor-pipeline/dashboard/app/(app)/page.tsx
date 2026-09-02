import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatVpf, formatScore } from "@/lib/format";
import { CompetitorPerformanceChart, type ChartRow } from "@/components/CompetitorPerformanceChart";

export const dynamic = "force-dynamic";

const TOP_N = 10;

export default async function DashboardHome() {
  const supabase = getSupabaseServerClient();

  const { data: summary, error: summaryError } = await supabase.from("v_competitor_summary").select("*");
  if (summaryError) console.error("Failed to load v_competitor_summary:", summaryError);
  const competitors = summary ?? [];

  const topByVpf = [...competitors]
    .filter((c) => c.median_vpf !== null)
    .sort((a, b) => (b.median_vpf ?? 0) - (a.median_vpf ?? 0))
    .slice(0, TOP_N);

  const chartData: ChartRow[] = topByVpf.map((c) => ({
    handle: c.handle,
    market: c.market,
    medianVpf: c.median_vpf ?? 0,
  }));

  // Each top competitor's single best-performing post, so the list below
  // the chart shows exactly what "performing well" looks like for them.
  const topIds = topByVpf.map((c) => c.competitor_id);
  const { data: outlierRows } = topIds.length
    ? await supabase
        .from("v_outliers")
        .select("post_id, competitor_id, outlier_score, views, vpf")
        .in("competitor_id", topIds)
        .order("outlier_score", { ascending: false })
    : { data: [] as { post_id: string; competitor_id: string; outlier_score: number; views: number; vpf: number }[] };

  const bestPostByCompetitor = new Map<string, { post_id: string; outlier_score: number; views: number; vpf: number }>();
  for (const row of outlierRows ?? []) {
    if (!bestPostByCompetitor.has(row.competitor_id)) bestPostByCompetitor.set(row.competitor_id, row);
  }
  const bestPostIds = Array.from(bestPostByCompetitor.values()).map((r) => r.post_id);
  const { data: posts } = bestPostIds.length
    ? await supabase.from("competitor_posts").select("post_id, caption, post_url").in("post_id", bestPostIds)
    : { data: [] as { post_id: string; caption: string | null; post_url: string | null }[] };
  const postById = new Map((posts ?? []).map((p) => [p.post_id, p]));

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Top competitors</h1>
      <p className="mb-4 text-xs text-faint">Ranked by median views-per-follower -- who's actually performing, not just who's biggest.</p>

      <div className="panel mb-4 p-4">
        <h2 className="mb-3 text-xs font-semibold text-faint">Median views-per-follower, top 10 competitors</h2>
        {chartData.length === 0 ? (
          <p className="text-xs text-faint">Not enough data yet.</p>
        ) : (
          <CompetitorPerformanceChart data={chartData} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        {topByVpf.map((c, i) => {
          const best = bestPostByCompetitor.get(c.competitor_id);
          const post = best ? postById.get(best.post_id) : null;
          return (
            <div key={c.competitor_id} className="panel flex items-start gap-4 p-4">
              <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold text-faint">#{i + 1}</span>
              <div className="w-48 shrink-0">
                <Link href={`/competitors/${c.handle}`} className="text-sm font-medium text-brand hover:underline">
                  {c.handle}
                </Link>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone="neutral">{c.market}</Badge>
                  <span className="text-[11px] text-faint">median vpf {formatVpf(c.median_vpf)}</span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {post ? (
                  <>
                    <p className="truncate text-xs text-dim">{post.caption ?? "No caption"}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
                      {best && <span className="font-medium text-brand">{formatScore(best.outlier_score)} outlier</span>}
                      {best && <span>{formatNumber(best.views)} views</span>}
                      {post.post_url && (
                        <a href={post.post_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          Original post →
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-faint">No outlier post recorded yet for this competitor.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
