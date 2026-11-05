-- Narrows ready-made posts to Instagram, and to two formats: reel and
-- carousel.
--
-- Ark publishes on Instagram. Every other channel version produced here was
-- being generated, stored and shown on a page, and then not used -- a
-- LinkedIn post and a tweet for every draft, costing a model call each and
-- occupying a filter nobody picked. Narrowing the output to what actually
-- ships is the point; the generator's budget then goes into MORE Instagram
-- posts rather than the same idea restated for channels Ark is not on.
--
-- Three Instagram formats go too: single_image, story and carousel_story.
-- The first two were never the work -- a static image caption and a story
-- frame are not posts in the sense this pipeline means. carousel_story is a
-- closer call: it is a real format and it was half the carousel mix. It goes
-- because the brief is reel + carousel, and because a story carousel and a
-- framework carousel built from the same idea were the one place this
-- generator reliably produced two posts that read as one idea twice.
--
-- NOTHING IS DELETED WITHOUT BEING ARCHIVED FIRST. Every retired row is
-- copied into archive.draft_formats_retired_2026_11_05 before the delete,
-- in the same transaction, so the delete cannot run against a copy that
-- failed. The archive schema is not exposed through PostgREST, so this is
-- not reachable from the dashboard or the anon key -- which is the point.

begin;

create schema if not exists archive;

-- The whole row, not a summary: if this is ever restored, it has to go back
-- as it was, including the generated body text.
create table if not exists archive.draft_formats_retired_2026_11_05
    (like public.draft_formats including defaults excluding constraints excluding indexes);

-- Add a column recording WHY each row was retired. A future reader finding
-- this table needs to know whether a row left because its platform went or
-- because its format did -- those are two different decisions and only one
-- of them is likely to be revisited.
alter table archive.draft_formats_retired_2026_11_05
    add column if not exists retired_reason text;

insert into archive.draft_formats_retired_2026_11_05
select df.*,
       case
           when df.platform <> 'instagram' then 'platform retired: Ark publishes on Instagram only'
           else 'format retired: ready-made posts are reel + carousel only'
       end as retired_reason
from public.draft_formats df
where df.platform <> 'instagram'
   or df.format not in ('reel', 'carousel');

-- Delete exactly what was archived, by the same predicate. Counted after,
-- outside this migration, against the archive table -- a silent partial
-- delete here would be invisible.
delete from public.draft_formats
where platform <> 'instagram'
   or format not in ('reel', 'carousel');

-- The constraint is what stops any of this coming back by accident. A
-- generator bug, a stale prompt or a hand-written insert that tries to write
-- a tweet now fails loudly at the database instead of quietly repopulating
-- a channel Ark does not publish on.
alter table draft_formats drop constraint if exists draft_formats_format_check;
alter table draft_formats add constraint draft_formats_format_check
    check (format in ('reel', 'carousel'));

alter table draft_formats drop constraint if exists draft_formats_platform_check;
alter table draft_formats add constraint draft_formats_platform_check
    check (platform = 'instagram');

commit;
