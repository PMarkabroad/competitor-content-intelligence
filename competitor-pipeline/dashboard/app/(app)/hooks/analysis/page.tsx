import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";
import { formatScore, formatVpf } from "@/lib/format";

export const dynamic = "force-dynamic";

const MIN_TOTAL = 30;
const MIN_PER_PATTERN = 5;

export default async function HookAnalysisPage() {
  const supabase = getSupabaseServerClient();
  const { data: hooks, error } = await supabase.from("hook_library").select("hook_pattern, outlier_score, vpf, brand_fit");
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const tagged = (hooks ?? []).filter((h) => h.brand_fit !== "no");
  const byPattern = new Map<string, { outlier_score: number | null; vpf: number | null }[]>();
  for (const h of tagged) {
    if (!h.hook_pattern) continue;
    if (!byPattern.has(h.hook_pattern)) byPattern.set(h.hook_pattern, []);
    byPattern.get(h.hook_pattern)!.push(h);
  }
  const patternsWithEnough = Array.from(byPattern.entries()).filter(([, rows]) => rows.length >= MIN_PER_PATTERN);

  if (tagged.length < MIN_TOTAL || patternsWithEnough.length === 0) {
    return (
      <GatedScreen
        title="Hook pattern analysis"
        requirement={`${MIN_TOTAL} tagged hooks, and at least ${MIN_PER_PATTERN} per pattern shown`}
        current={tagged.length}
        minimum={MIN_TOTAL}
      />
    );
  }

  const avg = (nums: number[]) => (nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Performance by hook pattern</h1>
      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-2 font-medium">Pattern</th>
              <th className="px-2 py-2 font-medium text-right">Count</th>
              <th className="px-2 py-2 font-medium text-right">Avg outlier score</th>
              <th className="px-2 py-2 font-medium text-right">Avg VPF</th>
            </tr>
          </thead>
          <tbody>
            {patternsWithEnough
              .sort((a, b) => (avg(b[1].map((r) => r.outlier_score ?? 0)) ?? 0) - (avg(a[1].map((r) => r.outlier_score ?? 0)) ?? 0))
              .map(([pattern, rows]) => (
                <tr key={pattern} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-2 text-text">{pattern}</td>
                  <td className="px-2 py-2 text-right">{rows.length}</td>
                  <td className="px-2 py-2 text-right font-semibold text-brand">{formatScore(avg(rows.map((r) => r.outlier_score ?? 0)))}</td>
                  <td className="px-2 py-2 text-right">{formatVpf(avg(rows.map((r) => r.vpf ?? 0)))}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
