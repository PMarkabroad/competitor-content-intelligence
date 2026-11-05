-- Lets a draft run be RESUMED instead of repeated.
--
-- Draft generation now saves each batch as it completes, so a crash no
-- longer discards the posts already written. That fixed one problem and
-- created its mirror image: re-running after a crash had no way to know
-- which posts belonged to the interrupted run, so `--count=50` meant "write
-- 50 MORE", and a run that died at batch 7 would end up at 85 posts with
-- near-duplicates of the first 35.
--
-- run_label is the batch a draft belongs to -- the run date by default. With
-- it, --count=50 means "ensure 50 posts exist for this run", so re-running
-- after a crash tops up the shortfall, never exceeds the target, and feeds
-- the already-saved hooks to the model as angles to avoid.
--
-- Nullable, with no backfill: the 8 drafts written before this existed
-- belong to no labelled run, and inventing a label for them would be
-- fabricating provenance. They simply are not counted toward any run's
-- target, which is correct -- they were not part of one.

alter table generated_drafts add column if not exists run_label text;

create index if not exists idx_generated_drafts_run_label
    on generated_drafts (run_label) where run_label is not null;

comment on column generated_drafts.run_label is
    'Which generation run produced this draft (the run date by default). Lets --count mean "ensure N exist for this run" so an interrupted run resumes instead of duplicating. Null for drafts written before 2026-11-05.';
