"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function updateDraftStatus(draftId: string, status: "used" | "dismissed" | "draft") {
  const supabase = getSupabaseServerClient();
  await supabase.from("generated_drafts").update({ status }).eq("draft_id", draftId);
  revalidatePath("/drafts");
}
