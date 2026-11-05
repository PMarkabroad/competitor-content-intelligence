-- Two tidying steps on generated_drafts, so run_label means one thing again.
--
-- 1. LABEL THE ORPHANS. 30 drafts were written on 2026-11-05 by a generation
-- process that outlived the shell it was started from -- it kept running for
-- ~35 minutes after being told to stop, and its calls drew on the same
-- Anthropic credit pool as the real run, which is most likely what exhausted
-- it. Those 30 are good work: checked against the 20 from the labelled run,
-- not one hook overlaps. They belong to the same day's effort and the same
-- 87-subject pool, so they are labelled as part of that run. Without this,
-- run_label = null means both "pre-existing" and "orphan", and the archive
-- below could not tell them apart.
--
-- Scoped by DATE as well as by null label: the 8 drafts from 2026-11-04 must
-- not be swept up by this.
update generated_drafts
   set run_label = '2026-11-05'
 where run_label is null
   and created_at >= '2026-11-05'::date
   and created_at < '2026-11-06'::date;

-- 2. ARCHIVE THE PRE-EXISTING 8. Written 2026-11-04 under the old format mix
-- -- when a draft became nine channel versions across four platforms, three
-- of which Ark does not publish on. Their channel versions were already
-- retired in migration 023; these are the drafts themselves.
--
-- Archived whole before deletion, in one transaction, so the delete cannot
-- run against a copy that failed.
begin;

create schema if not exists archive;

create table if not exists archive.generated_drafts_retired_2026_11_05
    (like public.generated_drafts including defaults excluding constraints excluding indexes);

alter table archive.generated_drafts_retired_2026_11_05
    add column if not exists retired_reason text;

insert into archive.generated_drafts_retired_2026_11_05
select d.*, 'pre-existing draft from the old multi-platform format mix, superseded by the 2026-11-05 Instagram-only run'
from public.generated_drafts d
where d.run_label is null;

delete from public.generated_drafts where run_label is null;

commit;
