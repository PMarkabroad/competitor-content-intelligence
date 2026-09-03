import { getSupabaseServerClient } from "@/lib/supabase";
import { CopyDumpButton } from "@/components/CopyDumpButton";
import { GenerateDraftButton, type DraftPayload } from "@/components/GenerateDraftButton";
import { formatScore, formatNumber, formatVpf } from "@/lib/format";
import { shapeOf, cleanText } from "@/lib/shapes";

export const dynamic = "force-dynamic";

// Per-market view: top 5 (by outlier_score, tagged + raw combined) for each
// of AU/US/CA. hook_library is still sparse (see git history), so most
// cards here are "fresh signal" from v_outliers rather than fully tagged
// hooks -- both get the same Generate Ark draft action, since the API
// route works from either a transcript or just a caption.

const MARKETS = ["AU", "US", "CA"] as const;

interface TaggedRow {
  hook_id: string;
  post_id: string;
  hook_pattern: string | null;
  format: string | null;
  topic_slug: string | null;
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
  competitor_posts: { post_url: string | null; caption: string | null } | null;
  competitors: { name: string; market: string; tier: string; active: boolean } | null;
}

interface OutlierRow {
  post_id: string;
  competitor_id: string;
  views: number | null;
  vpf: number | null;
  outlier_score: number | null;
}

// Unified shape both tiers get mapped into for rendering + the draft payload.
interface Card {
  key: string;
  kind: "tagged" | "raw";
  headline: string;
  outlier_score: number | null;
  vpf: number | null;
  views: number | null;
  post_url: string | null;
  shape: string;
  structure: string | null;
  draft: StoredDraft | null;
  copyDumpText: string;
  draftPayload: DraftPayload;
}

interface StoredDraft {
  hook: string;
  script: string;
  caption: string;
}

