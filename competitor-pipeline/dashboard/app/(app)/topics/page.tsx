import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";
import { formatScore, formatVpf } from "@/lib/format";

export const dynamic = "force-dynamic";

const MIN_TAGGED_POSTS = 50;

export default async function TopicsPage() {
  const supabase = getSupabaseServerClient();
  const { data: hooks, error } = await supabase.from("hook_library").select("topic_slug, sub_topic, outlier_score, vpf, brand_fit");
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const tagged = (hooks ?? []).filter((h) => h.brand_fit !== "no");

  if (tagged.length < MIN_TAGGED_POSTS) {
    return (
      <GatedScreen title="Volume and performance by topic" requirement={`${MIN_TAGGED_POSTS} tagged posts`} current={tagged.length} minimum={MIN_TAGGED_POSTS} />
    );
  }

  const byTopic = new Map<string, { outlier_score: number | null; vpf: number | null }[]>();
  for (const h of tagged) {
    const key = h.topic_slug ?? "untagged";
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key)!.push(h);
  }
  const avg = (nums: number[]) => (nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

  return (
    <div className="p-3 sm:p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Volume and performance by topic</h1>
      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-2 font-medium">Topic</th>
              <th className="px-2 py-2 font-medium text-right">Volume</th>
              <th className="px-2 py-2 font-medium text-right">Avg outlier score</th>
              <th className="px-2 py-2 font-medium text-right">Avg VPF</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byTopic.entries())
              .sort((a, b) => b[1].length - a[1].length)
              .map(([topic, rows]) => (
                <tr key={topic} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-2 text-text">{topic}</td>
                  <td className="px-2 py-2 text-right">{rows.length}</td>
                  <td className="num px-2 py-2 text-right font-semibold text-brand">{formatScore(avg(rows.map((r) => r.outlier_score ?? 0)))}</td>
                  <td className="px-2 py-2 text-right">{formatVpf(avg(rows.map((r) => r.vpf ?? 0)))}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
