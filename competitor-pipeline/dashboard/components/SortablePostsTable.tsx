"use client";

import { useMemo, useState } from "react";
import { Badge } from "./Badge";
import { formatNumber, formatVpf, formatScore, formatDate } from "@/lib/format";

export interface PostRow {
  post_id: string;
  post_url: string | null;
  post_type: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  vpf: number | null;
  followers_at_scrape: number | null;
  paid_partnership: boolean | null;
  is_repost: boolean | null;
  outlier_score: number | null;
}

type SortKey = keyof Pick<PostRow, "posted_at" | "views" | "likes" | "comments" | "vpf" | "followers_at_scrape" | "outlier_score">;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "posted_at", label: "Posted" },
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "vpf", label: "VPF" },
  { key: "followers_at_scrape", label: "Followers@scrape" },
  { key: "outlier_score", label: "Outlier score" },
];

export function SortablePostsTable({ posts }: { posts: PostRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("posted_at");
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...posts];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
      return 0;
    });
    return copy;
  }, [posts, sortKey, desc]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setDesc((d) => !d);
    } else {
      setSortKey(key);
      setDesc(true);
    }
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--color-border)]">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-raised)] text-[var(--color-text-faint)]">
            <th className="px-2 py-1.5 font-medium">Type</th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="cursor-pointer select-none px-2 py-1.5 text-right font-medium hover:text-[var(--color-text)]"
                onClick={() => onSort(col.key)}
              >
                {col.label}
                {sortKey === col.key ? (desc ? " ↓" : " ↑") : ""}
              </th>
            ))}
            <th className="px-2 py-1.5 font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.post_id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-hover)]">
              <td className="px-2 py-1.5">
                {p.post_url ? (
                  <a href={p.post_url} target="_blank" rel="noreferrer" className="text-[var(--color-brand)] hover:underline">
                    {p.post_type ?? "post"}
                  </a>
                ) : (
                  p.post_type ?? "—"
                )}
              </td>
              <td className="px-2 py-1.5 text-right">{formatDate(p.posted_at)}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(p.views)}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(p.likes)}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(p.comments)}</td>
              <td className="px-2 py-1.5 text-right font-medium">{formatVpf(p.vpf)}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(p.followers_at_scrape)}</td>
              <td className="px-2 py-1.5 text-right">{p.outlier_score ? formatScore(p.outlier_score) : "—"}</td>
              <td className="px-2 py-1.5">
                <div className="flex gap-1">
                  {p.paid_partnership && <Badge tone="warn">paid</Badge>}
                  {p.is_repost && <Badge tone="neutral">repost</Badge>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
