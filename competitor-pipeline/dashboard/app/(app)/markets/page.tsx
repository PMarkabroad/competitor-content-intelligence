import { getSupabaseServerClient } from "@/lib/supabase";
import { GatedScreen } from "@/components/GatedScreen";
import { formatNumber, formatVpf } from "@/lib/format";

export const dynamic = "force-dynamic";

const MIN_ACCOUNTS_PER_MARKET = 3;
const ALL_MARKETS = ["AU", "US", "CA"];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export default async function MarketsPage() {
  const supabase = getSupabaseServerClient();
  const { data: summary, error } = await supabase.from("v_competitor_summary").select("*");
  if (error) throw new Error(`Failed to load v_competitor_summary: ${error.message}`);

  const rows = summary ?? [];
  const byMarket = ALL_MARKETS.map((market) => ({ market, rows: rows.filter((r) => r.market === market) }));
  const qualifying = byMarket.filter((m) => m.rows.length >= MIN_ACCOUNTS_PER_MARKET);

  if (qualifying.length < 2) {
    const maxAccounts = Math.max(...byMarket.map((m) => m.rows.length), 0);
    return (
      <GatedScreen
        title="AU vs US vs CA comparison"
        requirement={`${MIN_ACCOUNTS_PER_MARKET} active accounts in at least 2 markets to compare`}
        current={maxAccounts}
        minimum={MIN_ACCOUNTS_PER_MARKET}
      />
    );
  }

  const excluded = byMarket.filter((m) => m.rows.length < MIN_ACCOUNTS_PER_MARKET && m.rows.length > 0);

  return (
    <div className="p-3 sm:p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Market comparison</h1>
      {excluded.length > 0 && (
        <p className="mb-4 text-xs text-faint">
          {excluded.map((m) => `${m.market} (${m.rows.length} account${m.rows.length === 1 ? "" : "s"})`).join(", ")} excluded -- below the {MIN_ACCOUNTS_PER_MARKET}-account minimum.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {qualifying.map(({ market, rows: marketRows }) => {
          const posts = marketRows.reduce((sum, r) => sum + (r.posts_collected ?? 0), 0);
          const vpfs = marketRows.map((r) => r.median_vpf).filter((v): v is number => v !== null);
          const followers = marketRows.reduce((sum, r) => sum + (r.followers_current ?? 0), 0);
          return (
            <div key={market} className="panel p-4">
              <h2 className="mb-3 text-sm font-semibold text-text">{market}</h2>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-dim">Accounts</span><span className="font-medium text-text">{marketRows.length}</span></div>
                <div className="flex justify-between"><span className="text-dim">Combined followers</span><span className="font-medium text-text">{formatNumber(followers)}</span></div>
                <div className="flex justify-between"><span className="text-dim">Posts collected</span><span className="font-medium text-text">{posts}</span></div>
                <div className="flex justify-between"><span className="text-dim">Median VPF</span><span className="font-medium text-text">{formatVpf(median(vpfs))}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
