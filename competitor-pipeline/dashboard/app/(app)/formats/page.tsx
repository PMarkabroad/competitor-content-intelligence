import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";
import { formatScore, formatVpf } from "@/lib/format";

export const dynamic = "force-dynamic";

const MIN_TOTAL = 30;
const MIN_PER_FORMAT = 5;

export default async function FormatsPage() {
  const supabase = getSupabaseServerClient();
  const { data: hooks, error } = await supabase.from("hook_library").select("format, outlier_score, vpf, brand_fit");
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const tagged = (hooks ?? []).filter((h) => h.brand_fit !== "no");
  const byFormat = new Map<string, { outlier_score: number | null; vpf: number | null }[]>();
  for (const h of tagged) {
    if (!h.format) continue;
    if (!byFormat.has(h.format)) byFormat.set(h.format, []);
    byFormat.get(h.format)!.push(h);
  }
  const formatsWithEnough = Array.from(byFormat.entries()).filter(([, rows]) => rows.length >= MIN_PER_FORMAT);

  if (tagged.length < MIN_TOTAL || formatsWithEnough.length === 0) {
    return (
      <GatedScreen
        title="Performance by format"
        requirement={`${MIN_TOTAL} tagged hooks, at least ${MIN_PER_FORMAT} per format shown`}
        current={tagged.length}
        minimum={MIN_TOTAL}
      />
    );
  }

  const avg = (nums: number[]) => (nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Performance by format</h1>
      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-2 font-medium">Format</th>
              <th className="px-2 py-2 font-medium text-right">Count</th>
              <th className="px-2 py-2 font-medium text-right">Avg outlier score</th>
              <th className="px-2 py-2 font-medium text-right">Avg VPF</th>
            </tr>
          </thead>
          <tbody>
            {formatsWithEnough
              .sort((a, b) => (avg(b[1].map((r) => r.outlier_score ?? 0)) ?? 0) - (avg(a[1].map((r) => r.outlier_score ?? 0)) ?? 0))
              .map(([format, rows]) => (
                <tr key={format} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-2 text-text">{format}</td>
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
