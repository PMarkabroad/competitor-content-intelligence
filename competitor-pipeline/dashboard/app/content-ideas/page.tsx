export const dynamic = "force-dynamic";

export default function ContentIdeasPage() {
  return (
    <div className="p-4">
      <h1 className="mb-4 text-sm font-semibold text-text">Content ideas</h1>
      <div className="panel p-5">
        <p className="mb-2 text-sm text-text">This screen is being built next.</p>
        <p className="text-xs text-dim">
          It will pull every tagged hook from <code>hook_library</code> -- no volume gate -- and show what worked,
          the brand-fit-checked verdict, and a copy-able raw dump (transcript, caption, metrics) for each one.
          Until then, the closest equivalent is the <code>Hooks</code> screen and the published monthly reports
          under <code>More &gt; Reports</code>.
        </p>
      </div>
    </div>
  );
}
