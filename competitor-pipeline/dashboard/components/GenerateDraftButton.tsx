"use client";

import { useState } from "react";

export interface DraftPayload {
  competitor_name: string;
  market: string;
  post_id?: string | null;
  hook_pattern?: string | null;
  format?: string | null;
  content_angle?: string | null;
  narrative_structure?: string | null;
  cta?: string | null;
  why_it_performed?: string | null;
  opening_line?: string | null;
  transcript?: string | null;
  caption?: string | null;
  views?: number | null;
  vpf?: number | null;
  outlier_score?: number | null;
}

interface Draft {
  hook: string;
  script: string;
  caption: string;
}

export function GenerateDraftButton({ payload }: { payload: DraftPayload }) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setDraft(data as Draft);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!draft) return;
    const text = `${draft.hook}\n\n${draft.script}\n\n---\nCaption: ${draft.caption}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked -- text is still visible on the card to select manually.
    }
  }

  if (draft) {
    return (
      <div className="mt-2 rounded border border-brand/30 bg-brand-soft/30 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-brand">
          Ark draft — review before posting
        </p>
        <p className="mb-2 text-sm font-medium text-text">{draft.hook}</p>
        <p className="mb-2 whitespace-pre-wrap text-xs leading-relaxed text-dim">{draft.script}</p>
        <p className="mb-2 text-xs italic text-faint">Caption: {draft.caption}</p>
        <button
          type="button"
          onClick={handleCopy}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            copied ? "bg-good-soft text-good" : "bg-white/[0.06] text-dim hover:bg-white/[0.1] hover:text-text"
          }`}
        >
          {copied ? "Copied ✓" : "Copy draft"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate Ark draft"}
      </button>
      {errorMsg && <p className="mt-1 text-[11px] text-bad">{errorMsg}</p>}
    </div>
  );
}
