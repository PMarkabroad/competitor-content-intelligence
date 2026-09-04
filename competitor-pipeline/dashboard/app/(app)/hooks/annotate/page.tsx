import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { formatVpf } from "@/lib/format";
import { AnnotateRow } from "./AnnotateRow";

export const dynamic = "force-dynamic";

interface Row {
  hook_id: string;
  post_id: string;
  opening_line: string | null;
  hook_pattern: string | null;
  narrative_structure: string | null;
  outlier_score: number | null;
  why_it_performed: string | null;
  brand_fit: string | null;
  competitors: { name: string; market: string } | null;
}

export default async function AnnotatePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const params = await searchParams;
  const showAll = params.show === "all";
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("hook_library")
    .select(
      "hook_id, post_id, opening_line, hook_pattern, narrative_structure, outlier_score, why_it_performed, brand_fit, competitors(name, market)"
    )
    .order("outlier_score", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  // brand_fit 'no' is excluded: those can never become an Ark video, so
  // writing an analyst note on one is work that leads nowhere.
  const all = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.brand_fit !== "no" && (r.opening_line ?? "").trim().length > 0
  );
  const done = all.filter((r) => (r.why_it_performed ?? "").trim().length > 0).length;

  // Strongest first, and only the top 20 by default. The scores are steeply
  // distributed -- the tail is hooks nobody will build on, and presenting
  // all 82 at once is how a list like this stops getting used at all.
  const TOP_N = 20;
  const rows = showAll ? all : all.slice(0, TOP_N);

  return (
    <div className="p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-text">Why these worked</h1>
        <span className="text-xs text-dim tabular-nums">
          {done} of {all.length} written
        </span>
      </div>
      <p className="mb-5 max-w-2xl text-xs leading-relaxed text-dim">
        The one field nothing else fills in. Every draft you generate gets this note as
        analyst context, and the monthly report can only describe structure until it exists.
        Write the mechanism, not a summary — what the line does to someone in the first two
        seconds. Saves as you move to the next box.
      </p>

      <div className="mb-5 flex items-center gap-2 text-xs">
        <Link
          href="/hooks/annotate"
          className={`rounded-md border px-2.5 py-1.5 ${!showAll ? "border-brand text-brand" : "border-border text-dim"}`}
        >
          Top {TOP_N}
        </Link>
        <Link
          href="/hooks/annotate?show=all"
          className={`rounded-md border px-2.5 py-1.5 ${showAll ? "border-brand text-brand" : "border-border text-dim"}`}
        >
          All {all.length}
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="panel p-4 text-xs text-faint">No hooks to annotate yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.hook_id} className="panel p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                <span className="font-medium text-dim">{r.competitors?.name ?? "(unknown)"}</span>
                {r.competitors?.market && <span>{r.competitors.market}</span>}
                {r.hook_pattern && <span>{r.hook_pattern.replace(/_/g, " ")}</span>}
                {r.outlier_score != null && (
                  <span className="num text-brand tabular-nums">{formatVpf(r.outlier_score)}x</span>
                )}
                <Link href={`/reels/${r.post_id}`} className="ml-auto underline-offset-2 hover:underline">
                  full analysis
                </Link>
              </div>
              <p className="text-sm leading-snug text-text">{r.opening_line}</p>
              {r.narrative_structure && (
                <p className="mt-1 text-[11px] leading-snug text-faint">{r.narrative_structure}</p>
              )}
              <AnnotateRow hookId={r.hook_id} initial={r.why_it_performed} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
