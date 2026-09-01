import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { CopyDumpButton } from "@/components/CopyDumpButton";
import { formatScore, formatVpf, formatNumber, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// Two tiers, because hook_library is (as of writing) barely tagged --
// gating this whole screen on tagged volume, the way /recommendations
// does, would leave it empty for months. Tier A is the fully-analyzed
// path (hook_library, brand-fit checked). Tier B is v_outliers directly:
// real signal the scoring pipeline already found, just not transcribed
// or tagged by a human yet. Both are shown honestly labeled rather than
// hidden behind a volume gate.

interface TaggedIdea {
  hook_id: string;
  post_id: string;
  hook_pattern: string | null;
  format: string | null;
  topic_slug: string | null;
  sub_topic: string | null;
  content_angle: string | null;
  narrative_structure: string | null;
  cta: string | null;
  why_it_performed: string | null;
  opening_line: string | null;
  outlier_score: number | null;
  vpf: number | null;
  au_transplant: string | null;
  transplant_note: string | null;
  brand_fit: string | null;
  brand_fit_note: string | null;
  tagged_at: string;
  competitor_posts: { post_url: string | null; caption: string | null } | null;
  competitors: { name: string; market: string; tier: string } | null;
}

interface RawOutlier {
  post_id: string;
  competitor_id: string;
  posted_at: string;
  views: number | null;
  vpf: number | null;
  outlier_score: number | null;
  competitor_posts: { post_url: string | null; caption: string | null } | null;
  competitors: { name: string; market: string; handle: string } | null;
}

const BRAND_FIT_TONE: Record<string, "good" | "warn" | "bad"> = { yes: "good", with_changes: "warn", no: "bad" };

function buildTaggedDump(idea: TaggedIdea, transcript: string | null): string {
  const lines: string[] = [];
  lines.push(`${idea.competitors?.name ?? "Unknown"} (${idea.competitors?.market ?? "—"}, ${idea.competitors?.tier ?? "—"}) — ${idea.hook_pattern ?? "—"} / ${idea.format ?? "—"}`);
  if (idea.opening_line) lines.push(`"${idea.opening_line}"`);
  lines.push("");
  if (idea.why_it_performed) lines.push(`Why it worked: ${idea.why_it_performed}`);
  if (idea.content_angle) lines.push(`Angle: ${idea.content_angle}`);
  if (idea.narrative_structure) lines.push(`Structure: ${idea.narrative_structure}`);
  if (idea.cta) lines.push(`CTA: ${idea.cta}`);
  if (idea.au_transplant) {
    lines.push("");
    lines.push(`Suggested for Ark (${idea.au_transplant})${idea.transplant_note ? `: ${idea.transplant_note}` : ""}`);
  }
  if (idea.brand_fit_note) lines.push(`Brand fit note: ${idea.brand_fit_note}`);
  if (transcript) {
    lines.push("");
    lines.push("Transcript:");
    lines.push(transcript);
  }
  if (idea.competitor_posts?.post_url) {
    lines.push("");
    lines.push(`Original: ${idea.competitor_posts.post_url}`);
  }
  return lines.join("\n");
}

function buildRawDump(row: RawOutlier): string {
  const lines: string[] = [];
  lines.push(`${row.competitors?.name ?? "Unknown"} (${row.competitors?.market ?? "—"}) — outlier ${formatScore(row.outlier_score)}, ${formatNumber(row.views)} views, vpf ${formatVpf(row.vpf)}`);
  if (row.competitor_posts?.caption) {
    lines.push("");
    lines.push(`Caption: "${row.competitor_posts.caption}"`);
  }
  lines.push("");
  lines.push("Not yet transcribed or tagged -- this is raw signal from scoring only.");
  if (row.competitor_posts?.post_url) lines.push(`Original: ${row.competitor_posts.post_url}`);
  return lines.join("\n");
}

export default async function ContentIdeasPage() {
  const supabase = getSupabaseServerClient();

  const { data: taggedData, error: taggedError } = await supabase
    .from("hook_library")
    .select(
      "hook_id, post_id, hook_pattern, format, topic_slug, sub_topic, content_angle, narrative_structure, cta, why_it_performed, opening_line, outlier_score, vpf, au_transplant, transplant_note, brand_fit, brand_fit_note, tagged_at, competitor_posts(post_url, caption), competitors(name, market, tier)"
    )
    .order("outlier_score", { ascending: false });
  if (taggedError) throw new Error(`Failed to load hook_library: ${taggedError.message}`);
  // Exclude only an explicit brand_fit='no' verdict -- an untagged row
  // (brand_fit still null) stays in, same rule v_hook_report enforces.
  const taggedIdeas = ((taggedData ?? []) as unknown as TaggedIdea[]).filter((i) => i.brand_fit !== "no");

  const taggedPostIds = taggedIdeas.map((i) => i.post_id);
  const transcriptByPost = new Map<string, string>();
  if (taggedPostIds.length > 0) {
    const { data: transcripts } = await supabase
      .from("competitor_transcripts")
      .select("post_id, transcript")
      .in("post_id", taggedPostIds);
    for (const t of transcripts ?? []) {
      if (t.transcript) transcriptByPost.set(t.post_id, t.transcript);
    }
  }

  const { data: rawData, error: rawError } = await supabase
    .from("v_outliers")
    .select("post_id, competitor_id, posted_at, views, vpf, outlier_score, competitor_posts(post_url, caption), competitors(name, market, handle)")
    .order("outlier_score", { ascending: false })
    .limit(30);
  if (rawError) throw new Error(`Failed to load v_outliers: ${rawError.message}`);
  const rawOutliers = (rawData ?? []) as unknown as RawOutlier[];

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Content ideas</h1>
      <p className="mb-6 text-xs text-dim">
        {taggedIdeas.length} ready to use · {rawOutliers.length} fresh signal, not yet reviewed
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Ready to use</h2>
        {taggedIdeas.length === 0 ? (
          <div className="panel p-5">
            <p className="text-sm text-text">No tagged hooks with a brand-fit check yet.</p>
            <p className="mt-1 text-xs text-dim">
              Tag an outlier in <a href="/hooks" className="text-brand hover:underline">Hooks</a> to populate this section --
              it fills in as soon as something is tagged, no volume threshold.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {taggedIdeas.map((idea) => {
              const transcript = transcriptByPost.get(idea.post_id) ?? null;
              return (
                <div key={idea.hook_id} className="panel p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-text">&ldquo;{idea.opening_line ?? "—"}&rdquo;</p>
                    <span className="shrink-0 font-mono text-sm font-semibold text-brand">{formatScore(idea.outlier_score)}</span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {idea.hook_pattern && <Badge tone="neutral">{idea.hook_pattern}</Badge>}
                    {idea.format && <Badge tone="neutral">{idea.format}</Badge>}
                    {idea.topic_slug && <Badge tone="neutral">{idea.topic_slug}</Badge>}
                    {idea.brand_fit && <Badge tone={BRAND_FIT_TONE[idea.brand_fit] ?? "neutral"}>brand_fit: {idea.brand_fit}</Badge>}
                  </div>
                  <p className="mb-1 text-xs text-dim">
                    {idea.competitors?.name ?? "—"} · {idea.competitors?.market ?? "—"} · vpf {formatVpf(idea.vpf)} · tagged {formatDate(idea.tagged_at)}
                  </p>
                  {idea.why_it_performed && (
                    <p className="mb-2 text-xs text-dim">
                      <span className="text-faint">Why it worked:</span> {idea.why_it_performed}
                    </p>
                  )}
                  {idea.au_transplant && (
                    <p className="mb-2 text-xs text-dim">
                      <span className="text-faint">For Ark ({idea.au_transplant}):</span> {idea.transplant_note ?? "—"}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                    {idea.competitor_posts?.post_url ? (
                      <a href={idea.competitor_posts.post_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                        Original post →
                      </a>
                    ) : <span />}
                    <CopyDumpButton text={buildTaggedDump(idea, transcript)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Fresh signal — not yet reviewed</h2>
        {rawOutliers.length === 0 ? (
          <div className="panel p-5">
            <p className="text-sm text-text">No outliers detected in the last 30 days.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {rawOutliers.map((row) => (
              <div key={row.post_id} className="panel p-3 opacity-90">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm text-text">
                    {row.competitor_posts?.caption ? `"${row.competitor_posts.caption.slice(0, 140)}${row.competitor_posts.caption.length > 140 ? "…" : ""}"` : "No caption"}
                  </p>
                  <span className="shrink-0 font-mono text-sm font-semibold text-brand">{formatScore(row.outlier_score)}</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  <Badge tone="warn">not transcribed</Badge>
                </div>
                <p className="mb-2 text-xs text-dim">
                  {row.competitors?.name ?? "—"} · {row.competitors?.market ?? "—"} · {formatNumber(row.views)} views · vpf {formatVpf(row.vpf)}
                </p>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  {row.competitor_posts?.post_url ? (
                    <a href={row.competitor_posts.post_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                      Original post →
                    </a>
                  ) : <span />}
                  <CopyDumpButton text={buildRawDump(row)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}