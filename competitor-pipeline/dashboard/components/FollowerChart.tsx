// Deliberately a plain server-rendered SVG, not a charting library --
// "no decorative charts", this is one line over follower snapshots.

interface Point {
  date: string;
  followers: number;
}

export function FollowerChart({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-faint">No snapshot history yet.</p>;
  }
  if (points.length === 1) {
    return (
      <p className="text-xs text-dim">
        Single snapshot: <span className="font-medium text-text">{points[0].followers.toLocaleString()}</span> followers on {points[0].date}.
      </p>
    );
  }

  const width = 640;
  const height = 140;
  const padX = 4;
  const padTop = 14;
  const padBottom = 22;

  const values = points.map((p) => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (width - padX * 2);
    const y = padTop + (height - padTop - padBottom) - ((p.followers - min) / range) * (height - padTop - padBottom);
    return { x, y };
  });

  // Smooth-ish curve: quadratic midpoints between each pair of points
  // rather than a raw polyline -- still deterministic, no library.
  let linePath = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const midX = (prev.x + cur.x) / 2;
    linePath += ` Q${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${midX.toFixed(1)},${((prev.y + cur.y) / 2).toFixed(1)}`;
  }
  linePath += ` T${coords[coords.length - 1].x.toFixed(1)},${coords[coords.length - 1].y.toFixed(1)}`;

  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${height - padBottom} L${coords[0].x.toFixed(1)},${height - padBottom} Z`;

  const last = points[points.length - 1];
  const first = points[0];
  const change = last.followers - first.followers;

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight text-text">{last.followers.toLocaleString()}</span>
        {change !== 0 && (
          <span className={`text-xs font-medium ${change > 0 ? "text-good" : "text-bad"}`}>
            {change > 0 ? "+" : ""}
            {change.toLocaleString()}
          </span>
        )}
        <span className="text-[11px] text-faint">since {first.date}</span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        <defs>
          <linearGradient id="followerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#followerFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="var(--color-brand)" strokeWidth={1.75} strokeLinecap="round" />
        {coords.map((c, i) =>
          i === coords.length - 1 ? (
            <circle key={i} cx={c.x} cy={c.y} r={2.5} fill="var(--color-brand)" />
          ) : null
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-faint">
        <span>{first.date}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}
