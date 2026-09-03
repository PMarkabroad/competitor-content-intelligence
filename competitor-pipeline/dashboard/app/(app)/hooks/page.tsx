import { getSupabaseServerClient } from "@/lib/supabase";
import { formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";

// A swipe file, not an analysis screen. The only thing on a row is the
// competitor's actual opening line -- the thing you'd steal the shape of.
// The long-form judgement (transplant_note, brand_fit_note, transcripts)
// used to be printed inline on every card, which buried the hooks under
// several hundred words of prose each and made the page unscannable.
// That analysis still exists on /reels/[post_id], one click away.

interface HookRow {
  hook_id: string;
  post_id: string;
  hook_pattern: string | null;
  opening_line: string | null;
  outlier_score: number | null;
  brand_fit: string | null;
  competitors: { name: string; market: string } | null;
}

const PATTERNS = [
  "warning", "direct_question", "list", "cost_accounting", "bold_statement",
  "cold_open_story", "contrarian_inversion", "problem", "receipt", "curiosity",
  "empathy_pivot", "subdivision_teaching",
];
const MARKETS = ["AU", "US", "CA"];

// Some rows carry a literal "null" string or an empty line where the
// transcript had no clean opening sentence -- those aren't hooks, so they
// don't belong in a swipe file.
function usableLine(line: string | null): string | null {
  if (!line) return null;
  const t = line.trim().replace(/^["“”]+|["“”]+$/g, "").trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t;
}

export default async function HooksPage({
  searchParams,
}: {
  searchParams: Promise<{ hook_pattern?: string; market?: string }>;
}) {
  const params = await searchParams;
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("hook_library")
    .select("hook_id, post_id, hook_pattern, opening_line, outlier_score, brand_fit, competitors(name, market)")
    .order("outlier_score", { ascending: false });
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  let rows = (data ?? []) as unknown as HookRow[];
  // brand_fit 'no' trips a Never-ships rule, so it can never become an Ark
  // video. It stays out of the swipe file entirely rather than sitting
  // behind a toggle -- there's no reason to swipe from it.
  rows = rows.filter((r) => r.brand_fit !== "no" && usableLine(r.opening_line));
  if (params.hook_pattern) rows = rows.filter((r) => r.hook_pattern === params.hook_pattern);
  if (params.market) rows = rows.filter((r) => r.competitors?.market === params.market);

  return (
    <div className="p-5">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-text">Hook library</h1>
          <p className="mt-1 text-xs text-dim">
            {rows.length} opening lines, strongest first. Click one to see why it worked.
          </p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <select
            name="hook_pattern"
            defaultValue={params.hook_pattern ?? ""}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text"
          >
            <option value="">All patterns</option>
            {PATTERNS.map((p) => (
              <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
            ))}
          </select>
          <select
            name="market"
            defaultValue={params.market ?? ""}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text"
          >
            <option value="">All markets</option>
            {MARKETS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            Apply
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="panel px-3 py-4 text-xs text-dim">
          No hooks match that filter.
        </div>
      ) : (
        <div className="panel divide-y divide-border">
          {rows.map((row) => (
            <a
              key={row.hook_id}
              href={`/reels/${row.post_id}`}
              className="flex items-start gap-4 px-4 py-3 hover:bg-surface-hover"
            >
              <span className="w-14 shrink-0 pt-0.5 text-right font-semibold text-brand">
                {formatScore(row.outlier_score)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-text">
                  &ldquo;{usableLine(row.opening_line)}&rdquo;
                </span>
                <span className="mt-1 block text-[11px] text-faint">
                  {row.competitors?.name ?? "unknown"} · {row.competitors?.market ?? "—"}
                  {row.hook_pattern ? ` · ${row.hook_pattern.replace(/_/g, " ")}` : ""}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
