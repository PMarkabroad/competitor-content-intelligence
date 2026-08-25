-- Drops the legacy Prompt-1 schema (competitor_accounts, competitor_posts,
-- post_classifications, collection_runs), superseded by the schema in
-- 001_competitor_schema.sql.
--
-- DO NOT UNCOMMENT AND RUN THIS UNTIL YOU HAVE REVIEWED THE OUTPUT OF
-- `npm run inspect-legacy` (competitor-pipeline/scripts/inspect_legacy.ts)
-- YOURSELF. That script prints the row count and 5 most recent rows for
-- each of these tables, read-only, and changes nothing.
--
-- As of the inspect-legacy run on 2026-08-25, all four tables were empty
-- (0 rows each) -- nothing hand-entered would be lost. If you run
-- inspect-legacy again before applying this and it shows rows, stop and
-- reconsider before uncommenting.
--
-- Note: competitor_posts is a name collision. This drops the OLD
-- competitor_posts (Prompt-1 schema: account_id, post_url, on_screen_text,
-- etc.) before 001_competitor_schema.sql creates a NEW table of the same
-- name with a different shape (competitor_id, platform_post_id, etc.).
-- Applying 001 without first applying this would fail or, if it somehow
-- didn't, silently collide two incompatible schemas under one name.

drop table if exists post_classifications cascade;
drop table if exists competitor_posts cascade;
drop table if exists collection_runs cascade;
drop table if exists competitor_accounts cascade;
