"use client";

import { useEffect, useState } from "react";

export const REVIEWER_NAME_KEY = "dashboard_reviewer_name";

// No login anymore, so there's no session to pull a name from. Remembered
// in localStorage (per browser, not shared) instead -- type it once, every
// row's hidden reviewed_by field on this page picks it up.
export function ReviewerNameInput() {
  const [name, setName] = useState("");

  useEffect(() => {
    try {
      setName(localStorage.getItem(REVIEWER_NAME_KEY) ?? "");
    } catch {
      // Private browsing / storage blocked -- field just stays empty.
    }
  }, []);

  return (
    <input
      type="text"
      value={name}
      onChange={(e) => {
        setName(e.target.value);
        try {
          localStorage.setItem(REVIEWER_NAME_KEY, e.target.value);
        } catch {
          // Ignore -- not critical, just won't persist across reloads.
        }
      }}
      placeholder="Your name"
      className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none transition-colors focus:border-brand"
    />
  );
}
