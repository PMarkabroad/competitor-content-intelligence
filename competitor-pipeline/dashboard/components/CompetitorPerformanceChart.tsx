"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const MARKET_COLOR: Record<string, string> = {
  AU: "#60a5fa",
  US: "#f472b6",
  CA: "#4ade80",
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
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="handle"
          tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
          tickLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: "median VPF", angle: -90, position: "insideLeft", fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{
            background: "#16181d",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: "rgba(255,255,255,0.9)" }}
          formatter={(value: number, _name, item) => [value.toFixed(3), `median VPF (${item.payload.market})`]}
        />
        <Bar dataKey="medianVpf" radius={[3, 3, 0, 0]}>
          {data.map((row, i) => (
            <Cell key={i} fill={MARKET_COLOR[row.market] ?? "#60a5fa"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
