// Deliberately a plain server-rendered SVG, not a charting library --
// "no decorative charts", this is one polyline over follower snapshots.

interface Point {
  date: string;
  followers: number;
}

export function FollowerChart({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-[var(--color-text-faint)]">No snapshot history yet.</p>;
  }
  if (points.length === 1) {
    return (
      <p className="text-xs text-[var(--color-text-dim)]">
        Single snapshot: {points[0].followers.toLocaleString()} followers on {points[0].date}.
      </p>
    );
  }

  const width = 640;
  const height = 120;
  const padding = 8;

  const values = points.map((p) => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.followers - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth={1.5} />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={1.5} fill="var(--color-brand)" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--color-text-faint)]">
        <span>
          {points[0].date}: {points[0].followers.toLocaleString()}
        </span>
        <span>
          {points[points.length - 1].date}: {points[points.length - 1].followers.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
