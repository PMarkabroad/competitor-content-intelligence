import { getSupabaseServerClient } from "@/lib/supabase";
import { DataTable } from "@/components/DataTable";
import { DATA_TABLES, getTableConfig } from "@/lib/dataTables";

export const dynamic = "force-dynamic";

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const params = await searchParams;
  const config = getTableConfig(params.table);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(config.name)
    .select(config.columns.join(","))
    .order(config.defaultSort, { ascending: false })
    .limit(5000);
  if (error) throw new Error(`Failed to load ${config.name}: ${error.message}`);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-sm font-semibold text-[var(--color-text)]">Data browser</h1>
          <p className="text-xs text-[var(--color-text-dim)]">Read-only. `raw` jsonb columns omitted (full actor payloads).</p>
        </div>
        <div className="flex gap-1">
          {DATA_TABLES.map((t) => (
            <a
              key={t.name}
              href={`/data?table=${t.name}`}
              className={`rounded px-2 py-1 text-xs ${
                t.name === config.name
                  ? "bg-[var(--color-brand)] text-white"
                  : "border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)]"
              }`}
            >
              {t.name}
            </a>
          ))}
        </div>
      </div>

      <DataTable tableName={config.name} columns={config.columns} rows={(data ?? []) as unknown as Record<string, unknown>[]} />
    </div>
  );
}
