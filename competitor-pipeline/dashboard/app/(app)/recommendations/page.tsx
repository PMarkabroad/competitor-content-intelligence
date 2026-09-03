import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";
import { formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";

// Depends on /gaps (50 tagged posts, 2+ markets) and /hooks/analysis (30
// tagged hooks, 5+ per pattern) both being unlocked -- same thresholds,
// checked here independently rather than importing state from those
// routes (each screen owns its own gate).
const MIN_TAGGED_POSTS = 50;
const MIN_MARKETS = 2;
const MIN_HOOKS_TOTAL = 30;
const MIN_PER_PATTERN = 5;

interface HookRow {
  hook_id: string;
  post_id: string;
  topic_slug: string | null;
  hook_pattern: string | null;
  outlier_score: number | null;
  brand_fit: string | null;
  competitor_id: string;
  competitors: { market: string } | null;
}

export default async function RecommendationsPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("hook_library")
    .select("hook_id, post_id, topic_slug, hook_pattern, outlier_score, brand_fit, competitor_id, competitors(market)");
  if (error) throw new Error(`Failed to load hook_library: ${error.message}`);

  const tagged = ((data ?? []) as unknown as HookRow[]).filter((h) => h.brand_fit !== "no");
  const marketsSeen = new Set(tagged.map((h) => h.competitors?.market).filter(Boolean));

  const byPattern = new Map<string, HookRow[]>();
  for (const h of tagged) {
    if (!h.hook_pattern) continue;
    if (!byPattern.has(h.hook_pattern)) byPattern.set(h.hook_pattern, []);
    byPattern.get(h.hook_pattern)!.push(h);
  }
  const patternsWithEnough = Array.from(byPattern.entries()).filter(([, rows]) => rows.length >= MIN_PER_PATTERN);

  const gapsUnlocked = tagged.length >= MIN_TAGGED_POSTS && marketsSeen.size >= MIN_MARKETS;
  const hookAnalysisUnlocked = tagged.length >= MIN_HOOKS_TOTAL && patternsWithEnough.length > 0;

  if (!gapsUnlocked || !hookAnalysisUnlocked) {
    const missing: string[] = [];
    if (!gapsUnlocked) missing.push(`/gaps needs ${MIN_TAGGED_POSTS} tagged posts across ${MIN_MARKETS}+ markets`);
    if (!hookAnalysisUnlocked) missing.push(`/hooks/analysis needs ${MIN_HOOKS_TOTAL} tagged hooks with ${MIN_PER_PATTERN}+ per pattern`);
    return (
      <GatedScreen
        title="What to create next"
        requirement={missing.join("; ")}
        current={tagged.length}
        minimum={Math.max(MIN_TAGGED_POSTS, MIN_HOOKS_TOTAL)}
      />
    );
  }

  // Best pattern (highest avg outlier_score, 5+ samples) crossed with the
  // topic that has the strongest performance-to-coverage ratio (same
  // logic as /gaps). Every recommendation cites the actual posts it's
  // built from -- "a recommendation without visible evidence is an
  // opinion with a chart attached."
  const avg = (rows: HookRow[]) => rows.reduce((sum, r) => sum + (r.outlier_score ?? 0), 0) / rows.length;
  const bestPattern = patternsWithEnough.sort((a, b) => avg(b[1]) - avg(a[1]))[0];

  const byTopic = new Map<string, HookRow[]>();
  for (const h of tagged) {
    const key = h.topic_slug ?? "untagged";
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key)!.push(h);
  }
  const bestGap = Array.from(byTopic.entries())
    .map(([topic, rows]) => ({ topic, rows, avgScore: avg(rows), competitorCount: new Set(rows.map((r) => r.competitor_id)).size }))
    .sort((a, b) => b.avgScore / (b.competitorCount || 1) - a.avgScore / (a.competitorCount || 1))[0];

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">What to create next</h1>

      <div className="panel mb-4 p-5">
        <p className="mb-2 text-sm text-text">
          Lead with <span className="font-semibold text-text">{bestPattern[0]}</span> on <span className="font-semibold text-text">{bestGap.topic}</span>.
        </p>
        <p className="mb-3 text-xs text-dim">
          {bestPattern[0]} averages {formatScore(avg(bestPattern[1]))} across {bestPattern[1].length} tagged hooks. {bestGap.topic} averages{" "}
          {formatScore(bestGap.avgScore)} with only {bestGap.competitorCount} competitor(s) covering it.
        </p>
        <div className="flex flex-wrap gap-2">
          {[...bestPattern[1].slice(0, 3), ...bestGap.rows.slice(0, 3)].map((r) => (
            <Link key={r.hook_id} href={`/reels/${r.post_id}`} className="rounded-md border border-border px-2 py-1 text-xs text-dim hover:bg-surface-hover hover:text-text">
              evidence: post →
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
