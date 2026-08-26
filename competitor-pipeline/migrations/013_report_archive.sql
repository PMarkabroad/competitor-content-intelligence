-- Report archive, backing the dashboard's /reports screen.
--
-- Replaces the filesystem-copy approach from migration 012's build
-- (dashboard/reports/, a committed copy of competitor-pipeline/out/*.md):
-- that required a human to remember to copy every new report into the
-- dashboard's own directory AND redeploy before it would show up live.
-- A Supabase-backed archive means publishing a report is one write
-- (scripts/publish_hook_report.ts) that's visible on the next page load,
-- no redeploy, no copy step to forget.
--
-- competitor-pipeline/out/hook_report_YYYY-MM.md stays the canonical
-- CLI-facing archive (unchanged, per the original Prompt 4 spec) --
-- this table is the dashboard-facing copy, written at the same time by
-- the same publish step, not a replacement for the file.

create table if not exists hook_reports (
    report_id uuid primary key default gen_random_uuid(),
    title text not null,
    content text not null,
    generated_at timestamptz not null default now()
);

create index if not exists idx_hook_reports_generated_at on hook_reports (generated_at desc);
