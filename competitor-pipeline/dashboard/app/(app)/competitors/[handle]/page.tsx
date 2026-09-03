import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { LineChart } from "@/components/LineChart";
import { SortablePostsTable, type PostRow } from "@/components/SortablePostsTable";
import { formatNumber, formatVpf, formatDate, formatChange } from "@/lib/format";
import { resolveBand } from "@/lib/bands";

export const dynamic = "force-dynamic";

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const supabase = getSupabaseServerClient();

  const { data: competitor, error } = await supabase
    .from("competitors")
    .select("*")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(`Failed to load competitor: ${error.message}`);
  if (!competitor) notFound();

  const { data: summary } = await supabase
    .from("v_competitor_summary")
    .select("*")
    .eq("competitor_id", competitor.competitor_id)
    .maybeSingle();

  const [{ data: snapshots, error: snapError }, { data: posts, error: postsError }, { data: baseline }, { data: outliers }] =
    await Promise.all([
      supabase
        .from("competitor_snapshots")
        .select("scraped_at, followers")
        .eq("competitor_id", competitor.competitor_id)
        .order("scraped_at", { ascending: true }),
      supabase
        .from("competitor_posts")
        .select("post_id, post_url, post_type, posted_at, views, likes, comments, followers_at_scrape, paid_partnership, is_repost")
        .eq("competitor_id", competitor.competitor_id)
        .order("posted_at", { ascending: false }),
      supabase
        .from("v_competitor_baseline")
        .select("baseline_median_vpf, posts_in_window")
        .eq("competitor_id", competitor.competitor_id)
        .maybeSingle(),
      supabase
        .from("v_outliers")
        .select("post_id, outlier_score")
        .eq("competitor_id", competitor.competitor_id),
    ]);
  if (snapError) throw new Error(`Failed to load competitor_snapshots: ${snapError.message}`);
  if (postsError) throw new Error(`Failed to load competitor_posts: ${postsError.message}`);

  const outlierByPost = new Map((outliers ?? []).map((o) => [o.post_id, o.outlier_score]));
  const postRows: PostRow[] = (posts ?? []).map((p) => ({
    ...p,
    vpf: p.followers_at_scrape ? (p.views ?? 0) / p.followers_at_scrape : null,
    outlier_score: outlierByPost.get(p.post_id) ?? null,
  }));

  const bestPosts = [...postRows].filter((p) => p.outlier_score !== null).sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0)).slice(0, 3);

  const latestFollowers = snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1].followers : null;
  const band = resolveBand(latestFollowers);

  const followerPoints = (snapshots ?? [])
    .filter((s) => s.followers !== null)
    .map((s) => ({ label: formatDate(s.scraped_at), value: s.followers as number }));

  const viewsPoints = [...(posts ?? [])]
    .filter((p) => p.views !== null && p.posted_at !== null)
    .sort((a, b) => new Date(a.posted_at!).getTime() - new Date(b.posted_at!).getTime())
    .map((p) => ({ label: formatDate(p.posted_at), value: p.views as number }));

  return (
    <div className="p-4">
      <div className="mb-4">
        <h1 className="text-sm font-semibold text-text">
          {competitor.name} <span className="font-normal text-dim">@{competitor.handle}</span>
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="brand">{competitor.tier}</Badge>
          <Badge tone="neutral">{competitor.market}</Badge>
          <Badge tone="neutral">{competitor.platform}</Badge>
          <Badge tone={competitor.active ? "good" : "neutral"}>{competitor.active ? "active" : "inactive"}</Badge>
          <Badge tone={competitor.handle_verified ? "good" : "warn"}>{competitor.handle_verified ? "verified" : "unverified"}</Badge>
          {competitor.low_median_flag && <Badge tone="warn">low median</Badge>}
          <span className="text-faint">band: {band.name}</span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3">
        <div className="panel p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">Followers</p>
          <p className="text-lg font-semibold text-text">{formatNumber(summary?.followers_current ?? latestFollowers)}</p>
          <p className="text-[11px] text-dim">{formatChange(summary?.follower_change_30d)} (30d)</p>
        </div>
        <div className="panel p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">Posting frequency</p>
          <p className="text-lg font-semibold text-text">{summary?.posts_per_week ?? "—"}<span className="ml-1 text-xs font-normal text-dim">/week</span></p>
        </div>
        <div className="panel p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">Median VPF</p>
          <p className="text-lg font-semibold text-text">{formatVpf(baseline?.baseline_median_vpf)}</p>
        </div>
        <div className="panel p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">Total posts</p>
          <p className="text-lg font-semibold text-text">{postRows.length}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Follower history</h2>
          <LineChart points={followerPoints} emptyMessage="No snapshot history yet." formatValue={(v) => formatNumber(v)} />
        </div>
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Views over time</h2>
          <LineChart points={viewsPoints} emptyMessage="No posts with view data yet." formatValue={(v) => formatNumber(v)} tone="good" />
        </div>
      </div>

      {bestPosts.length > 0 && (
        <div className="mb-4 panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Best-performing content</h2>
          <div className="grid grid-cols-3 gap-3">
            {bestPosts.map((p) => (
              <Link key={p.post_id} href={`/reels/${p.post_id}`} className="block rounded-md border border-border p-3 transition-colors hover:bg-surface-hover">
                <p className="num mb-1 text-lg font-semibold text-brand">{p.outlier_score?.toFixed(1)}x</p>
                <p className="text-[11px] text-dim">{formatDate(p.posted_at)} · {formatNumber(p.views)} views</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-2 text-xs font-semibold text-faint">Posts ({postRows.length})</h2>
      <SortablePostsTable posts={postRows} />
    </div>
  );
}
