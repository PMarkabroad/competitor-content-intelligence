import { getSupabaseServerClient } from "@/lib/supabase";
import { formatScore } from "@/lib/format";
import { shapeOf, blurbFor, cleanText } from "@/lib/shapes";

export const dynamic = "force-dynamic";

// What shape are competitors' videos, in terms a person can copy?
//
// The `format` column (talking_head / screen_walkthrough / pov) is set on
// only a fraction of rows, because format is a VISUAL property and the
// tagging runs on transcripts. `narrative_structure` is populated on
// nearly all of them and is the more useful answer anyway: "numbered list
// of five, each: belief -> correction -> instruction" tells a producer
// what to make; "talking_head" does not.
//
// Those structures are free text and never repeat verbatim, so they're
// grouped into recognisable families by keyword. The grouping is a
// convenience for scanning, not a taxonomy -- every row's real structure
// text is shown underneath so nobody has to trust the bucket.

interface Row {
  hook_id: string;
  post_id: string;
  narrative_structure: string | null;
  hook_pattern: string | null;
  outlier_score: number | null;
  brand_fit: string | null;
  competitors: { name: string; market: string } | null;
}


export default async function FormatsPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("hook_library")
    .select("hook_id, post_id, narrative_structure, hook_pattern, outlier_score, brand_fit, competitors(name, market)")
    .order("outlier_score", { ascending: false });
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.brand_fit !== "no" && cleanText(r.narrative_structure)
  );

  const grouped = new Map<string, Row[]>();
  for (const r of rows) {
    const fam = shapeOf(r.narrative_structure);
    if (!grouped.has(fam)) grouped.set(fam, []);
    grouped.get(fam)!.push(r);
  }

  const families = Array.from(grouped.entries())
    .map(([name, rs]) => ({
      name,
      rows: rs,
      count: rs.length,
      score: rs.reduce((s, r) => s + (r.outlier_score ?? 0), 0) / rs.length,
      blurb: blurbFor(name),
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="p-5">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-text">Formats they use</h1>
        <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-dim">
          The shape of {rows.length} high-performing competitor videos, grouped by how they&rsquo;re
          built. Pick a shape, then read the real structures under it to see exactly how they run.
        </p>
      </header>

      <div className="mb-8 overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-3 py-2 font-medium">Shape</th>
              <th className="px-3 py-2 font-medium">What it is</th>
              <th className="px-3 py-2 font-medium text-right">Videos</th>
              <th className="px-3 py-2 font-medium text-right">Avg score</th>
            </tr>
          </thead>
          <tbody>
            {families.map((f) => (
              <tr key={f.name} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-medium text-text">
                  <a href={`#${encodeURIComponent(f.name)}`} className="hover:underline">{f.name}</a>
                </td>
                <td className="px-3 py-2 text-dim">{f.blurb}</td>
                <td className="px-3 py-2 text-right">{f.count}</td>
                <td className="px-3 py-2 text-right font-semibold text-brand">{formatScore(f.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {families.map((f) => (
        <section key={f.name} id={f.name} className="mb-8 scroll-mt-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-text">
            {f.name}{" "}
            <span className="font-normal text-faint">
              · {f.count} {f.count === 1 ? "video" : "videos"} · {formatScore(f.score)} average
            </span>
          </h2>
          <p className="mb-3 mt-1 max-w-[70ch] text-xs text-dim">{f.blurb}</p>
          <div className="panel divide-y divide-border">
            {f.rows.slice(0, 8).map((r) => (
              <a
                key={r.hook_id}
                href={`/reels/${r.post_id}`}
                className="flex items-start gap-4 px-4 py-2.5 hover:bg-surface-hover"
              >
                <span className="w-14 shrink-0 text-right font-semibold text-brand">
                  {formatScore(r.outlier_score)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug text-text">
                    {cleanText(r.narrative_structure)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {r.competitors?.name ?? "unknown"} · {r.competitors?.market ?? "—"}
                  </span>
                </span>
              </a>
            ))}
          </div>
          {f.rows.length > 8 && (
            <p className="mt-1.5 text-[11px] text-faint">
              + {f.rows.length - 8} more in this shape
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
