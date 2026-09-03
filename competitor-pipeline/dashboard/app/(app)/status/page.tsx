import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { formatDate, daysSince } from "@/lib/format";
import { isOverdue, expectedCadenceDays } from "@/lib/cadence";
import { getMonthToDateApifySpend, MONTHLY_APIFY_SPEND_CAP_USD } from "@/lib/apifyUsage";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const supabase = getSupabaseServerClient();

  const [{ data: competitors, error }, spend, { data: pendingRows, error: pendingError }] = await Promise.all([
    supabase
      .from("competitors")
      .select("competitor_id, name, handle, tier, market, active, last_scraped_at, scrape_cadence, low_median_flag"),
    getMonthToDateApifySpend(),
    // Filtered in JS, not a Postgrest .not(...,"in",...) -- SQL's NOT IN
    // treats a null classification as unknown and silently excludes it
    // too, undercounting the true pending queue (same bug fixed on the
    // CLI's --shortlist earlier this session; /review's own count
    // already does this correctly, mirrored here).
    supabase.from("discovery_candidates").select("candidate_id, classification").eq("gate_result", "pass").eq("promoted", false),
  ]);
  if (error) throw new Error(`Failed to load competitors: ${error.message}`);
  if (pendingError) throw new Error(`Failed to load discovery_candidates: ${pendingError.message}`);
  const pendingCount = (pendingRows ?? []).filter((r) => r.classification !== "irrelevant" && r.classification !== "regulated").length;

  const rows = competitors ?? [];
  const active = rows.filter((r) => r.active);

  const byTierMarket = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.tier}/${r.market}`;
    byTierMarket.set(key, (byTierMarket.get(key) ?? 0) + 1);
  }
  const tierMarketKeys = Array.from(byTierMarket.keys()).sort();

  const overdueRows = active.filter((r) => isOverdue(r.last_scraped_at, r.tier, r.scrape_cadence));
  const lowMedianRows = rows.filter((r) => r.low_median_flag);

  const spendPct =
    spend !== null && MONTHLY_APIFY_SPEND_CAP_USD !== null ? Math.min(100, (spend / MONTHLY_APIFY_SPEND_CAP_USD) * 100) : null;

  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Pipeline health</h1>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Roster by tier / market</h2>
          <ul className="space-y-0.5 text-xs text-dim">
            {tierMarketKeys.map((k) => (
              <li key={k} className="flex justify-between">
                <span>{k}</span>
                <span className="font-medium text-text">{byTierMarket.get(k)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Apify spend (month to date)</h2>
          {spend === null ? (
            <p className="text-xs text-faint">Spend unavailable -- APIFY_TOKEN not set.</p>
          ) : MONTHLY_APIFY_SPEND_CAP_USD === null ? (
            <p className="text-xs text-faint">
              ${spend.toFixed(2)} spent -- cap unavailable, MONTHLY_APIFY_SPEND_CAP_USD not set.
            </p>
          ) : (
            <>
              <p className="mb-1 text-sm font-medium text-text">
                ${spend.toFixed(2)} / ${MONTHLY_APIFY_SPEND_CAP_USD}
              </p>
              <div className="h-2 w-full overflow-hidden rounded bg-bg">
                <div
                  className={`h-full transition-all ${spendPct! > 90 ? "bg-bad" : spendPct! > 70 ? "bg-warn" : "bg-brand"}`}
                  style={{ width: `${spendPct}%` }}
                />
              </div>
            </>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Review queue</h2>
          <Link href="/review" className="text-lg font-medium text-brand hover:underline">
            {pendingCount} pending
          </Link>
          <p className="text-xs text-dim">awaiting shortlist review</p>
        </div>
      </div>

      <div className="mb-4 panel p-4">
        <h2 className="mb-2 text-xs font-semibold text-faint">
          Last harvest per active competitor {overdueRows.length > 0 && <span className="text-bad">({overdueRows.length} overdue)</span>}
        </h2>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-faint">
              <th className="px-2 py-1 font-medium">Handle</th>
              <th className="px-2 py-1 font-medium">Tier / Market</th>
              <th className="px-2 py-1 font-medium">Last scraped</th>
              <th className="px-2 py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {active.map((r) => {
              const overdue = isOverdue(r.last_scraped_at, r.tier, r.scrape_cadence);
              const since = daysSince(r.last_scraped_at);
              return (
                <tr key={r.competitor_id} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-1">
                    <Link href={`/competitors/${r.handle}`} className="text-text underline decoration-border underline-offset-2 hover:decoration-text">
                      {r.handle}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-dim">{r.tier} / {r.market}</td>
                  <td className="px-2 py-1 text-dim">
                    {formatDate(r.last_scraped_at)} {since !== null && `(${since}d ago, expects every ${expectedCadenceDays(r.tier, r.scrape_cadence)}d)`}
                  </td>
                  <td className="px-2 py-1">{overdue ? <Badge tone="bad">overdue</Badge> : <Badge tone="good">on track</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lowMedianRows.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-2 text-xs font-semibold text-faint">Flagged low_median_flag</h2>
          <div className="flex flex-wrap gap-2">
            {lowMedianRows.map((r) => (
              <Link key={r.competitor_id} href={`/competitors/${r.handle}`}>
                <Badge tone="warn">{r.handle}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
