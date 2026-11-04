// Shared rules for reading the carousel ranking, so the page and anything
// else that shows a carousel score agree about when a baseline is too thin
// to lean on.
//
// The scoring itself lives in SQL (migration 019_carousel_scoring.sql) and is
// deliberately NOT duplicated here: the dashboard reads the computed
// carousel_score out of v_carousel_outliers rather than recomputing it, so
// the comment weight has exactly one definition
// (carousel_comment_weight(), currently 10) and the two cannot drift.

/**
 * The minimum carousels an account needs in the 90-day window before it has
 * a median worth measuring against. Mirrors the `having count(*) >= 4` in
 * v_carousel_baseline -- if that changes, change this.
 *
 * 4 rather than the video chain's 5 because carousels are the scarcer
 * format: on the current roster 4 keeps 14 of the 19 accounts that post
 * carousels at all, 5 keeps 13, 6 keeps 12.
 */
export const MIN_CAROUSELS_FOR_BASELINE = 4;

/**
 * Is this baseline thin enough that the score beside it should be read as
 * provisional?
 *
 * A median over 4 or 5 posts is two or three posts wearing a statistic's
 * clothes. It is still worth showing -- the post may well be worth copying
 * -- but the multiple next to it should not be read as settled, which is
 * why these rows are labelled rather than dropped. Same reasoning as
 * rankings.ts's "Early signals": thin evidence shown as thin beats thin
 * evidence hidden, and beats thin evidence mixed in with the firm kind.
 */
export function thinBaseline(carouselsInWindow: number | null | undefined): boolean {
  return (carouselsInWindow ?? 0) < MIN_CAROUSELS_FOR_BASELINE + 2;
}
