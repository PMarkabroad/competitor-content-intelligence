"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { APPROVED_COUNT_COOKIE } from "@/lib/constants";

export async function approveCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidate_id") ?? "");
  const proposedTier = String(formData.get("proposed_tier") ?? "");
  const market = String(formData.get("market") ?? "");
  const reviewedBy = String(formData.get("reviewed_by") ?? "").trim();
  if (!candidateId || !proposedTier || !market || !reviewedBy) {
    throw new Error("candidate_id, proposed_tier, market and your name are required to approve.");
  }

  const supabase = getSupabaseServerClient();

  const { data: candidate, error: fetchError } = await supabase
    .from("discovery_candidates")
    .select("*")
    .eq("candidate_id", candidateId)
    .single();
  if (fetchError || !candidate) {
    throw new Error(`Could not load candidate: ${fetchError?.message ?? "not found"}`);
  }

  // Defense in depth -- the DB constraint (migration 009) already refuses
  // promoted=true with classification='regulated', but fail here with a
  // readable message rather than an opaque constraint-violation error.
  if (candidate.classification === "regulated") {
    throw new Error("Refusing to approve: classification is 'regulated'. The database would refuse this anyway.");
  }

  const { error: insertError } = await supabase.from("competitors").insert({
    name: candidate.display_name || candidate.handle,
    tier: proposedTier,
    market,
    platform: candidate.platform,
    handle: candidate.handle,
    profile_url: candidate.profile_url,
    handle_verified: true,
    active: true,
    notes: `Approved via dashboard ${new Date().toISOString().slice(0, 10)} by ${reviewedBy}. found_via="${candidate.found_via}", video_posts_90d=${candidate.video_posts_90d}, median_vpf_90d=${candidate.median_vpf_90d}, classification=${candidate.classification}.`,
  });
  if (insertError) {
    throw new Error(`Failed to insert into competitors: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from("discovery_candidates")
    .update({
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      proposed_tier: proposedTier,
      promoted: true,
    })
    .eq("candidate_id", candidateId);
  if (updateError) {
    throw new Error(`Approved into competitors but failed to mark discovery_candidates: ${updateError.message}`);
  }

  // Session-scoped (no maxAge -- clears when the browser session ends),
  // just a running counter for the page header, not an audit trail (the
  // real record is discovery_candidates.reviewed_by/reviewed_at above).
  const cookieStore = await cookies();
  const current = Number(cookieStore.get(APPROVED_COUNT_COOKIE)?.value ?? "0");
  cookieStore.set(APPROVED_COUNT_COOKIE, String(current + 1), { path: "/" });

  revalidatePath("/review");
}

export async function rejectCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidate_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const reviewedBy = String(formData.get("reviewed_by") ?? "").trim() || "unknown";
  if (!candidateId || !reason) {
    throw new Error("candidate_id and a reason are required to reject.");
  }

  const supabase = getSupabaseServerClient();

  // Reuses gate_result='fail' rather than a new column -- a human
  // rejection and a behavioral gate failure both mean the same thing for
  // every downstream query in this pipeline: this candidate does not
  // proceed. gate_fail_reason carries the human's reason instead of a
  // gate-derived one.
  const { error } = await supabase
    .from("discovery_candidates")
    .update({
      gate_result: "fail",
      gate_fail_reason: `Rejected via dashboard: ${reason}`,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq("candidate_id", candidateId);
  if (error) {
    throw new Error(`Failed to reject: ${error.message}`);
  }

  revalidatePath("/review");
}
