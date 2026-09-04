/**
 * Shown the instant a nav link is tapped, while the server renders the real
 * page.
 *
 * Without a loading file, Next holds the OLD page on screen until the new
 * one is ready. Nothing moves, nothing indicates anything is happening, and
 * a 3-second render reads as a frozen app -- which is exactly how it was
 * described: "it pauses for a minute". The wait barely changed; the silence
 * was the problem.
 *
 * Deliberately a skeleton of the real shape rather than a spinner: it shows
 * where content is about to appear, so the page does not jump when it
 * arrives.
 */
function Bar({ w }: { w: string }) {
  return <div className={`h-3 rounded bg-border ${w}`} />;
}

export default function Loading() {
  return (
    // aria-busy + a screen-reader line, because a purely visual skeleton
    // announces nothing to someone using a screen reader.
    <div className="animate-pulse p-3 sm:p-5" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="mb-6 flex flex-col gap-2">
        <Bar w="w-40" />
        <Bar w="w-64" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel flex flex-col gap-2 p-4">
            <Bar w="w-16" />
            <Bar w="w-10" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="panel flex flex-col gap-2.5 p-4">
            <Bar w="w-3/4" />
            <Bar w="w-full" />
            <Bar w="w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
