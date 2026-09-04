"use client";

import { useState, useTransition } from "react";
import { saveWhy } from "./actions";

/**
 * One hook plus its note. Saves on blur rather than behind a submit button:
 * the whole point of this page is working down a list without a round trip
 * per row, and a per-row Save turns 82 notes into 82 clicks.
 */
export function AnnotateRow({
  hookId,
  initial,
}: {
  hookId: string;
  initial: string | null;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState<"idle" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();
  // Compared on blur so re-focusing a field and tabbing straight out
  // doesn't fire a pointless write.
  const [lastSaved, setLastSaved] = useState(initial ?? "");

  function commit() {
    if (value.trim() === lastSaved.trim()) return;
    startTransition(async () => {
      try {
        await saveWhy(hookId, value);
        setLastSaved(value);
        setSaved("saved");
      } catch {
        setSaved("error");
      }
    });
  }

  return (
    <div className="mt-2">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (saved !== "idle") setSaved("idle");
        }}
        onBlur={commit}
        rows={2}
        placeholder="Why did this land? The mechanism, not a description — what it does to the viewer in the first two seconds."
        className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-xs leading-relaxed text-text placeholder:text-faint focus:border-brand focus:outline-none"
      />
      <div className="mt-1 h-4 text-[10px]">
        {pending && <span className="text-faint">Saving…</span>}
        {!pending && saved === "saved" && <span className="text-brand">Saved</span>}
        {!pending && saved === "error" && (
          <span className="text-brand">Could not save — your text is still here, try again.</span>
        )}
      </div>
    </div>
  );
}
