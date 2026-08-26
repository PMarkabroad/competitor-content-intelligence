import "server-only";
// Imports the CLI pipeline's own config.ts directly (plain object export,
// no imports of its own) rather than duplicating MONTHLY_APIFY_SPEND_CAP_USD
// as a second env var -- one source of truth for the cap, same as every
// script in scripts/ already reads.
import { config } from "../../config";

export const MONTHLY_APIFY_SPEND_CAP_USD = config.MONTHLY_APIFY_SPEND_CAP_USD;

export async function getMonthToDateApifySpend(): Promise<number | null> {
  const token = process.env.APIFY_TOKEN;
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
