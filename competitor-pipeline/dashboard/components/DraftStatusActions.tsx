"use client";

import { useState, useTransition } from "react";
import { updateDraftStatus } from "@/app/(app)/drafts/actions";

export function DraftStatusActions({
  draftId,
  status,
  hook,
  script,
  caption,
}: {
  draftId: string;
  status: string;
  hook: string;
  script: string;
  caption: string;
}) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = `${hook}\n\n${script}\n\n---\nCaption: ${caption}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked -- ignore, text is still visible on the card
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={handleCopy}
        className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
          copied ? "bg-good-soft text-good" : "bg-white/[0.06] text-dim hover:bg-white/[0.1] hover:text-text"
        }`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      {status !== "used" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => updateDraftStatus(draftId, "used"))}
          className="rounded bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-dim transition-colors hover:bg-good-soft hover:text-good disabled:opacity-50"
        >
          Mark used
        </button>
      )}
      {status !== "dismissed" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => updateDraftStatus(draftId, "dismissed"))}
          className="rounded bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-dim transition-colors hover:bg-bad-soft hover:text-bad disabled:opacity-50"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
