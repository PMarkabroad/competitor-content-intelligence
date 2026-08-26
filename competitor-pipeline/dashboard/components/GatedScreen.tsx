// Shared empty state for every Phase 3 screen -- each one checks its own
// row count against a documented minimum and renders this instead of a
// chart of near-zero data. "This is more useful than a chart of one bar,
// and it tells the reader what would unlock the screen" -- per spec.
export function GatedScreen({
  title,
  requirement,
  current,
  minimum,
}: {
  title: string;
  requirement: string;
  current: number;
  minimum: number;
}) {
  const pct = Math.min(100, Math.round((current / minimum) * 100));
  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">{title}</h1>
      <div className="panel max-w-md p-5">
        <p className="mb-3 text-sm text-text">
          Needs {requirement}. Currently {current}.
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
          <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-faint">{pct}% of the way there.</p>
      </div>
    </div>
  );
}
