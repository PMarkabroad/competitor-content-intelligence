// How an account is classified, and how that reads to a person.
//
// `category` replaced the old T1/T2/T3 tiers in migration 020. Tier had
// become a second name for the same split -- T2 was all 14 niche_competitor,
// T3 all 9 viral_creator -- while category was the one actually driving the
// rankings, via benchmarkRows() in rankings.ts. Two names for one thing is
// how a reader ends up unsure which governs, so there is one now.

export const CATEGORIES = ["niche_competitor", "viral_creator"] as const;

/** Human-facing label. The raw value is a database enum, not English. */
export function categoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "niche_competitor":
      return "Competitor";
    case "viral_creator":
      return "Viral creator";
    default:
      return "Uncategorised";
  }
}

/**
 * One line on what the classification means for how the account is read.
 * Shown next to the label so the distinction does not have to be remembered:
 * viral creators are tracked for hook craft and kept OUT of benchmark
 * averages, because a lifestyle reel at 400x its own modest baseline would
 * otherwise outrank a career coach's genuinely strong 12x.
 */
export function categoryBlurb(category: string | null | undefined): string {
  switch (category) {
    case "niche_competitor":
      return "In Ark's space. Counts toward benchmarks.";
    case "viral_creator":
      return "Tracked for hook craft only. Excluded from benchmark averages.";
    default:
      return "No category set -- still counted, but worth classifying.";
  }
}