export default async function ContentIdeasPage() {
  const supabase = getSupabaseServerClient();

  const { data: taggedData, error: taggedError } = await supabase
    .from("hook_library")
    .select(
      "hook_id, post_id, hook_pattern, format, topic_slug, content_angle, narrative_structure, cta, why_it_performed, opening_line, outlier_score, vpf, au_transplant, transplant_note, brand_fit, brand_fit_note, competitor_posts(post_url, caption), competitors(name, market, tier, active)"
    )
    .order("outlier_score", { ascending: false });
  if (taggedError) throw new Error(`Failed to load hook_library: ${taggedError.message}`);
  const taggedRows = ((taggedData ?? []) as unknown as TaggedRow[]).filter(
    (r) => r.brand_fit !== "no" && r.competitors?.active !== false
  );

  const taggedPostIds = taggedRows.map((r) => r.post_id);
  const transcriptByPost = new Map<string, string>();
  if (taggedPostIds.length > 0) {
    const { data: transcripts } = await supabase
      .from("competitor_transcripts")
      .select("post_id, transcript")
      .in("post_id", taggedPostIds);
    for (const t of transcripts ?? []) if (t.transcript) transcriptByPost.set(t.post_id, t.transcript);
  }

  // v_outliers is a VIEW -- no FK constraints of its own, so PostgREST can't
  // auto-embed competitor_posts/competitors here. Fetch plain, join in JS.
  const { data: outlierData, error: outlierError } = await supabase
    .from("v_outliers")
    .select("post_id, competitor_id, views, vpf, outlier_score")
    .order("outlier_score", { ascending: false })
    .limit(90);
  if (outlierError) throw new Error(`Failed to load v_outliers: ${outlierError.message}`);
  const outlierRows = (outlierData ?? []) as OutlierRow[];

  const outlierPostIds = outlierRows.map((r) => r.post_id);
  const outlierCompetitorIds = [...new Set(outlierRows.map((r) => r.competitor_id))];

  const postById = new Map<string, { post_url: string | null; caption: string | null }>();
  if (outlierPostIds.length > 0) {
    const { data: posts } = await supabase.from("competitor_posts").select("post_id, post_url, caption").in("post_id", outlierPostIds);
    for (const p of posts ?? []) postById.set(p.post_id, { post_url: p.post_url, caption: p.caption });
  }
  const competitorById = new Map<string, { name: string; market: string }>();
  if (outlierCompetitorIds.length > 0) {
    const { data: comps } = await supabase.from("competitors").select("competitor_id, name, market").in("competitor_id", outlierCompetitorIds);
    for (const c of comps ?? []) competitorById.set(c.competitor_id, { name: c.name, market: c.market });
  }

  // Drafts already generated for these posts, so a card can show the
  // finished draft instead of a button that makes you wait. Newest wins
  // if a post was drafted more than once.
  const draftByPostId = new Map<string, StoredDraft>();
  const { data: existingDrafts } = await supabase
    .from("generated_drafts")
    .select("source_post_id, hook, script, caption, created_at")
    .not("source_post_id", "is", null)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false });
  for (const d of existingDrafts ?? []) {
    if (d.source_post_id && !draftByPostId.has(d.source_post_id)) {
      draftByPostId.set(d.source_post_id, { hook: d.hook, script: d.script, caption: d.caption });
    }
  }

  // Build unified cards per market.
  const cardsByMarket: Record<string, Card[]> = { AU: [], US: [], CA: [] };

  for (const row of taggedRows) {
    const market = row.competitors?.market;
    if (!market || !(market in cardsByMarket)) continue;
    const transcript = transcriptByPost.get(row.post_id) ?? null;
    const competitorName = row.competitors?.name ?? "Unknown";
    const dumpLines: string[] = [
      `${competitorName} (${market}, ${row.competitors?.tier ?? "—"}) — ${row.hook_pattern ?? "—"} / ${row.format ?? "—"}`,
    ];
    if (row.opening_line) dumpLines.push(`"${row.opening_line}"`);
    dumpLines.push("");
    if (row.why_it_performed) dumpLines.push(`Why it worked: ${row.why_it_performed}`);
    if (row.au_transplant) dumpLines.push(`For Ark (${row.au_transplant}): ${row.transplant_note ?? "—"}`);
    if (transcript) { dumpLines.push("", "Transcript:", transcript); }
    if (row.competitor_posts?.post_url) dumpLines.push("", `Original: ${row.competitor_posts.post_url}`);

    cardsByMarket[market].push({
      key: `tagged-${row.hook_id}`,
      kind: "tagged",
      headline: row.opening_line ?? row.competitor_posts?.caption ?? "—",
      outlier_score: row.outlier_score,
      vpf: row.vpf,
      views: null,
      post_url: row.competitor_posts?.post_url ?? null,
      shape: shapeOf(row.narrative_structure),
      structure: cleanText(row.narrative_structure),
      draft: draftByPostId.get(row.post_id) ?? null,
      copyDumpText: dumpLines.join("\n"),
      draftPayload: {
        competitor_name: competitorName,
        market,
        post_id: row.post_id,
        hook_pattern: row.hook_pattern,
        format: row.format,
        content_angle: row.content_angle,
        narrative_structure: row.narrative_structure,
        cta: row.cta,
        why_it_performed: row.why_it_performed,
        opening_line: row.opening_line,
        transcript,
        caption: row.competitor_posts?.caption ?? null,
        vpf: row.vpf,
        outlier_score: row.outlier_score,
      },
    });
  }

  for (const row of outlierRows) {
    const comp = competitorById.get(row.competitor_id);
    const market = comp?.market;
    if (!market || !(market in cardsByMarket)) continue;
    const post = postById.get(row.post_id);
    const competitorName = comp?.name ?? "Unknown";
    const dumpLines: string[] = [
      `${competitorName} (${market}) — outlier ${formatScore(row.outlier_score)}, ${formatNumber(row.views)} views, vpf ${formatVpf(row.vpf)}`,
    ];
    if (post?.caption) dumpLines.push("", `Caption: "${post.caption}"`);
    dumpLines.push("", "Not yet transcribed or tagged -- raw signal from scoring only.");
    if (post?.post_url) dumpLines.push(`Original: ${post.post_url}`);

    cardsByMarket[market].push({
      key: `raw-${row.post_id}`,
      kind: "raw",
      headline: post?.caption ?? "No caption",
      outlier_score: row.outlier_score,
      vpf: row.vpf,
      views: row.views,
      post_url: post?.post_url ?? null,
      shape: "Not known yet",
      structure: null,
      draft: draftByPostId.get(row.post_id) ?? null,
      copyDumpText: dumpLines.join("\n"),
      draftPayload: {
        competitor_name: competitorName,
        market,
        post_id: row.post_id,
        caption: post?.caption ?? null,
        vpf: row.vpf,
        views: row.views,
        outlier_score: row.outlier_score,
      },
    });
  }

  for (const market of MARKETS) {
    cardsByMarket[market].sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0));
    cardsByMarket[market] = cardsByMarket[market].slice(0, 5);
  }

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Content ideas</h1>
      <p className="mb-6 text-xs text-dim">Top 5 per market, ranked by outlier score. Tagged hooks and raw signal both included.</p>

      {MARKETS.map((market) => (
        <section key={market} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">
            {market} <span className="normal-case text-faint">· {cardsByMarket[market].length} of top 5</span>
          </h2>
          {cardsByMarket[market].length === 0 ? (
            <div className="panel p-4">
              <p className="text-xs text-dim">No outliers detected for {market} in the last 30 days.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {cardsByMarket[market].map((card) => (
                <div key={card.key} className="panel p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-text">
                      {card.kind === "tagged" ? `\u201C${card.headline}\u201D` : `"${card.headline.slice(0, 120)}${card.headline.length > 120 ? "\u2026" : ""}"`}
                    </p>
                    <span className="shrink-0 font-mono text-sm font-semibold text-brand">{formatScore(card.outlier_score)}</span>
                  </div>
                  <p className="mb-2 text-[11px] text-faint">
                    {card.draftPayload.competitor_name} · {market}
                    {card.views != null && ` · ${formatNumber(card.views)} views`}
                  </p>

                  {/* What to make -- the shape, then the exact running
                      order. This replaces the transplant_note paragraph
                      that used to sit here: several hundred words of
                      judgement on a card whose job is to be scanned. That
                      note is still on the reel page for anyone who wants
                      it. */}
                  <div className="mb-3 rounded-md border border-border bg-surface px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Make this as</p>
                    <p className="mt-0.5 text-xs font-medium text-text">{card.shape}</p>
                    {card.structure && (
                      <p className="mt-1 text-[11px] leading-relaxed text-dim">{card.structure}</p>
                    )}
                    {card.kind === "raw" && (
                      <p className="mt-1 text-[11px] text-warn">Not transcribed yet, so the shape is unknown.</p>
                    )}
                  </div>

                  {card.draft ? (
                    <details className="mb-2 rounded-md border border-border bg-surface">
                      <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-good">
                        Draft ready &mdash; open it
                      </summary>
                      <div className="border-t border-border px-2.5 py-2">
                        <p className="mb-1.5 text-xs font-medium text-text">{card.draft.hook}</p>
                        <p className="mb-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-dim">{card.draft.script}</p>
                        <p className="text-[11px] italic text-faint">Caption: {card.draft.caption}</p>
                      </div>
                    </details>
                  ) : (
                    <div className="mb-2">
                      <GenerateDraftButton payload={card.draftPayload} />
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2">
                    {card.post_url ? (
                      <a href={card.post_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">Original post →</a>
                    ) : <span />}
                    <CopyDumpButton text={card.copyDumpText} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}