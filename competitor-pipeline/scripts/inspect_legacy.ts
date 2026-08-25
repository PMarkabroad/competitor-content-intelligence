/**
 * Read-only inspection of the legacy Prompt-1 schema
 * (competitor_accounts, competitor_posts, post_classifications,
 * collection_runs) before anything considers dropping it.
 *
 * Prints, per legacy table: row count and the 5 most recent rows (ordered
 * by created_at/collected_at/classified_at/started_at as available).
 * Writes nothing, deletes nothing.
 *
 * Usage: npm run inspect-legacy
 */

import "dotenv/config";
import { getSupabaseClient } from "./lib/supabaseClient.ts";

const LEGACY_TABLES: { table: string; orderBy: string }[] = [
  { table: "competitor_accounts", orderBy: "created_at" },
  { table: "competitor_posts", orderBy: "collected_at" },
  { table: "post_classifications", orderBy: "classified_at" },
  { table: "collection_runs", orderBy: "started_at" },
];

async function main() {
  const supabase = getSupabaseClient();

  console.log(
    "NOTE: competitor_posts is a name collision -- the legacy Prompt-1 " +
      "table and the new competitor-pipeline table share this name. This " +
      "script inspects whichever one currently exists under that name in " +
      "the live database (the legacy one, since the new schema hasn't been " +
      "applied yet)."
  );
  console.log("");

  for (const { table, orderBy } of LEGACY_TABLES) {
    console.log(`--- ${table} ---`);

    const { count, error: countError } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    if (countError) {
      console.log(`  Could not read table: ${countError.message}`);
      console.log("");
      continue;
    }

    console.log(`  Row count: ${count ?? 0}`);

    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending: false })
      .limit(5);

    if (error) {
      console.log(`  Could not fetch recent rows: ${error.message}`);
    } else if (!data || data.length === 0) {
      console.log("  No rows.");
    } else {
      console.log("  Most recent rows:");
      for (const row of data) {
        console.log(`    ${JSON.stringify(row)}`);
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
