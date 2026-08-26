"use client";

import { useEffect, useState } from "react";
import { REVIEWER_NAME_KEY } from "./ReviewerName";

const TIERS = ["T1", "T2", "T3"];
const MARKETS = ["AU", "US", "CA"];

export function RowActions({
  candidateId,
  defaultMarket,
  disabledApprove,
  approveAction,
  rejectAction,
}: {
  candidateId: string;
  defaultMarket: string;
  disabledApprove: boolean;
  approveAction: (formData: FormData) => void;
  rejectAction: (formData: FormData) => void;
}) {
  const [reviewerName, setReviewerName] = useState("");

  useEffect(() => {
    try {
      setReviewerName(localStorage.getItem(REVIEWER_NAME_KEY) ?? "");
    } catch {
      // Private browsing / storage blocked -- falls through to the
      // server's "your name" requirement, which will just reject the
      // submission with an empty value.
    }
  }, []);

  return (
    <div className="flex gap-2">
      <form action={approveAction} className="flex flex-col gap-1">
        <input type="hidden" name="candidate_id" value={candidateId} />
        <input type="hidden" name="reviewed_by" value={reviewerName} />
        <select name="proposed_tier" defaultValue="T2" className="rounded-md border border-border bg-bg px-1 py-0.5 text-[11px] text-text">
          {TIERS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select name="market" defaultValue={defaultMarket} className="rounded-md border border-border bg-bg px-1 py-0.5 text-[11px] text-text">
          {MARKETS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={disabledApprove || !reviewerName}
          title={!reviewerName ? "Set your name at the top of the page first" : undefined}
          className="rounded-md bg-good px-2 py-0.5 text-[11px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Approve
        </button>
      </form>
      <form action={rejectAction} className="flex flex-col gap-1">
        <input type="hidden" name="candidate_id" value={candidateId} />
        <input type="hidden" name="reviewed_by" value={reviewerName} />
        <input
          type="text"
          name="reason"
          required
          placeholder="Reason"
          className="w-28 rounded-md border border-border bg-bg px-1 py-0.5 text-[11px] text-text outline-none focus:border-brand"
        />
        <button type="submit" className="rounded-md bg-bad px-2 py-0.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
          Reject
        </button>
      </form>
    </div>
  );
}
