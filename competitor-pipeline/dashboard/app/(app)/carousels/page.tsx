import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatNumber, formatScore, formatDate } from "@/lib/format";
import { MIN_CAROUSELS_FOR_BASELINE, thinBaseline } from "@/lib/carousels";
import { categoryLabel } from "@/lib/categories";

export const dynamic = "force-dynamic";

interface CarouselRow {
  post_id: string;
  competitor_id: string;
  posted_at: string;
  post_url: string | null;
  likes: number | null;
  comments: number | null;
  followers: number | null;
  epf: number;
  comment_bait: boolean;
  comment_to_like: number | null;
  baseline_median_epf: number;
  carousels_in_window: number;
  carousel_score: number;
}

/**
 * Carousels that beat their own account's carousel normal.
 *
 * A separate page from /outliers on purpose. That one ranks video by views
 * per follower; Instagram reports no view count for a carousel at all, so
 * these are ranked on engagement per follower instead. The two numbers are
 * not comparable and are never shown in one column -- see migration
 * 019_carousel_scoring.sql.
 */
export default async function CarouselsPage() {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("v_carousel_outliers")
    .select("*")
    .order("carousel_score", { ascending: false });
  if (error) throw new Error(`Failed to load v_carousel_outliers: ${error.message}`);

  const rows = (data ?? []) as CarouselRow[];
  const postIds = rows.map((r) => r.post_id);
  const competitorIds = Array.from(new Set(rows.map((r) => r.competitor_id)));

  const [{ data: posts }, { data: competitors }] = await Promise.all([
    postIds.length > 0
      ? supabase.from("competitor_posts").select("post_id, caption").in("post_id", postIds)
      : Promise.resolve({ data: [] as { post_id: string; caption: string | null }[] }),
    competitorIds.length > 0
      ? supabase
          .from("competitors")
          .select("competitor_id, name, market, category")
          .in("competitor_id", competitorIds)
      : Promise.resolve({
          data: [] as { competitor_id: string; name: string; market: string; category: string | null }[],
        }),
  ]);

  const postById = new Map((posts ?? []).map((p) => [p.post_id, p]));
  const competitorById = new Map((competitors ?? []).map((c) => [c.competitor_id, c]));

  return (
    <div className="p-3 sm:p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Carousels that worked</h1>
      <p className="mb-1 text-xs text-dim">
        {rows.length} carousel(s) that beat their own account&rsquo;s carousel median by 2x or more.
      </p>
      <p className="mb-4 max-w-3xl text-xs text-faint">
        Instagram reports no view count for a carousel, so these cannot be scored on views per
        follower the way reels are on{" "}
        <a href="/outliers" className="underline decoration-border underline-offset-2 hover:decoration-text">
          the video ranking
        </a>
        . They are scored on engagement per follower instead &mdash; likes plus comments weighted
        10x, against the same account&rsquo;s own carousel median. The two scores measure different
        things and are deliberately never mixed into one league table.
      </p>

      {rows.length === 0 ? (
        <p className="panel p-3 text-xs text-dim">
          No carousel is 2x clear of its account&rsquo;s median yet. An account needs at least{" "}
          {MIN_CAROUSELS_FOR_BASELINE} carousels in the last 90 days before it has a median to be
          measured against.
        </p>
      ) : (
        <div className="overflow-x-auto panel">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface text-faint">
                <th className="px-2 py-1.5 font-medium">Competitor</th>
                <th className="px-2 py-1.5 font-medium">First line</th>
                <th className="px-2 py-1.5 font-medium">Posted</th>
                <th className="px-2 py-1.5 font-medium text-right">Likes</th>
                <th className="px-2 py-1.5 font-medium text-right">Comments</th>
                <th className="px-2 py-1.5 font-medium text-right">Score</th>
                <th className="px-2 py-1.5 font-medium">Baseline</th>
                <th className="px-2 py-1.5 font-medium">Flags</th>
                <th className="px-2 py-1.5 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const post = postById.get(row.post_id);
                const competitor = competitorById.get(row.competitor_id);
                // The caption's first line IS the carousel's hook -- it is
                // what shows beside the cover slide and decides the swipe --
                // so it is what the table shows, not the whole caption.
                const line =
                  String(post?.caption ?? "")
                    .split("\n")
                    .map((l) => l.trim())
                    .find((l) => l.length > 0) ?? "—";
                const thin = thinBaseline(row.carousels_in_window);
                return (
                  <tr key={row.post_id} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                    <td className="px-2 py-1.5">
                      <span className="font-medium text-text">{competitor?.name ?? "—"}</span>
                      <div className="text-faint">
                        {competitor?.market} / {categoryLabel(competitor?.category)}
                      </div>
                    </td>
                    <td className="max-w-80 truncate px-2 py-1.5 text-dim">{line}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(row.posted_at)}</td>
                    <td className="num px-2 py-1.5 text-right">{formatNumber(row.likes)}</td>
                    <td className="num px-2 py-1.5 text-right">{formatNumber(row.comments)}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold text-brand">
                      {formatScore(row.carousel_score)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {/* The count is always visible, not just when it's
                          thin: "4 carousels" next to a 10x score is the
                          context that stops the score being read as settled. */}
                      {thin ? (
                        <Badge tone="warn">thin &mdash; {row.carousels_in_window} carousels</Badge>
                      ) : (
                        <span className="text-faint">{row.carousels_in_window} carousels</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.comment_bait && (
                        <Badge tone="neutral">
                          comment-gated
                          {row.comment_to_like != null && ` · ${(row.comment_to_like * 100).toFixed(0)}%`}
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.post_url && (
                        <a
                          href={row.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-text underline decoration-border underline-offset-2 hover:decoration-text"
                        >
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
      )}

      <div className="mt-4 max-w-3xl space-y-2 text-xs text-faint">
        <p>
          <span className="font-medium text-dim">Thin baseline.</span> A median built on exactly{" "}
          {MIN_CAROUSELS_FOR_BASELINE} or {MIN_CAROUSELS_FOR_BASELINE + 1} carousels is two or three
          posts wearing a statistic&rsquo;s clothes. Those rows are flagged rather than hidden
          &mdash; the post may well be worth copying, but the multiple beside it is not yet firm.
        </p>
        <p>
          <span className="font-medium text-dim">Comment-gated.</span> &ldquo;Comment WORD and
          I&rsquo;ll send it&rdquo; measures interest in the thing behind the gate, not in the post.
          These run an 11.7% median comment-to-like ratio against 2.5% for everything else, so they
          are excluded from the median that defines normal &mdash; but still ranked against it,
          because they did outperform and the device is worth seeing.
        </p>
      </div>
    </div>
  );
}
