"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

/**
 * Saves one why_it_performed note. Separate from reels/[post_id]'s tagHook,
 * which INSERTS a whole new hook row -- this only ever updates the one
 * human-written field on an existing row, so it can be called on blur
 * without the caller assembling the rest of the record.
 */
export async function saveWhy(hookId: string, text: string) {
  if (!hookId) throw new Error("hookId is required.");
  const trimmed = text.trim();

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("hook_library")
    .update({
      // Cleared back to NULL rather than "" when emptied, so "not written
      // yet" stays a single state -- the report and the draft generator
      // both test for absence, and an empty string is not absent.
      why_it_performed: trimmed.length > 0 ? trimmed : null,
      updated_at: new Date().toISOString(),
    })
    .eq("hook_id", hookId);
  if (error) throw new Error(`Failed to save note: ${error.message}`);

  revalidatePath("/hooks/annotate");
}
