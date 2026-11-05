"use client";

import { useState } from "react";

export interface ChannelVersion {
  platform: string;
  format: string;
  body: string;
  char_count: number;
  char_limit: number | null;
}

// Reel first: it is the format with the most posts behind it. Everything
// else was retired on 2026-11-05 -- see app/(app)/drafts/page.tsx.
const ORDER = ["reel", "carousel"];

const LABEL: Record<string, string> = {
  reel: "IG Reel",
  carousel: "IG Carousel",
};

export function ChannelVersions({ versions }: { versions: ChannelVersion[] }) {
  const sorted = [...versions].sort(
    (a, b) => ORDER.indexOf(a.format) - ORDER.indexOf(b.format)
  );
  const [active, setActive] = useState(sorted[0]?.format ?? "");
  const [copied, setCopied] = useState(false);
  const current = sorted.find((v) => v.format === active) ?? sorted[0];

  if (sorted.length === 0) return null;

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked in some embedded contexts. The text is on
      // screen and selectable either way, so this fails quietly rather
      // than throwing a dialog at someone mid-task.
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {sorted.map((v) => (
          <button
            key={v.format}
            onClick={() => {
              setActive(v.format);
              setCopied(false);
            }}
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              v.format === active
                ? "bg-brand text-white"
                : "border border-border text-dim hover:text-text"
            }`}
          >
            {LABEL[v.format] ?? v.format}
          </button>
        ))}
        <button
          onClick={copy}
          className="ml-auto rounded border border-border px-2 py-1 text-[11px] text-dim hover:text-text"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {current && (
        <>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-bg px-3 py-2.5 font-sans text-xs leading-relaxed text-text">
            {current.body}
          </pre>
          <p className="mt-1 text-[10px] text-faint tabular-nums">
            {current.char_count.toLocaleString()} characters
            {current.char_limit
              ? ` — limit ${current.char_limit.toLocaleString()}`
              : " — no fixed limit"}
          </p>
        </>
      )}
    </div>
  );
}
