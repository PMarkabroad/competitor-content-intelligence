-- Finishes what 020 started: the discovery -> promotion path still proposed
-- a TIER for each candidate, which is the one place a retired concept could
-- have crept back into the roster. A reviewer approving a candidate would
-- have written a tier onto a brand new competitor row.
--
-- proposed_tier is kept and backfilled from, not dropped, for the same
-- reason competitors.tier is kept: it is the only record of how past
-- candidates were classified, and dropping a column is irreversible.

alter table discovery_candidates add column if not exists proposed_category text;

-- Backfill using the mapping the roster actually used: T2 was the niche
-- competitor set, T3 the viral creators tracked for hook craft only. T1 was
-- a positioning read and never a hook source -- no candidate was ever
-- promoted as one, but if any row carries it, it maps to no category rather
-- than being guessed at.
update discovery_candidates
   set proposed_category = case proposed_tier
       when 'T2' then 'niche_competitor'
       when 'T3' then 'viral_creator'
       else null
   end
 where proposed_category is null
   and proposed_tier is not null;

comment on column discovery_candidates.proposed_tier is
    'DEPRECATED 2026-11-05 (migration 021). Superseded by proposed_category. Retained as a record of how earlier candidates were classified.';
