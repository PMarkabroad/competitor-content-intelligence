import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatScore, formatVpf, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

interface HookRow {
  hook_id: string;
  post_id: string;
  hook_pattern: string | null;
  format: string | null;
  topic_slug: string | null;
  opening_line: string | null;
  outlier_score: number | null;
  vpf: number | null;
  au_transplant: string | null;
  transplant_note: string | null;
  brand_fit: string | null;
  brand_fit_note: string | null;
  tagged_at: string;
  competitor_posts: { post_url: string | null } | null;
  competitors: { name: string; market: string } | null;
}

const TOPIC_SLUGS = [
  "linkedin-networking", "interview-performance", "resume-not-working", "no-local-experience",
  "volume-no-results", "visa-time-pressure", "no-callbacks", "visa-pr-blocker",
];
const HOOK_PATTERNS = [
  "contrarian_inversion", "cost_accounting", "empathy_pivot", "subdivision_teaching",
  "receipt", "direct_question", "cold_open_story",
];
const BRAND_FIT_TONE: Record<string, "good" | "warn" | "bad"> = { yes: "good", with_changes: "warn", no: "bad" };

export default async function HooksPage({
  searchParams,
}: {
  searchParams: Promise<{ topic_slug?: string; hook_pattern?: string; brand_fit?: string; showNo?: string }>;
}) {
  const params = await searchParams;
  const showNo = params.showNo === "1";

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from("hook_library")
    .select(
      "hook_id, post_id, hook_pattern, format, topic_slug, opening_line, outlier_score, vpf, au_transplant, transplant_note, brand_fit, brand_fit_note, tagged_at, competitor_posts(post_url), competitors(name, market)"
    )
    .order("outlier_score", { ascending: false });

  if (params.topic_slug) query = query.eq("topic_slug", params.topic_slug);
  if (params.hook_pattern) query = query.eq("hook_pattern", params.hook_pattern);
  if (params.brand_fit) query = query.eq("brand_fit", params.brand_fit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const allRows = (data ?? []) as unknown as HookRow[];
  const rows = showNo ? allRows : allRows.filter((r) => r.brand_fit !== "no");
  const hiddenCount = allRows.length - rows.length;

  const postIds = rows.map((r) => r.post_id);
  const transcriptByPost = new Map<string, string>();
  if (postIds.length > 0) {
    const { data: transcripts } = await supabase
      .from("competitor_transcripts")
      .select("post_id, transcript")
      .in("post_id", postIds);
    for (const t of transcripts ?? []) {
      if (t.transcript) transcriptByPost.set(t.post_id, t.transcript);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-sm font-semibold text-text">Hook library</h1>
          <p className="text-xs text-dim">
            {rows.length} hook(s){hiddenCount > 0 && !showNo ? ` · ${hiddenCount} brand_fit=no hidden` : ""}
          </p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <select name="hook_pattern" defaultValue={params.hook_pattern ?? ""} className="rounded border border-border bg-surface px-2 py-1 text-xs text-text">
            <option value="">All patterns</option>
            {HOOK_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select name="topic_slug" defaultValue={params.topic_slug ?? ""} className="rounded border border-border bg-surface px-2 py-1 text-xs text-text">
            <option value="">All topics</option>
            {TOPIC_SLUGS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="brand_fit" defaultValue={params.brand_fit ?? ""} className="rounded border border-border bg-surface px-2 py-1 text-xs text-text">
            <option value="">All brand_fit</option>
            <option value="yes">yes</option>
            <option value="with_changes">with_changes</option>
            <option value="no">no</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-dim">
            <input type="checkbox" name="showNo" value="1" defaultChecked={showNo} />
            Show brand_fit=no
          </label>
          <button type="submit" className="rounded bg-brand px-3 py-1 text-xs font-medium text-white hover:opacity-90">
            Apply
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const transcript = transcriptByPost.get(row.post_id);
          return (
            <div key={row.hook_id} className="rounded border border-border bg-surface p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-text">&ldquo;{row.opening_line}&rdquo;</p>
                <span className="shrink-0 font-mono text-sm font-semibold text-brand">{formatScore(row.outlier_score)}</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {row.hook_pattern && <Badge tone="neutral">{row.hook_pattern}</Badge>}
                {row.format && <Badge tone="neutral">{row.format}</Badge>}
                {row.topic_slug && <Badge tone="neutral">{row.topic_slug}</Badge>}
                {row.brand_fit && <Badge tone={BRAND_FIT_TONE[row.brand_fit] ?? "neutral"}>brand_fit: {row.brand_fit}</Badge>}
              </div>
              <p className="mb-1 text-xs text-dim">
                {row.competitors?.name ?? "—"} · {row.competitors?.market ?? "—"} · vpf {formatVpf(row.vpf)} · tagged {formatDate(row.tagged_at)}
              </p>
              {row.au_transplant && (
                <p className="mb-1 text-xs text-dim">
                  <span className="text-faint">au_transplant:</span> {row.au_transplant}
                  {row.transplant_note && <span className="text-faint"> — {row.transplant_note}</span>}
                </p>
              )}
              {row.brand_fit_note && (
                <p className="mb-2 text-xs text-dim">
                  <span className="text-faint">brand_fit note:</span> {row.brand_fit_note}
                </p>
              )}
              <div className="flex items-center gap-3">
                {row.competitor_posts?.post_url && (
                  <a href={row.competitor_posts.post_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                    Original post →
                  </a>
                )}
                {transcript && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-dim hover:text-text">Full transcript</summary>
                    <p className="mt-2 whitespace-pre-wrap text-dim">{transcript}</p>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
