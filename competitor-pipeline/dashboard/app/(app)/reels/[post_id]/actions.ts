"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function tagHook(formData: FormData) {
  const postId = String(formData.get("post_id") ?? "");
  const competitorId = String(formData.get("competitor_id") ?? "");
  const taggedBy = String(formData.get("tagged_by") ?? "").trim();
  if (!postId || !competitorId || !taggedBy) {
    throw new Error("post_id, competitor_id and your name are required to tag a hook.");
  }

  const field = (name: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return v.length > 0 ? v : null;
  };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("hook_library").insert({
    post_id: postId,
    competitor_id: competitorId,
    opening_line: field("opening_line"),
    hook_pattern: field("hook_pattern"),
    format: field("format"),
    topic_slug: field("topic_slug"),
    sub_topic: field("sub_topic"),
    content_angle: field("content_angle"),
    cta: field("cta"),
    narrative_structure: field("narrative_structure"),
    au_transplant: field("au_transplant"),
    transplant_note: field("transplant_note"),
    brand_fit: field("brand_fit"),
    brand_fit_note: field("brand_fit_note"),
    why_it_performed: field("why_it_performed"),
    outlier_score: formData.get("outlier_score") ? Number(formData.get("outlier_score")) : null,
    vpf: formData.get("vpf") ? Number(formData.get("vpf")) : null,
    duration_seconds: formData.get("duration_seconds") ? Number(formData.get("duration_seconds")) : null,
    tagged_by: taggedBy,
  });
  if (error) throw new Error(`Failed to tag hook: ${error.message}`);

  revalidatePath(`/reels/${postId}`);
}
