"use client";

import { useMemo, useState } from "react";

type Row = Record<string, unknown>;

const PAGE_SIZE = 50;

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function DataTable({ tableName, columns, rows }: { tableName: string; columns: string[]; rows: Row[] }) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const needle = filter.trim().toLowerCase();
    return rows.filter((row) => columns.some((col) => cellToString(row[col]).toLowerCase().includes(needle)));
  }, [rows, filter, columns]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return copy;
  }, [filtered, sortCol, sortDesc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function onSort(col: string) {
    if (col === sortCol) {
      setSortDesc((d) => !d);
    } else {
      setSortCol(col);
      setSortDesc(false);
    }
    setPage(0);
  }

  function exportCsv() {
    const lines = [columns.join(",")];
    for (const row of sorted) {
      lines.push(columns.map((c) => csvEscape(cellToString(row[c]))).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          placeholder="Filter (matches any column)..."
          className="w-64 rounded border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-brand"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-dim">{sorted.length} row(s)</span>
          <button onClick={exportCsv} className="rounded border border-border px-2 py-1 text-xs text-dim hover:bg-surface-hover hover:text-text">
            Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-faint">
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => onSort(col)}
                  className="cursor-pointer select-none whitespace-nowrap px-2 py-1.5 font-medium hover:text-text"
                >
                  {col}
                  {sortCol === col ? (sortDesc ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                {columns.map((col) => (
                  <td key={col} className="max-w-64 truncate px-2 py-1.5 text-dim" title={cellToString(row[col])}>
                    {cellToString(row[col]) || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-dim">
        <span>
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border border-border px-2 py-1 disabled:opacity-30"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded border border-border px-2 py-1 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
