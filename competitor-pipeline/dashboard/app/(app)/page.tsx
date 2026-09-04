import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { formatScore, formatNumber } from "@/lib/format";
import { shapeOf, cleanText } from "@/lib/shapes";

export const dynamic = "force-dynamic";

// The home screen answers two questions and nothing else: is the machine
// running, and what should we make?
//
// It used to be a single "top competitors by median views-per-follower"
// table, which answers neither -- and that table already lives on
// /competitors.
//
// The hero is the funnel, shown as one line rather than a row of identical
// stat cards. These numbers only mean anything in relation to each other:
// "66 hooks" is unremarkable alone and tells a real story next to "1,250
// posts collected". A card grid would hide exactly the thing worth seeing.

interface HookRow {
  hook_id: string;
  post_id: string;
  hook_pattern: string | null;
  narrative_structure: string | null;
  opening_line: string | null;
  outlier_score: number | null;
  brand_fit: string | null;
  competitors: { name: string; market: string; active: boolean } | null;
}

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
}

// Plain head-only counts. Written out rather than wrapped in a generic
// helper: PostgrestQueryBuilder and PostgrestFilterBuilder are different
// types, so a helper taking "a query and maybe some filters" doesn't
// typecheck without casts that hide real mistakes.
async function countRows(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  table: string
): Promise<number> {
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

// One stage of a pipeline. Rendered as a cell in a bordered strip rather
// than a floating number: seven bare figures side by side read as
// unrelated stats, which is the opposite of the point.
function Stage({
  value,
  label,
  href,
  emphasis,
}: {
  value: number;
  label: string;
  href?: string;
  emphasis?: boolean;
}) {
  const body = (
    <>
      <span
        className={`num block text-[24px] font-semibold leading-none ${
          emphasis ? "text-brand" : "text-text"
        }`}
      >
        {formatNumber(value)}
      </span>
      <span className="mt-2 block text-[11px] leading-tight text-faint">{label}</span>
    </>
  );
  return (
    <div className="flex-1 px-4 py-4 first:pl-5 last:pr-5">
      {href ? (
        <Link href={href} className="block rounded transition-opacity hover:opacity-70">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

// The two pipelines are shown separately because they ARE separate, and
// running them together was actively misleading: 981 -> 60 -> 39 is how
// many ACCOUNTS survive screening, then 1,250 -> 66 -> 66 -> 50 is what
// their CONTENT turns into. Chained on one line, the jump from 39 to 1,250
// reads as a mistake or as noise.
// Instagram and TikTok as their own rows rather than one blended total.
// The totals above answer "how big is the pipeline"; this answers "which
// platform is actually producing", which is a different question and the
// one that decides where the next account slot goes. Per-account rates are
// left out on purpose -- the two platforms were onboarded months apart, so
// dividing by account count would flatter whichever one has been running
// longer rather than saying anything about the platform.
function PlatformRows({
  stages,
}: {
  stages: { label: string; ig: number; tt: number; href?: string }[];
}) {
  const row = (name: string, key: "ig" | "tt") => (
    <tr className="border-t border-border">
      <th scope="row" className="whitespace-nowrap py-2.5 pl-4 pr-6 text-left text-[13px] font-medium text-text">
        {name}
      </th>
      {stages.map((s) => (
        <td key={s.label} className="num whitespace-nowrap px-3 py-2.5 text-right text-[13px] tabular-nums text-text">
          {formatNumber(s[key])}
        </td>
      ))}
    </tr>
  );
  return (
    <div>
      <h2 className="mb-2 text-[11px] font-medium text-faint">By platform</h2>
      {/* Scrolls inside itself on a narrow screen rather than pushing the
          page sideways. */}
      <div className="panel overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="py-2 pl-4 pr-6" />
              {stages.map((s) => (
                <th
                  key={s.label}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-normal text-faint"
                >
                  {s.href ? (
                    <Link href={s.href} className="transition-opacity hover:opacity-70">
                      {s.label}
                    </Link>
                  ) : (
                    s.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row("Instagram", "ig")}
            {row("TikTok", "tt")}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pipeline({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-[11px] font-medium text-faint">{title}</h2>
      <div className="panel flex divide-x divide-border">{children}</div>
    </div>
  );
}

export default async function HomePage() {
  const supabase = getSupabaseServerClient();

  const [screened, tracked, posts, transcripts, hookCount, drafts, pending] = await Promise.all([
    countRows(supabase, "discovery_candidates"),
    countRows(supabase, "competitors"),
    countRows(supabase, "competitor_posts"),
    countRows(supabase, "competitor_transcripts"),
    countRows(supabase, "hook_library"),
    countRows(supabase, "generated_drafts"),
    countRows(supabase, "v_outliers"),
  ]);

  // --- platform split for every stage -------------------------------
  // Counted server-side with head:true rather than fetching rows and
  // grouping them in JS. PostgREST caps an unfiltered select at 1000 rows
  // and competitor_posts is well past that, so a fetch-then-group would
  // silently under-report whichever platform sorts later.
  const { data: idRows } = await supabase.from("competitors").select("competitor_id, platform");
  const igIds = (idRows ?? []).filter((r) => r.platform === "instagram").map((r) => r.competitor_id);
  const ttIds = (idRows ?? []).filter((r) => r.platform === "tiktok").map((r) => r.competitor_id);

  const countByCompetitor = async (table: string, ids: string[]) => {
    if (ids.length === 0) return 0;
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .in("competitor_id", ids);
    return count ?? 0;
  };
  // competitor_transcripts holds only post_id, so the platform has to come
  // through competitor_posts. !inner makes it a real join rather than a
  // left join that would count every transcript regardless of the filter.
  const countTranscripts = async (ids: string[]) => {
    if (ids.length === 0) return 0;
    const { count } = await supabase
      .from("competitor_transcripts")
      .select("transcript_id, competitor_posts!inner(competitor_id)", { count: "exact", head: true })
      .in("competitor_posts.competitor_id", ids);
    return count ?? 0;
  };
  const countCandidates = async (platform: string) => {
    const { count } = await supabase
      .from("discovery_candidates")
      .select("*", { count: "exact", head: true })
      .eq("platform", platform);
    return count ?? 0;
  };
  const countCompetitors = async (platform: string, activeOnly: boolean) => {
    let q = supabase.from("competitors").select("*", { count: "exact", head: true }).eq("platform", platform);
    if (activeOnly) q = q.eq("active", true).eq("handle_verified", true);
    const { count } = await q;
    return count ?? 0;
  };

  const [
    screenedIg, screenedTt, trackedIg, trackedTt, activeIg, activeTt,
    postsIg, postsTt, trIg, trTt, hooksIg, hooksTt,
  ] = await Promise.all([
    countCandidates("instagram"), countCandidates("tiktok"),
    countCompetitors("instagram", false), countCompetitors("tiktok", false),
    countCompetitors("instagram", true), countCompetitors("tiktok", true),
    countByCompetitor("competitor_posts", igIds), countByCompetitor("competitor_posts", ttIds),
    countTranscripts(igIds), countTranscripts(ttIds),
    countByCompetitor("hook_library", igIds), countByCompetitor("hook_library", ttIds),
  ]);

  const { count: activeCountRaw } = await supabase
    .from("competitors")
    .select("*", { count: "exact", head: true })
    .eq("active", true)
    .eq("handle_verified", true);
  const activeCount = activeCountRaw ?? 0;

  const { data: compRows } = await supabase
    .from("competitors")
    .select("market, platform, active, handle_verified");
  const activeComps = (compRows ?? []).filter((c) => c.active && c.handle_verified);
  const byMarket: Record<string, number> = {};
  for (const c of activeComps) {
    byMarket[c.market] = (byMarket[c.market] ?? 0) + 1;
  }

  const { data: hookData } = await supabase
    .from("hook_library")
    .select("hook_id, post_id, hook_pattern, narrative_structure, opening_line, outlier_score, brand_fit, competitors(name, market, active)")
    .order("outlier_score", { ascending: false });
  const hooks = ((hookData ?? []) as unknown as HookRow[]).filter(
    (h) => h.brand_fit !== "no" && h.competitors?.active !== false && h.outlier_score != null
  );

  const patternScores = new Map<string, number[]>();
  const shapeScores = new Map<string, number[]>();
  for (const h of hooks) {
    if (h.hook_pattern) {
      if (!patternScores.has(h.hook_pattern)) patternScores.set(h.hook_pattern, []);
      patternScores.get(h.hook_pattern)!.push(h.outlier_score!);
    }
    const shape = shapeOf(h.narrative_structure);
    if (shape !== "Other") {
      if (!shapeScores.has(shape)) shapeScores.set(shape, []);
      shapeScores.get(shape)!.push(h.outlier_score!);
    }
  }
  const topPatterns = Array.from(patternScores.entries())
    .map(([k, v]) => ({ name: k.replace(/_/g, " "), n: v.length, score: avg(v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const topShapes = Array.from(shapeScores.entries())
    .map(([k, v]) => ({ name: k, n: v.length, score: avg(v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const topHooks = hooks.filter((h) => cleanText(h.opening_line)).slice(0, 6);

  const { data: recentDrafts } = await supabase
    .from("generated_drafts")
    .select("draft_id, hook, script, market, competitor_name, source_post_id")
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(4);

  return (
    <div className="p-5">
      {/* ---- the two pipelines ---- */}
      <section className="mb-10 grid grid-cols-1 gap-5 xl:grid-cols-[3fr_4fr]">
        <Pipeline title="Accounts">
          <Stage value={screened} label="screened" />
          <Stage value={tracked} label="tracked" />
          <Stage value={activeCount} label="active now" href="/competitors" />
        </Pipeline>

        <Pipeline title="What their content becomes">
          <Stage value={posts} label="posts collected" />
          {/* Not linked: /transcripts is off the nav, and a raw transcript
              list isn't somewhere to send anyone. The count still matters
              as a pipeline stage. */}
          <Stage value={transcripts} label="transcribed" />
          <Stage value={hookCount} label="hooks tagged" href="/hooks" />
          {/* No split: analysis-derived drafts are built from BOTH platforms'
              hooks at once (competitor_name = "Cross-competitor analysis",
              source_post_id null), so attributing one to a platform would
              be inventing a fact. */}
          <Stage value={drafts} label="ready to post" href="/drafts" emphasis />
        </Pipeline>
      </section>

      <section className="mb-6 -mt-6">
        <PlatformRows
          stages={[
            { label: "screened", ig: screenedIg, tt: screenedTt },
            { label: "tracked", ig: trackedIg, tt: trackedTt },
            { label: "active now", ig: activeIg, tt: activeTt, href: "/competitors" },
            { label: "posts collected", ig: postsIg, tt: postsTt },
            { label: "transcribed", ig: trIg, tt: trTt },
            { label: "hooks tagged", ig: hooksIg, tt: hooksTt, href: "/hooks" },
          ]}
        />
      </section>

      <p className="mb-10 text-xs text-dim">
        {Object.entries(byMarket)
          .sort((a, b) => b[1] - a[1])
          .map(([m, n]) => `${m} ${n}`)
          .join(" · ")}
        {pending > 0 && ` · ${pending} outlier${pending === 1 ? "" : "s"} waiting to be transcribed`}
      </p>

      {/* ---- what's working ---- */}
      <section className="mb-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-[13px] font-semibold text-text">Hook patterns that are working</h2>
          <div className="panel divide-y divide-border">
            {topPatterns.map((p) => (
              <div key={p.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-[13px] text-text">{p.name}</span>
                <span className="shrink-0 text-xs text-faint">
                  {p.n} video{p.n === 1 ? "" : "s"}
                  <span className="num ml-3 text-[15px] font-semibold text-brand">{formatScore(p.score)}</span>
                </span>
              </div>
            ))}
            {topPatterns.length === 0 && <p className="px-4 py-3 text-xs text-dim">Nothing tagged yet.</p>}
          </div>
          <Link href="/insights" className="mt-2 inline-block text-[11px] text-dim underline decoration-border underline-offset-2 hover:text-text">
            All patterns and gaps
          </Link>
        </div>

        <div>
          <h2 className="mb-2 text-[13px] font-semibold text-text">Shapes that are working</h2>
          <div className="panel divide-y divide-border">
            {topShapes.map((s) => (
              <div key={s.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-[13px] text-text">{s.name}</span>
                <span className="shrink-0 text-xs text-faint">
                  {s.n} video{s.n === 1 ? "" : "s"}
                  <span className="num ml-3 text-[15px] font-semibold text-brand">{formatScore(s.score)}</span>
                </span>
              </div>
            ))}
            {topShapes.length === 0 && <p className="px-4 py-3 text-xs text-dim">Nothing tagged yet.</p>}
          </div>
          <Link href="/formats" className="mt-2 inline-block text-[11px] text-dim underline decoration-border underline-offset-2 hover:text-text">
            How each shape runs
          </Link>
        </div>
      </section>

      {/* ---- hook lines ---- */}
      <section className="mb-10">
        <h2 className="mb-3 text-[13px] font-semibold text-text">Their strongest opening lines</h2>
        <div className="panel divide-y divide-border">
          {topHooks.map((h) => (
            <Link
              key={h.hook_id}
              href={`/reels/${h.post_id}`}
              className="flex items-start gap-4 px-4 py-2.5 hover:bg-surface-hover"
            >
              <span className="num w-14 shrink-0 text-right text-[13px] font-semibold text-brand">
                {formatScore(h.outlier_score)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-text">
                  &ldquo;{cleanText(h.opening_line)}&rdquo;
                </span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {h.competitors?.name ?? "unknown"} · {h.competitors?.market ?? "—"}
                </span>
              </span>
            </Link>
          ))}
          {topHooks.length === 0 && (
            <p className="px-4 py-3 text-xs text-dim">No hooks tagged yet.</p>
          )}
        </div>
        <Link href="/hooks" className="mt-2 inline-block text-[11px] text-dim underline decoration-border underline-offset-2 hover:text-text">
          Every hook line
        </Link>
      </section>

      {/* ---- drafts ---- */}
      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-text">Ready to post</h2>
        <div className="flex flex-col gap-2">
          {(recentDrafts ?? []).map((d) => (
            <details key={d.draft_id} className="panel px-4 py-2.5">
              <summary className="cursor-pointer list-none">
                <span className="block text-[13px] leading-snug text-text">{d.hook}</span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {d.market} ·{" "}
                  {d.source_post_id ? `from ${d.competitor_name}` : "built from the whole corpus"}
                </span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-[11px] leading-relaxed text-dim">
                {d.script}
              </p>
            </details>
          ))}
          {(recentDrafts ?? []).length === 0 && (
            <p className="panel px-4 py-3 text-xs text-dim">
              No drafts yet. Run the draft generator, or open Content ideas.
            </p>
          )}
        </div>
        <Link href="/drafts" className="mt-2 inline-block text-[11px] text-dim underline decoration-border underline-offset-2 hover:text-text">
          All {drafts} posts
        </Link>
      </section>
    </div>
  );
}
