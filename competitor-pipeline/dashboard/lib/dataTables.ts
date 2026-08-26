// Column lists per table for the /data raw browser -- everything except
// `raw` jsonb blobs (full actor payloads, not meant for a row-per-line
// table view; every field a human would actually want is already
// promoted to its own column) and default sort column.

export interface TableConfig {
  name: string;
  columns: string[];
  defaultSort: string;
}

export const DATA_TABLES: TableConfig[] = [
  {
    name: "competitors",
    columns: [
      "competitor_id", "name", "tier", "market", "platform", "handle", "profile_url",
      "niche_match", "scrape_cadence", "posts_per_run", "transcripts_enabled",
      "handle_verified", "active", "last_scraped_at", "notes", "created_at", "updated_at",
    ],
    defaultSort: "created_at",
  },
  {
    name: "discovery_candidates",
    columns: [
      "candidate_id", "platform", "handle", "profile_url", "display_name", "bio", "followers",
      "market_guess", "found_via", "found_at", "video_posts_90d", "median_vpf_90d",
      "last_post_at", "is_private", "band", "gate_result", "gate_fail_reason",
      "relevance_score", "topic_slugs", "proposed_tier", "reviewed_by", "reviewed_at",
      "promoted", "classification", "classification_reason",
    ],
    defaultSort: "found_at",
  },
  {
    name: "competitor_posts",
    columns: [
      "post_id", "competitor_id", "platform_post_id", "post_url", "thumbnail_url", "post_type", "caption",
      "posted_at", "views", "likes", "comments", "shares", "duration_seconds",
      "first_seen_at", "last_scraped_at", "paid_partnership", "is_repost", "followers_at_scrape",
    ],
    defaultSort: "posted_at",
  },
  {
    name: "competitor_snapshots",
    columns: ["snapshot_id", "competitor_id", "scraped_at", "followers", "following", "post_count", "bio"],
    defaultSort: "scraped_at",
  },
  {
    name: "competitor_transcripts",
    columns: ["transcript_id", "post_id", "transcript", "opening_line", "seconds_to_first_claim", "transcribed_at"],
    defaultSort: "transcribed_at",
  },
  {
    name: "hook_library",
    columns: [
      "hook_id", "post_id", "competitor_id", "hook_pattern", "format", "topic_slug", "sub_topic",
      "opening_line", "content_angle", "cta", "narrative_structure", "duration_seconds",
      "outlier_score", "vpf", "au_transplant", "transplant_note",
      "brand_fit", "brand_fit_note", "why_it_performed", "tagged_by", "tagged_at", "updated_at",
    ],
    defaultSort: "tagged_at",
  },
];

export function getTableConfig(name: string | undefined): TableConfig {
  return DATA_TABLES.find((t) => t.name === name) ?? DATA_TABLES[0];
}
