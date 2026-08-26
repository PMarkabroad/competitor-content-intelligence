# Known limitations

Things that are known gaps, deliberately not fixed yet. Not bugs -- design
tradeoffs made under time/roster constraints, logged so they don't get
rediscovered from scratch later.

## Carousels are excluded from the hook corpus entirely

`v_competitor_baseline` and `v_outliers` only ever consider `post_type =
'Video'` (migration 004) -- carousels and static images never enter
scoring, because Instagram doesn't report a view count for them, so `vpf`
is always null.

**This throws away a real hook source.** Wonsulting posts almost
exclusively carousels right now (19 of the last 20 non-pinned posts, as of
2026-08-25) and is excluded from the entire scoring pipeline as a result --
not because the account is a bad fit, but because the metric this system
is built around (views per follower) doesn't exist for their current
format. An account that's genuinely good at carousel hooks is invisible to
`hook_library` no matter how well those carousels perform on likes/saves/
comments.

Not fixing this now because: it needs a second engagement metric for
non-video content (likes-per-follower or a comment/save-weighted score,
since carousels have no views), a decision on whether that metric is
comparable to `vpf` at all (probably not directly -- different
distribution, different audience behavior), and a real design pass on
`hook_library`'s `format` enum (`carousel_as_reel` already exists as a
value, suggesting this was anticipated but never wired up end-to-end).

If Wonsulting-style carousel-first accounts become common in the T2/T3
roster, this is worth revisiting before it silently biases the hook corpus
toward whichever accounts happen to favor video.

## `topic_slug` still contains `visa-time-pressure` and `visa-pr-blocker` -- keep them

Migration 001's `topic_slug` CHECK constraint has two visa-related values.
This looks like it contradicts the pipeline's own rule against migration
advice (`regulated` accounts are hard-blocked at the DB level, migration
009) and it was flagged as a possible inconsistency when migration 012
extended `hook_pattern` (2026-08-26).

**It isn't a contradiction, and it's deliberate.** These two values tag
what the *audience* is anxious about -- visa timing pressure, PR as a
blocker to career decisions -- not what the *content* recommends doing
about it. A hook can be tagged `visa-time-pressure` and still pass
`brand_fit` cleanly, so long as it doesn't cross into telling someone what
to do about their visa (that's what `brand_fit`/the `regulated` lock
actually gate). Tracking the pain point is market research; dispensing
migration advice is the regulated activity. Those are different axes, and
collapsing them would throw away real signal about what this audience is
actually stressed about, which is exactly the kind of thing a hook corpus
should be able to say.

`reference/arkabroad-voice.md`'s `brand_fit` check is what actually
enforces the "never gives migration advice" rule at the content level, not
`topic_slug`. Don't remove these two values from the constraint, and don't
add a third by generalizing them into a broader `migration` category --
the taxonomy stays exactly as scoped: audience pain points that happen to
be visa-related are fine to tag; a hook that itself advises on visa/PR
status is what `brand_fit`/`regulated` exist to catch, and always will,
regardless of this constraint. (New tagging via the dashboard's
`/reels/[post_id]` form deliberately excludes both values from its
dropdown anyway -- not because they're wrong to use, but because the
form's own topic list was scoped down to the taxonomy's non-visa values on
the same 2026-08-26 pass, to keep new tagging from casually reaching for
them without the context in this note.)
