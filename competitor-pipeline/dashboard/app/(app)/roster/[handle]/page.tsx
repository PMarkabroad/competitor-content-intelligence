import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { FollowerChart } from "@/components/FollowerChart";
import { SortablePostsTable, type PostRow } from "@/components/SortablePostsTable";
import { formatNumber, formatVpf, formatDate } from "@/lib/format";
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

  const latestFollowers = snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1].followers : null;
  const band = resolveBand(latestFollowers);

  const chartPoints = (snapshots ?? [])
    .filter((s) => s.followers !== null)
    .map((s) => ({ date: formatDate(s.scraped_at), followers: s.followers as number }));

  return (
    <div className="p-4">
      <div className="mb-4">
        <h1 className="text-sm font-semibold text-[var(--color-text)]">
          {competitor.name} <span className="font-normal text-[var(--color-text-dim)]">@{competitor.handle}</span>
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="brand">{competitor.tier}</Badge>
          <Badge tone="neutral">{competitor.market}</Badge>
          <Badge tone="neutral">{competitor.platform}</Badge>
          <Badge tone={competitor.active ? "good" : "neutral"}>{competitor.active ? "active" : "inactive"}</Badge>
          <Badge tone={competitor.handle_verified ? "good" : "warn"}>{competitor.handle_verified ? "verified" : "unverified"}</Badge>
          {competitor.low_median_flag && <Badge tone="warn">low median</Badge>}
          <span className="text-[var(--color-text-faint)]">band: {band.name}</span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded border border-[var(--color-border)] p-3">
          <h2 className="mb-2 text-xs font-semibold text-[var(--color-text-faint)]">Follower history</h2>
          <FollowerChart points={chartPoints} />
        </div>
        <div className="rounded border border-[var(--color-border)] p-3">
          <h2 className="mb-2 text-xs font-semibold text-[var(--color-text-faint)]">Baseline</h2>
          {baseline ? (
            <>
              <p className="text-lg font-medium text-[var(--color-text)]">{formatVpf(baseline.baseline_median_vpf)} <span className="text-xs font-normal text-[var(--color-text-dim)]">median vpf</span></p>
              <p className="text-xs text-[var(--color-text-dim)]">{baseline.posts_in_window} post(s) in the 90-day window</p>
            </>
          ) : (
            <p className="text-xs text-[var(--color-text-faint)]">No baseline yet -- needs 5+ video posts in the last 90 days.</p>
          )}
          <p className="mt-2 text-xs text-[var(--color-text-dim)]">
            Band: <span className="font-medium text-[var(--color-text)]">{band.name}</span> (min median vpf {band.minMedianVpf}, min outlier views {formatNumber(band.minOutlierViews)})
          </p>
        </div>
      </div>

      <h2 className="mb-2 text-xs font-semibold text-[var(--color-text-faint)]">Posts ({postRows.length})</h2>
      <SortablePostsTable posts={postRows} />
    </div>
  );
}
