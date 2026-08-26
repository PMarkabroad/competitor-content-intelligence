-- Adds the --classify stage's storage and a hard, DB-level lock against
-- ever promoting a 'regulated' account -- found necessary after the AU
-- sweep showed only 6 of 37 gated passers were genuine career-coaching
-- accounts (16%); the other 31 were behaviorally healthy but semantically
-- wrong (lifestyle vloggers) or, in two cases (nazanin.migration,
-- pathwaytoaus), migration agents that must never be promoted regardless
-- of performance. Behavioral gates cannot make that distinction --
-- classification runs before --gate now, not as a note applied after.

alter table discovery_candidates add column if not exists classification text
  check (classification in ('career_coach', 'adjacent', 'irrelevant', 'regulated'));
alter table discovery_candidates add column if not exists classification_reason text;

-- Hard exclusion, not a note: a 'regulated' row can never carry
-- promoted = true, enforced at the schema level so it can't be
-- re-decided (accidentally or otherwise) on a future sweep or by a
-- future script that doesn't know about this rule.
alter table discovery_candidates add constraint discovery_candidates_no_regulated_promotion
  check (not (promoted = true and classification = 'regulated'));

create index if not exists idx_discovery_candidates_classification on discovery_candidates (classification);
