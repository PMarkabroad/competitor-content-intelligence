// Plain server-rendered SVG, not a charting library -- used for both
// follower history and views-over-time. One line, no interactivity.

interface Point {
  label: string;
  value: number;
}

export function LineChart({
  points,
  emptyMessage = "No data yet.",
  formatValue = (v) => v.toLocaleString(),
  tone = "brand",
}: {
  points: Point[];
  emptyMessage?: string;
  formatValue?: (v: number) => string;
  tone?: "brand" | "good";
}) {
  if (points.length === 0) {
    return <p className="text-xs text-faint">{emptyMessage}</p>;
  }
  if (points.length === 1) {
    return (
      <p className="text-xs text-dim">
        Single data point: <span className="font-medium text-text">{formatValue(points[0].value)}</span> on {points[0].label}.
      </p>
    );
  }

  const width = 640;
  const height = 140;
  const padX = 4;
  const padTop = 14;
  const padBottom = 22;
  const color = tone === "good" ? "var(--color-good)" : "var(--color-brand)";
  const gradientId = tone === "good" ? "chartFillGood" : "chartFillBrand";

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (width - padX * 2);
    const y = padTop + (height - padTop - padBottom) - ((p.value - min) / range) * (height - padTop - padBottom);
    return { x, y };
  });

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
  const change = last.value - first.value;

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight text-text">{formatValue(last.value)}</span>
        {change !== 0 && (
          <span className={`text-xs font-medium ${change > 0 ? "text-good" : "text-bad"}`}>
            {change > 0 ? "+" : ""}
            {formatValue(change)}
          </span>
        )}
        <span className="text-[11px] text-faint">since {first.label}</span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
        <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={2.5} fill={color} />
      </svg>
      <div className="flex justify-between text-[10px] text-faint">
        <span>{first.label}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}
