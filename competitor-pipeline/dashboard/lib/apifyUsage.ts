import "server-only";

// Originally imported the CLI pipeline's own config.ts directly
// (../../config, a plain object export with no imports of its own) to
// avoid a second source of truth for the cap. That broke the real Vercel
// deployment: only dashboard/ is uploaded as its own project root, so
// ../../config.ts doesn't exist in the deployed filesystem ("Module not
// found: Can't resolve '../../config'", confirmed via the actual build
// log on 2026-08-26). An env var is the only thing that reaches both
// runtimes -- kept in sync with config.ts's MONTHLY_APIFY_SPEND_CAP_USD
// by hand; there's no way to share one TypeScript source between two
// independently-deployed projects without a shared package.
const rawCap = process.env.MONTHLY_APIFY_SPEND_CAP_USD;
export const MONTHLY_APIFY_SPEND_CAP_USD = rawCap ? Number(rawCap) : null;

export async function getMonthToDateApifySpend(tokenOverride?: string): Promise<number | null> {
  const token = tokenOverride || process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${token}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: { totalUsageCreditsUsdAfterVolumeDiscount: number } };
    return json.data.totalUsageCreditsUsdAfterVolumeDiscount;
  } catch {
    return null;
  }
}
