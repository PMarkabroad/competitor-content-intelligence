import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatVpf, formatScore, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

interface OutlierRow {
  post_id: string;
  competitor_id: string;
  posted_at: string;
  views: number;
  vpf: number;
  baseline_median_vpf: number;
  outlier_score: number;
}

export default async function OutliersPage() {
  const supabase = getSupabaseServerClient();

  const { data: outliers, error } = await supabase
    .from("v_outliers")
    .select("*")
    .order("outlier_score", { ascending: false });
  if (error) throw new Error(`Failed to load v_outliers: ${error.message}`);

  const rows = (outliers ?? []) as OutlierRow[];
  const postIds = rows.map((r) => r.post_id);
  const competitorIds = Array.from(new Set(rows.map((r) => r.competitor_id)));

  const [{ data: posts }, { data: competitors }, { data: transcripts }] = await Promise.all([
    postIds.length > 0
      ? supabase.from("competitor_posts").select("post_id, post_url, caption").in("post_id", postIds)
      : Promise.resolve({ data: [] as { post_id: string; post_url: string | null; caption: string | null }[] }),
    competitorIds.length > 0
      ? supabase.from("competitors").select("competitor_id, name, market, tier").in("competitor_id", competitorIds)
      : Promise.resolve({ data: [] as { competitor_id: string; name: string; market: string; tier: string }[] }),
    // v_outliers already excludes any post with a transcript (see its own
    // `not exists (select 1 from competitor_transcripts...)` clause), so
    // this will structurally always come back empty for rows that ever
    // reach this page -- kept as an explicit, correct check (not a
    // hardcoded "false") so this stays correct if that view's definition
    // ever changes, rather than silently lying if it does.
    postIds.length > 0
      ? supabase.from("competitor_transcripts").select("post_id").in("post_id", postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
  ]);

  const postById = new Map((posts ?? []).map((p) => [p.post_id, p]));
  const competitorById = new Map((competitors ?? []).map((c) => [c.competitor_id, c]));
  const transcribedPostIds = new Set((transcripts ?? []).map((t) => t.post_id));

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Transcription queue</h1>
      <p className="mb-4 text-xs text-dim">
        {rows.length} outlier(s) waiting -- this is what would be spent on next.
      </p>

      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-1.5 font-medium">Competitor</th>
              <th className="px-2 py-1.5 font-medium">Caption</th>
              <th className="px-2 py-1.5 font-medium">Posted</th>
              <th className="px-2 py-1.5 font-medium text-right">Views</th>
              <th className="px-2 py-1.5 font-medium text-right">VPF</th>
              <th className="px-2 py-1.5 font-medium text-right">Baseline VPF</th>
              <th className="px-2 py-1.5 font-medium text-right">Outlier score</th>
              <th className="px-2 py-1.5 font-medium">Transcribed</th>
              <th className="px-2 py-1.5 font-medium">Link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const post = postById.get(row.post_id);
              const competitor = competitorById.get(row.competitor_id);
              const transcribed = transcribedPostIds.has(row.post_id);
              return (
                <tr key={row.post_id} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                  <td className="px-2 py-1.5">
                    <span className="font-medium text-text">{competitor?.name ?? "—"}</span>
                    <div className="text-faint">{competitor?.market} / {competitor?.tier}</div>
                  </td>
                  <td className="max-w-72 truncate px-2 py-1.5 text-dim">{post?.caption ?? "—"}</td>
                  <td className="px-2 py-1.5">{formatDate(row.posted_at)}</td>
                  <td className="px-2 py-1.5 text-right">{formatNumber(row.views)}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatVpf(row.vpf)}</td>
                  <td className="px-2 py-1.5 text-right text-dim">{formatVpf(row.baseline_median_vpf)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-brand">{formatScore(row.outlier_score)}</td>
                  <td className="px-2 py-1.5">
                    <Badge tone={transcribed ? "good" : "neutral"}>{transcribed ? "transcribed" : "pending"}</Badge>
                  </td>
                  <td className="px-2 py-1.5">
                    {post?.post_url && (
                      <a href={post.post_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        View →
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
