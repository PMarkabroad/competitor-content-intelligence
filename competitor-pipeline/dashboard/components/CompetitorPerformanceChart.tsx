"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

// Recharts takes literal colours rather than CSS classes, so these have to
// be values rather than theme tokens. They're chosen to sit on the light
// ground defined in globals.css -- the previous set was white-alpha grid
// lines and a near-black tooltip, which were invisible or inverted once the
// theme went light. Keep them in step if the palette changes again.
const INK = "#17171a";
const MUTED = "#86868f";
const HAIRLINE = "#e4e4de";

// One hue per market, all dark enough to read as bars on a light ground and
// distinguishable without relying on hue alone being obvious.
const MARKET_COLOR: Record<string, string> = {
  AU: "#0f6b62", // petrol, the brand colour
  US: "#7a4fbf", // violet
  CA: "#b3671a", // amber-brown
};

export interface ChartRow {
  handle: string;
  market: string;
  medianVpf: number;
}

export function CompetitorPerformanceChart({ data }: { data: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} vertical={false} />
        <XAxis
          dataKey="handle"
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: HAIRLINE }}
          tickLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: "median VPF", angle: -90, position: "insideLeft", fill: MUTED, fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "rgba(23,23,26,0.04)" }}
          contentStyle={{
            background: "#ffffff",
            border: `1px solid ${HAIRLINE}`,
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "0 4px 12px -4px rgba(23,23,26,0.12)",
          }}
          labelStyle={{ color: INK }}
          formatter={(value: number, _name, item) => [value.toFixed(3), `median VPF (${item.payload.market})`]}
        />
        <Bar dataKey="medianVpf" radius={[3, 3, 0, 0]}>
          {data.map((row, i) => (
            <Cell key={i} fill={MARKET_COLOR[row.market] ?? MARKET_COLOR.AU} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
