-- Separates accounts we COMPETE with from accounts we only study.
--
-- There is an existing niche_match column (direct/analogue/format), but it
-- is nullable, unset on most rows, and describes how close a competitor's
-- topic is -- not whether their numbers belong in our benchmarks. Those are
-- different questions, and conflating them is what let a lifestyle account
-- with 400k followers sit in the same median as a career coach with 9k.
--
--   niche_competitor -- same topics as Ark (study/work abroad, job search,
--                       migration). Their performance IS our benchmark.
--   viral_creator    -- lifestyle/adjacent. Tracked for hook and format
--                       craft only. Must be excluded from benchmarks: a
--                       viral lifestyle account's baseline is an order of
--                       magnitude off a niche coach's, so including them
--                       drags the median and makes real outliers invisible.
--
-- Nullable with no default on purpose. An unset category is a visible gap
-- to fix, whereas defaulting to either value would silently assert a
-- judgement nobody made.

alter table competitors add column if not exists category text;

alter table competitors drop constraint if exists competitors_category_check;
alter table competitors add constraint competitors_category_check
    check (category is null or category in ('niche_competitor', 'viral_creator'));

create index if not exists competitors_category_idx on competitors (category);

comment on column competitors.category is
    'niche_competitor = same topics as Ark, counts toward benchmarks. viral_creator = adjacent, hooks/formats only, excluded from benchmarks.';
