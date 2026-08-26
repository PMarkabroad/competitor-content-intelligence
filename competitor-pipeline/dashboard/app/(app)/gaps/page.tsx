import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";
import { formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";

const MIN_TAGGED_POSTS = 50;
const MIN_MARKETS = 2;

export default async function GapsPage() {
  const supabase = getSupabaseServerClient();
  const { data: hooks, error } = await supabase
    .from("hook_library")
    .select("hook_id, post_id, topic_slug, outlier_score, brand_fit, competitor_id, competitors(market)");
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const tagged = ((hooks ?? []) as unknown as { hook_id: string; post_id: string; topic_slug: string | null; outlier_score: number | null; brand_fit: string | null; competitor_id: string; competitors: { market: string } | null }[])
    .filter((h) => h.brand_fit !== "no");
  const marketsSeen = new Set(tagged.map((h) => h.competitors?.market).filter(Boolean));

  if (tagged.length < MIN_TAGGED_POSTS || marketsSeen.size < MIN_MARKETS) {
    return (
      <GatedScreen
        title="High demand, low competition"
        requirement={`${MIN_TAGGED_POSTS} tagged posts across at least ${MIN_MARKETS} markets`}
        current={tagged.length}
        minimum={MIN_TAGGED_POSTS}
      />
    );
  }

  // "High demand" = strong average outlier_score wherever this topic has
  // been tried. "Low competition" = few distinct competitors covering it.
  // A gap is high performance + low coverage -- proven to work, nobody's
  // doing much of it yet.
  const byTopic = new Map<string, typeof tagged>();
  for (const h of tagged) {
    const key = h.topic_slug ?? "untagged";
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key)!.push(h);
  }

  const gaps = Array.from(byTopic.entries())
    .map(([topic, rows]) => {
      const avgScore = rows.reduce((sum, r) => sum + (r.outlier_score ?? 0), 0) / rows.length;
      const competitorCount = new Set(rows.map((r) => r.competitor_id)).size;
      return { topic, rows, avgScore, competitorCount };
    })
    .sort((a, b) => b.avgScore / (b.competitorCount || 1) - a.avgScore / (a.competitorCount || 1));

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">High demand, low competition</h1>
      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-2 font-medium">Topic</th>
              <th className="px-2 py-2 font-medium text-right">Avg outlier score</th>
              <th className="px-2 py-2 font-medium text-right">Competitors covering it</th>
              <th className="px-2 py-2 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.topic} className="border-b border-border last:border-b-0">
                <td className="px-2 py-2 text-text">{g.topic}</td>
                <td className="px-2 py-2 text-right font-semibold text-brand">{formatScore(g.avgScore)}</td>
                <td className="px-2 py-2 text-right">{g.competitorCount}</td>
                <td className="px-2 py-2">
                  {g.rows.slice(0, 3).map((r) => (
                    <Link key={r.hook_id} href={`/reels/${r.post_id}`} className="mr-2 text-brand hover:underline">post →</Link>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
