import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { Badge } from "@/components/Badge";
import { ReviewerNameInput } from "@/components/ReviewerName";
import { RowActions } from "@/components/RowActions";
import { formatNumber, formatVpf, formatDate } from "@/lib/format";
import { approveCandidate, rejectCandidate } from "./actions";
import { APPROVED_COUNT_COOKIE } from "@/lib/constants";

// Explicit even though searchParams usage already forces dynamic
// rendering here -- consistent with every other data page, so this
// doesn't regress to static if that usage ever changes.
export const dynamic = "force-dynamic";

interface DiscoveryCandidate {
  candidate_id: string;
  platform: string;
  handle: string;
  profile_url: string | null;
  display_name: string | null;
  bio: string | null;
  followers: number | null;
  market_guess: string | null;
  video_posts_90d: number | null;
  median_vpf_90d: number | null;
  band: string | null;
  last_post_at: string | null;
  classification: string | null;
  classification_reason: string | null;
  found_via: string | null;
}

const EXCLUDED_CLASSIFICATIONS = ["irrelevant", "regulated"];
const MARKETS = ["AU", "US", "CA"];

function profileUrl(row: DiscoveryCandidate): string {
  if (row.profile_url) return row.profile_url;
  return row.platform === "tiktok"
    ? `https://www.tiktok.com/@${row.handle}`
    : `https://instagram.com/${row.handle}`;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; classification?: string; showExcluded?: string }>;
}) {
  const params = await searchParams;
  const showExcluded = params.showExcluded === "1";

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from("discovery_candidates")
    .select(
      "candidate_id, platform, handle, profile_url, display_name, bio, followers, market_guess, video_posts_90d, median_vpf_90d, band, last_post_at, classification, classification_reason, found_via"
    )
    .eq("gate_result", "pass")
    .eq("promoted", false)
    .order("median_vpf_90d", { ascending: false });

  if (params.market) query = query.eq("market_guess", params.market);
  if (params.classification) query = query.eq("classification", params.classification);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load discovery_candidates: ${error.message}`);

  const cookieStore = await cookies();
  const approvedThisSession = Number(cookieStore.get(APPROVED_COUNT_COOKIE)?.value ?? "0");

  const allRows = (data ?? []) as DiscoveryCandidate[];
  const visibleRows = showExcluded
    ? allRows
    : allRows.filter((r) => !EXCLUDED_CLASSIFICATIONS.includes(r.classification ?? ""));
  const excludedCount = allRows.length - allRows.filter((r) => !EXCLUDED_CLASSIFICATIONS.includes(r.classification ?? "")).length;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-sm font-semibold text-text">Shortlist review</h1>
          <p className="text-xs text-dim">
            {visibleRows.length} pending · {approvedThisSession} approved this session
            {excludedCount > 0 && !showExcluded ? ` · ${excludedCount} excluded (irrelevant/regulated) hidden` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ReviewerNameInput />
          <form method="get" className="flex items-center gap-2">
            <select name="market" defaultValue={params.market ?? ""} className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text">
              <option value="">All markets</option>
              {MARKETS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select name="classification" defaultValue={params.classification ?? ""} className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text">
              <option value="">All classifications</option>
              <option value="career_coach">career_coach</option>
              <option value="adjacent">adjacent</option>
              <option value="irrelevant">irrelevant</option>
              <option value="regulated">regulated</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-dim">
              <input type="checkbox" name="showExcluded" value="1" defaultChecked={showExcluded} />
              Show excluded
            </label>
            <button type="submit" className="rounded-md bg-text px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-85">
              Apply
            </button>
          </form>
        </div>
      </div>

      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              <th className="px-2 py-2 font-medium">Handle</th>
              <th className="px-2 py-2 font-medium">Bio</th>
              <th className="px-2 py-2 font-medium text-right">Followers</th>
              <th className="px-2 py-2 font-medium">Market</th>
              <th className="px-2 py-2 font-medium text-right">Posts/90d</th>
              <th className="px-2 py-2 font-medium text-right">Median VPF</th>
              <th className="px-2 py-2 font-medium">Band</th>
              <th className="px-2 py-2 font-medium">Last post</th>
              <th className="px-2 py-2 font-medium">Classification</th>
              <th className="px-2 py-2 font-medium">Found via</th>
              <th className="px-2 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const isExcluded = EXCLUDED_CLASSIFICATIONS.includes(row.classification ?? "");
              return (
                <tr
                  key={row.candidate_id}
                  className={`border-b border-border align-top hover:bg-surface-hover ${isExcluded ? "opacity-40" : ""}`}
                >
                  <td className="px-2 py-2">
                    <a href={profileUrl(row)} target="_blank" rel="noreferrer" className="font-medium text-text underline decoration-border underline-offset-2 hover:decoration-text">
                      {row.handle}
                    </a>
                    <div className="text-faint">{row.display_name}</div>
                  </td>
                  <td className="max-w-64 px-2 py-2 text-dim">{row.bio}</td>
                  <td className="px-2 py-2 text-right">{formatNumber(row.followers)}</td>
                  <td className="px-2 py-2">{row.market_guess}</td>
                  <td className="px-2 py-2 text-right">{row.video_posts_90d ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-medium">{formatVpf(row.median_vpf_90d)}</td>
                  <td className="px-2 py-2">{row.band}</td>
                  <td className="px-2 py-2">{formatDate(row.last_post_at)}</td>
                  <td className="max-w-56 px-2 py-2">
                    <Badge tone={row.classification === "career_coach" ? "good" : row.classification === "adjacent" ? "brand" : row.classification === "regulated" ? "bad" : row.classification === "irrelevant" ? "warn" : "neutral"}>
                      {row.classification ?? "unclassified"}
                    </Badge>
                    {row.classification === "regulated" && (
                      <div className="mt-1 text-[10px] text-bad">DB constraint refuses promotion.</div>
                    )}
                    <div className="mt-1 text-faint">{row.classification_reason}</div>
                  </td>
                  <td className="max-w-40 px-2 py-2 text-dim">{row.found_via}</td>
                  <td className="px-2 py-2">
                    <RowActions
                      candidateId={row.candidate_id}
                      defaultMarket={row.market_guess ?? "AU"}
                      disabledApprove={row.classification === "regulated"}
                      approveAction={approveCandidate}
                      rejectAction={rejectCandidate}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
