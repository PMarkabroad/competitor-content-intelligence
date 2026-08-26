// Session-scoped counter on /review, incremented per approval -- not an
// audit trail (that's discovery_candidates.reviewed_by/reviewed_at), just
// a running count for the page header.
export const APPROVED_COUNT_COOKIE = "dashboard_approved_count";
