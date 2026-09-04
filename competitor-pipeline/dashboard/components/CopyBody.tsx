"use client";

import { useState } from "react";

/**
 * Copy button for one channel body. A client island inside an otherwise
 * server-rendered list, so the platform views stay server-rendered and
 * filterable by URL.
 */
export function CopyBody({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked in some embedded contexts. The text is on
      // screen and selectable anyway, so this fails quietly rather than
      // interrupting someone mid-task.
    }
  }

  return (
    <button
      onClick={copy}
      className="rounded border border-border px-2 py-1 text-[11px] text-dim transition-colors hover:text-text"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
