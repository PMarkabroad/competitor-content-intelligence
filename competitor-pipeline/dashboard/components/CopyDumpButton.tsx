"use client";

import { useState } from "react";

export function CopyDumpButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked (permissions/insecure context) -- nothing
      // useful to recover into here, the text is still visible on the
      // card for manual selection.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
        copied ? "bg-good-soft text-good" : "border border-border bg-surface text-dim hover:bg-surface-hover hover:text-text"
      }`}
    >
      {copied ? "Copied ✓" : "Copy raw dump"}
    </button>
  );
}