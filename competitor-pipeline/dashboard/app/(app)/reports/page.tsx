import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";

export const dynamic = "force-dynamic";

// Reads from dashboard/reports/, not competitor-pipeline/out/ -- Vercel
// only uploads the dashboard/ directory as this project's root (confirmed
// empirically deploying this same dashboard earlier), so a path reaching
// outside it (../out/) would exist locally but 404-equivalent in
// production, the same failure mode lib/apifyUsage.ts hit before being
// fixed. dashboard/reports/ is a committed copy -- the CLI still writes
// new reports to out/ each cycle; copying the new file into
// dashboard/reports/ is a manual step for now, same "kept in sync by
// hand" tradeoff as MONTHLY_APIFY_SPEND_CAP_USD.
const REPORTS_DIR = path.join(process.cwd(), "reports");

export default function ReportsPage() {
  let files: string[] = [];
  try {
    files = readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".md")).sort().reverse();
  } catch {
    files = [];
  }

  return (
    <div className="p-4">
      <h1 className="mb-1 text-sm font-semibold text-text">Reports</h1>
      <p className="mb-4 text-xs text-dim">{files.length} report(s), newest first.</p>

      {files.length === 0 ? (
        <div className="panel p-5">
          <p className="text-xs text-faint">No reports yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {files.map((file) => {
            const content = readFileSync(path.join(REPORTS_DIR, file), "utf-8");
            const html = marked.parse(content, { async: false }) as string;
            return (
              <div key={file} className="panel p-6">
                <p className="mb-3 font-mono text-[11px] text-faint">{file}</p>
                <div className="report-markdown text-sm text-dim" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
