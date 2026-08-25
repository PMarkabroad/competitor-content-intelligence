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
