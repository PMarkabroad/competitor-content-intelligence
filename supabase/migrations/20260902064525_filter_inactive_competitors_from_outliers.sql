-- Recovered from the remote migration history on 2026-09-04.
--
-- This change was applied straight to the database (via the Supabase
-- dashboard/MCP) without a file in this repo, so `supabase db push`
-- refused to run: remote had migration versions local had never heard
-- of. The SQL below is the exact recorded statement set, written back
-- so local and remote history agree again.

CREATE OR REPLACE VIEW v_outliers AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (competitor_snapshots.competitor_id) competitor_snapshots.competitor_id,
    competitor_snapshots.followers
  FROM competitor_snapshots
  ORDER BY competitor_snapshots.competitor_id, competitor_snapshots.scraped_at DESC
), banded AS (
  SELECT ls.competitor_id,
    ls.followers,
    CASE
      WHEN ls.followers < 10000 THEN 0.05
      WHEN ls.followers < 250000 THEN 0.01
      ELSE 0.005
    END AS min_median_vpf,
    CASE
      WHEN ls.followers < 10000 THEN 1000
      WHEN ls.followers < 250000 THEN 5000
      ELSE 20000
    END AS min_outlier_views
  FROM latest_snapshot ls
), ranked AS (
  SELECT m.post_id,
    m.competitor_id,
    m.posted_at,
    m.views,
    m.vpf,
    b.baseline_median_vpf,
    m.vpf::double precision / b.baseline_median_vpf AS outlier_score,
    row_number() OVER (PARTITION BY m.competitor_id ORDER BY m.vpf DESC) AS rank_in_window
  FROM v_post_metrics m
    JOIN v_competitor_baseline b ON b.competitor_id = m.competitor_id
    JOIN competitors c ON c.competitor_id = m.competitor_id
    JOIN banded bd ON bd.competitor_id = m.competitor_id
  WHERE m.vpf IS NOT NULL
    AND lower(m.post_type) = 'video'
    AND c.tier = ANY (ARRAY['T2','T3'])
    AND c.active = true
    AND m.posted_at >= (now() - '30 days'::interval)
    AND COALESCE(m.paid_partnership, false) = false
    AND COALESCE(m.is_repost, false) = false
    AND b.baseline_median_vpf >= bd.min_median_vpf::double precision
    AND m.views >= bd.min_outlier_views
    AND NOT (EXISTS (SELECT 1 FROM competitor_transcripts t WHERE t.post_id = m.post_id))
)
SELECT post_id, competitor_id, posted_at, views, vpf, baseline_median_vpf, outlier_score
FROM ranked
WHERE rank_in_window <= 5 AND outlier_score >= 2::double precision
ORDER BY outlier_score DESC;
