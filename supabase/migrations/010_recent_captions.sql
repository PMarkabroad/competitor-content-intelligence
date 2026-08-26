-- --classify needs bio + 3 recent captions per candidate, but must be
-- independently runnable (like every other discover.ts stage) at a
-- different time than --profile. Persist the captions --profile already
-- fetches (bumped from resultsPerPage=1 to 3 for this reason) rather than
-- passing them in-memory between stages that may run in separate
-- invocations, hours or days apart.

alter table discovery_candidates add column if not exists recent_captions text[];
