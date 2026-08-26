import { marked } from "marked";
import { getSupabaseServerClient } from "@/lib/supabase";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Reads from hook_reports (Supabase), not the filesystem. An earlier
// version read from dashboard/reports/, a committed copy of
// competitor-pipeline/out/*.md -- that needed a human to remember to
// copy every new report over AND redeploy before it showed up live.
// Publishing now (scripts/publish_hook_report.ts) writes the file to
// out/ (the CLI-facing archive, unchanged) and this table in the same
// step, so a new report is visible on the next page load, not the next
// deploy.
export default async function ReportsPage() {
  const supabase = getSupabaseServerClient();
  const { data: reports, error } = await supabase
    .from("hook_reports")
    .select("report_id, title, content, generated_at")
    .order("generated_at", { ascending: false });
  if (error) throw new Error(`Failed to load hook_reports: ${error.message}`);

  const rows = reports ?? [];

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Reports</h1>
      <p className="mb-4 text-xs text-dim">{rows.length} report(s), newest first.</p>

      {rows.length === 0 ? (
        <div className="panel p-5">
          <p className="text-xs text-faint">No reports yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {rows.map((report) => {
            const html = marked.parse(report.content, { async: false }) as string;
            return (
              <div key={report.report_id} className="panel p-6">
                <p className="mb-3 font-mono text-[11px] text-faint">{report.title} · {formatDateTime(report.generated_at)}</p>
                <div className="report-markdown text-sm text-dim" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
