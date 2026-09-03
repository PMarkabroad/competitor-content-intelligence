import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { formatScore, formatVpf } from "@/lib/format";

export const dynamic = "force-dynamic";

// Everything the six separate analysis screens (/hooks/analysis, /formats,
// /topics, /markets, /gaps, /recommendations) used to answer, on one page.
// They each ran a near-identical hook_library query and rendered one table,
// which meant five clicks to assemble a picture that fits on a single
// screen. Those routes still exist and still work -- this just stops them
// being the only way to see any of it.
//
// Sections degrade individually rather than gating the whole page: a thin
// `format` column shouldn't hide the hook-pattern table that has plenty of
// data behind it.

interface HookRow {
  hook_id: string;
  post_id: string;
  hook_pattern: string | null;
  format: string | null;
  topic_slug: string | null;
  sub_topic: string | null;
  outlier_score: number | null;
  vpf: number | null;
  brand_fit: string | null;
  au_transplant: string | null;
  competitor_id: string;
  competitors: { name: string; market: string } | null;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function Section({
  question,
  answer,
  children,
}: {
  question: string;
  answer: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-[15px] font-semibold tracking-tight text-text">{question}</h2>
      <p className="mb-3 mt-1 max-w-[68ch] text-xs leading-relaxed text-dim">{answer}</p>
      {children}
    </section>
  );
}

function Table({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto panel">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-surface text-faint">
            {columns.map((c, i) => (
              <th key={c} className={`px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
              {r.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 ${ci > 0 ? "text-right" : "text-text"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Thin({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel px-3 py-4 text-xs leading-relaxed text-dim">{children}</div>
  );
}

export default async function InsightsPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("hook_library")
    .select(
      "hook_id, post_id, hook_pattern, format, topic_slug, sub_topic, outlier_score, vpf, brand_fit, au_transplant, competitor_id, competitors(name, market)"
    );
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const all = (data ?? []) as unknown as HookRow[];
  // brand_fit 'no' means the content trips a Never-ships rule. It stays out
  // of every "what works" aggregate -- we don't want to learn from, or be
  // recommended, something we would never publish.
  const rows = all.filter((h) => h.brand_fit !== "no");
  const excluded = all.length - rows.length;

  const scored = rows.filter((h) => h.outlier_score != null);

  // --- hook patterns -------------------------------------------------------
  const byPattern = new Map<string, HookRow[]>();
  for (const h of scored) {
    if (!h.hook_pattern) continue;
    if (!byPattern.has(h.hook_pattern)) byPattern.set(h.hook_pattern, []);
    byPattern.get(h.hook_pattern)!.push(h);
  }
  const patternRows = Array.from(byPattern.entries())
    .map(([pattern, rs]) => ({
      pattern,
      n: rs.length,
      score: avg(rs.map((r) => r.outlier_score ?? 0)),
    }))
    .sort((a, b) => b.score - a.score);
  const topPattern = patternRows[0];

  // --- formats -------------------------------------------------------------
  const withFormat = scored.filter((h) => h.format);
  const byFormat = new Map<string, HookRow[]>();
  for (const h of withFormat) {
    if (!byFormat.has(h.format!)) byFormat.set(h.format!, []);
    byFormat.get(h.format!)!.push(h);
  }
  const formatRows = Array.from(byFormat.entries())
    .map(([format, rs]) => ({ format, n: rs.length, score: avg(rs.map((r) => r.outlier_score ?? 0)) }))
    .sort((a, b) => b.score - a.score);

  // --- topics --------------------------------------------------------------
  // sub_topic (free text) carries the real subject; topic_slug is a narrow
  // 6-value taxonomy most posts don't fit, so it's null far more often than
  // not. Grouping on sub_topic is what actually shows what they cover.
  const bySubTopic = new Map<string, HookRow[]>();
  for (const h of scored) {
    const key = h.sub_topic?.trim();
    if (!key) continue;
    if (!bySubTopic.has(key)) bySubTopic.set(key, []);
    bySubTopic.get(key)!.push(h);
  }
  const topicRows = Array.from(bySubTopic.entries())
    .map(([topic, rs]) => ({ topic, n: rs.length, score: avg(rs.map((r) => r.outlier_score ?? 0)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // --- markets -------------------------------------------------------------
  const byMarket = new Map<string, HookRow[]>();
  for (const h of scored) {
    const m = h.competitors?.market;
    if (!m) continue;
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(h);
  }
  const marketRows = Array.from(byMarket.entries())
    .map(([market, rs]) => ({
      market,
      n: rs.length,
      accounts: new Set(rs.map((r) => r.competitor_id)).size,
      score: avg(rs.map((r) => r.outlier_score ?? 0)),
      vpf: avg(rs.map((r) => r.vpf ?? 0)),
    }))
    .sort((a, b) => b.score - a.score);

  // --- gaps ----------------------------------------------------------------
  // Proven to land, barely covered: strong average score, few distinct
  // accounts doing it. Ranked by score per covering account so a topic one
  // account owns outranks one everybody already floods.
  const gapRows = Array.from(bySubTopic.entries())
    .map(([topic, rs]) => {
      const accounts = new Set(rs.map((r) => r.competitor_id)).size;
      const score = avg(rs.map((r) => r.outlier_score ?? 0));
      return { topic, accounts, score, n: rs.length, leverage: score / (accounts || 1), rs };
    })
    .filter((g) => g.accounts <= 2)
    .sort((a, b) => b.leverage - a.leverage)
    .slice(0, 10);

  // --- what to make --------------------------------------------------------
  // The strongest pattern crossed with the least-covered subjects, limited
  // to things marked transplantable. This is a shortlist to judge, not an
  // instruction.
  const buildable = scored
    .filter((h) => h.au_transplant === "yes" || h.au_transplant === "with_changes")
    .sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0))
    .slice(0, 8);

  return (
    <div className="p-5">
      <header className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight text-text">Insights</h1>
        <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-dim">
          {rows.length} tagged competitor hooks across {byMarket.size} markets.
          {excluded > 0 && ` ${excluded} excluded for tripping a brand rule.`} Scores are relative to
          each account&rsquo;s own median, so 20x means unusual for them, not high reach.
        </p>
      </header>

      <Section
        question="Which hook patterns actually work?"
        answer={
          topPattern
            ? `${topPattern.pattern.replace(/_/g, " ")} leads at ${formatScore(topPattern.score)} across ${topPattern.n} ${topPattern.n === 1 ? "video" : "videos"}. Patterns with only a handful of videos behind them are worth testing, not trusting.`
            : "No scored hooks yet."
        }
      >
        {patternRows.length > 0 ? (
          <Table
            columns={["Pattern", "Videos", "Avg score"]}
            rows={patternRows.map((p) => [
              p.pattern.replace(/_/g, " "),
              p.n,
              <span key="s" className="font-semibold text-brand">{formatScore(p.score)}</span>,
            ])}
          />
        ) : (
          <Thin>Nothing tagged with a hook pattern yet.</Thin>
        )}
      </Section>

      <Section
        question="Which formats work?"
        answer={
          withFormat.length > 0
            ? `Based on the ${withFormat.length} of ${scored.length} videos that have a format set. The rest are blank because format is a visual property and the tagging runs on transcripts, which are audio only — it's left empty rather than guessed. Treat this as partial until the other ${scored.length - withFormat.length} are filled in.`
            : "Format is a visual property and the tagging runs on transcripts, which are audio only. It's left blank rather than guessed, so this table only fills in once someone watches the videos and sets it."
        }
      >
        {formatRows.length > 0 ? (
          <Table
            columns={["Format", "Videos", "Avg score"]}
            rows={formatRows.map((f) => [
              f.format.replace(/_/g, " "),
              f.n,
              <span key="s" className="font-semibold text-brand">{formatScore(f.score)}</span>,
            ])}
          />
        ) : (
          <Thin>
            No video has a format set yet. {scored.length} are waiting on a visual pass — open any of
            them from <Link href="/content-ideas" className="text-brand hover:underline">Content ideas</Link> and
            set it while you watch.
          </Thin>
        )}
      </Section>

      <Section
        question="What are they making videos about?"
        answer={`The ${topicRows.length} subjects pulling hardest, by average score. Subjects come from what the video actually covers, not a fixed category list.`}
      >
        {topicRows.length > 0 ? (
          <Table
            columns={["Subject", "Videos", "Avg score"]}
            rows={topicRows.map((t) => [
              t.topic,
              t.n,
              <span key="s" className="font-semibold text-brand">{formatScore(t.score)}</span>,
            ])}
          />
        ) : (
          <Thin>No subjects tagged yet.</Thin>
        )}
      </Section>

      <Section
        question="How do the three markets compare?"
        answer="Australia, the United States and Canada, side by side. A higher average score means videos there beat their own account's normal more often — not that the market is bigger."
      >
        {marketRows.length > 0 ? (
          <Table
            columns={["Market", "Accounts", "Videos", "Avg score", "Avg views per follower"]}
            rows={marketRows.map((m) => [
              m.market,
              m.accounts,
              m.n,
              <span key="s" className="font-semibold text-brand">{formatScore(m.score)}</span>,
              formatVpf(m.vpf),
            ])}
          />
        ) : (
          <Thin>No market data yet.</Thin>
        )}
      </Section>

      <Section
        question="Where is the gap we can take?"
        answer="Subjects that performed well but that almost nobody is covering — at most two accounts each. Proven to land, barely contested."
      >
        {gapRows.length > 0 ? (
          <Table
            columns={["Subject", "Accounts on it", "Videos", "Avg score"]}
            rows={gapRows.map((g) => [
              g.topic,
              g.accounts,
              g.n,
              <span key="s" className="font-semibold text-brand">{formatScore(g.score)}</span>,
            ])}
          />
        ) : (
          <Thin>Not enough tagged subjects yet to tell a gap from a coincidence.</Thin>
        )}
      </Section>

      <Section
        question="So what should we make?"
        answer="The highest-scoring videos already judged rebuildable for an Australian audience. Open one to read what carries over and what has to change."
      >
        {buildable.length > 0 ? (
          <div className="panel divide-y divide-border">
            {buildable.map((h) => (
              <Link
                key={h.hook_id}
                href={`/reels/${h.post_id}`}
                className="flex items-baseline gap-3 px-3 py-2.5 text-xs hover:bg-surface-hover"
              >
                <span className="w-14 shrink-0 font-semibold text-brand">{formatScore(h.outlier_score ?? 0)}</span>
                <span className="flex-1 text-text">{h.sub_topic ?? "untitled"}</span>
                <span className="shrink-0 text-faint">
                  {h.hook_pattern?.replace(/_/g, " ")} · {h.competitors?.market}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Thin>Nothing marked transplantable yet.</Thin>
        )}
      </Section>
    </div>
  );
}
