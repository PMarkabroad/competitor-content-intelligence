-- Carousel scoring: a second, parallel scoring chain for posts that have no
-- view count at all.
--
-- The existing chain (v_post_metrics -> v_competitor_baseline -> v_outliers)
-- is built on vpf, views per follower, and is video-only on purpose. That
-- leaves Instagram carousels structurally unscoreable: of the 1,342 posts on
-- the current roster, 264 are Sidecar (carousel) and every single one has a
-- null view count, because Instagram does not report views for them. They
-- were not scoring badly -- they could not enter the scoring at all, so a
-- quarter of the collected evidence was invisible to every ranking.
--
-- This chain scores them on what Instagram DOES report for a carousel: likes
-- and comments. It is deliberately SEPARATE from the vpf chain rather than
-- merged into it. A carousel's engagement-per-follower and a reel's
-- views-per-follower are different units measuring different behaviours, and
-- putting them in one ranking would mean comparing them -- which would be a
-- made-up number wearing the clothes of a real one. Two chains, two
-- rankings, shown side by side.

-- The weight comments carry relative to a like, as ONE named thing.
--
-- 10, because on this roster a comment is roughly an order of magnitude
-- scarcer than a like: the median carousel runs a 2.6% comment-to-like ratio.
-- Weighting them equally would make the score a like count with rounding
-- error; ignoring comments would throw away the stronger intent signal, since
-- commenting costs more effort than tapping a heart.
--
-- A function rather than a literal repeated through the views below, so
-- retuning it is a one-line migration instead of a hunt. config.ts does NOT
-- carry a copy -- the dashboard reads the already-computed score out of these
-- views, so this stays the only definition and the two cannot drift.
create or replace function carousel_comment_weight() returns numeric
    language sql immutable parallel safe
as $fn$ select 10::numeric $fn$;

-- Does this caption gate something behind a comment or a DM?
--
-- "Comment WORD and I'll send you the template" does not measure interest in
-- the post, it measures interest in the thing behind the gate, and it inflates
-- comment counts by roughly an order of magnitude. Measured on the current
-- roster's 264 carousels: the 67 posts these patterns catch run an 11.2%
-- median comment-to-like ratio against 2.6% for the other 197.
--
-- Left IN the rankings but kept OUT of the median that defines normal (see
-- v_carousel_baseline). A gated post genuinely did outperform and is worth
-- seeing; what it must not do is redefine the account's baseline upward and
-- so hide every ungated post that beat it honestly.
--
-- This detects the device in CAPTIONS. dashboard/lib/shapes.ts detects the
-- same device in narrative STRUCTURE, via the Lead magnet shape's
-- commentGated flag and isCommentGated(). Two places because they read two
-- different fields; one concept, cross-referenced in both directions.
create or replace function is_comment_bait(caption text) returns boolean
    language sql immutable parallel safe
as $fn$
    select coalesce(caption, '') ~* any (array[
        -- comment "WORD" / comment WORD below|and|to -- the classic gate.
        -- No space required before the quote: COMMENT"GKS" IF YOU WANT A FULL
        -- ROADMAP was a real miss on the first pass of this.
        $re$comment\s*["'“‘][A-Za-z][A-Za-z0-9'-]{1,20}$re$,
        $re$\mcomment(\s+(the\s+word|with|me))?\s+[A-Za-z][A-Za-z0-9'-]{1,20}\s*(below|down below|and|to|for|&)$re$,
        -- comment ... and I'll send/DM/share it
        $re$\mcomment\M[^.!?]{0,60}\m(i|we)('|’)?ll\s+(send|dm|share|give|drop)$re$,
        -- type WORD below / in the comments
        $re$\mtype\s+["'“‘]?[A-Za-z][A-Za-z0-9'-]{1,20}["'”’]?\s*(below|in the comments)$re$,
        -- DM me the word WORD / DM WORD
        $re$\mdm\s+(me\s+)?(the\s+word\s+)?["'“‘]?[A-Za-z][A-Za-z0-9'-]{1,20}$re$,
        -- drop a WORD / comment 'WORD'
        $re$\mdrop\s+a\s+["'“‘]?[A-Za-z]$re$,
        -- comment ... link (in bio / below)
        $re$\mcomment\M[^.!?]{0,40}\mlink\M$re$
    ]);
$fn$;

-- v_carousel_metrics -------------------------------------------------------
-- One row per carousel, with the engagement-per-follower it earned.
--
-- Sidecar ONLY, not Image. Both lack a view count, but a Sidecar is a
-- multi-slide carousel -- a deliberate format with a hook slide, a sequence
-- and a payoff, which is the craft this pipeline exists to read. A single
-- Image is a different object with nothing to learn from its structure, and
-- including the 48 of them would dilute every carousel median with posts that
-- were never carousels.
--
-- Followers come from the post row's own followers_at_scrape where present,
-- falling back to the nearest snapshot at or before the scrape -- the same
-- lateral join v_post_metrics uses, so the two chains divide by the same
-- notion of "followers at the time".
create or replace view v_carousel_metrics as
select
    p.post_id,
    p.competitor_id,
    p.posted_at,
    p.post_url,
    p.caption,
    p.likes,
    p.comments,
    p.paid_partnership,
    p.is_repost,
    coalesce(p.followers_at_scrape, s.followers) as followers,
    is_comment_bait(p.caption) as comment_bait,
    -- The score itself: weighted engagement per follower, so a 3k-follower
    -- account's 400-like carousel and a 300k account's 4,000-like carousel
    -- are on the same footing -- exactly what vpf does for video.
    case
        when coalesce(p.followers_at_scrape, s.followers) is null
          or coalesce(p.followers_at_scrape, s.followers) = 0 then null
        else (coalesce(p.likes, 0) + carousel_comment_weight() * coalesce(p.comments, 0))::numeric
             / coalesce(p.followers_at_scrape, s.followers)
    end as epf,
    -- Kept visible rather than only used internally: it is the number that
    -- shows WHY a post was flagged as comment-bait, and the number a human
    -- checking the flag will want to see.
    case
        when coalesce(p.likes, 0) = 0 then null
        else coalesce(p.comments, 0)::numeric / p.likes
    end as comment_to_like
from competitor_posts p
left join lateral (
    select followers
    from competitor_snapshots s
    where s.competitor_id = p.competitor_id
      and s.scraped_at <= p.last_scraped_at
    order by s.scraped_at desc
    limit 1
) s on true
where p.post_type = 'Sidecar';

-- v_carousel_baseline ------------------------------------------------------
-- Each account's own normal carousel, as a median epf over 90 days.
--
-- Median, not mean, for the same reason the vpf baseline uses one: a single
-- breakout would otherwise drag the baseline up and hide itself.
--
-- Comment-bait carousels are excluded from the median but stay eligible to be
-- ranked against it. An account that gates every third post would otherwise
-- set itself an inflated "normal" that its ordinary posts could never clear.
--
-- At least 4 carousels in the window. Below that a median is one or two posts
-- wearing a statistic's clothes. 4 rather than the vpf chain's 5 because
-- carousels are the scarcer format -- on the current roster, 4 keeps 14 of
-- the 19 accounts that post carousels at all, where 5 would keep 13 and 6
-- would keep 12. carousels_in_window is carried through to v_carousel_outliers
-- and shown in the dashboard, so a baseline resting on exactly 4 posts is
-- labelled as thin rather than presented as settled.
create or replace view v_carousel_baseline as
select
    competitor_id,
    percentile_cont(0.5) within group (order by epf) as baseline_median_epf,
    count(*) as carousels_in_window
from v_carousel_metrics
where epf is not null
  and comment_bait = false
  and posted_at >= now() - interval '90 days'
  and coalesce(paid_partnership, false) = false
  and coalesce(is_repost, false) = false
group by competitor_id
having count(*) >= 4;

-- v_carousel_outliers ------------------------------------------------------
-- Carousels that beat their own account's carousel normal by 2x or more.
--
-- Same shape as v_outliers so the two rankings read alike: top 5 per account,
-- a 30-day window, paid partnerships and reposts excluded, ordered by how far
-- clear of their own baseline they got.
--
-- No minimum-views band here -- there are no views. likes >= 10 stands in for
-- it: below that, both the score and the comment-to-like ratio are noise, and
-- a 2-like carousel "beating its baseline 4x" is arithmetic, not performance.
--
-- Transcribed posts are NOT excluded the way v_outliers excludes them. That
-- exclusion exists because a transcribed video has already been mined for its
-- hook; a carousel has no audio to transcribe, so its hook comes from the
-- caption's first line instead (hook_library.media_kind='carousel',
-- source='caption') and the two never collide.
create or replace view v_carousel_outliers as
with ranked as (
    select
        m.post_id,
        m.competitor_id,
        m.posted_at,
        m.post_url,
        m.likes,
        m.comments,
        m.followers,
        m.epf,
        m.comment_bait,
        m.comment_to_like,
        b.baseline_median_epf,
        b.carousels_in_window,
        m.epf / b.baseline_median_epf as carousel_score,
        row_number() over (partition by m.competitor_id order by m.epf desc) as rank_in_window
    from v_carousel_metrics m
    join v_carousel_baseline b on b.competitor_id = m.competitor_id
    join competitors c on c.competitor_id = m.competitor_id
    where m.epf is not null
      and b.baseline_median_epf > 0
      and c.tier in ('T2', 'T3')
      and m.posted_at >= now() - interval '30 days'
      and coalesce(m.likes, 0) >= 10
      and coalesce(m.paid_partnership, false) = false
      and coalesce(m.is_repost, false) = false
)
select
    post_id,
    competitor_id,
    posted_at,
    post_url,
    likes,
    comments,
    followers,
    epf,
    comment_bait,
    comment_to_like,
    baseline_median_epf,
    carousels_in_window,
    carousel_score
from ranked
where rank_in_window <= 5
  and carousel_score >= 2
order by carousel_score desc;

-- hook_library: where a hook came from -------------------------------------
-- Until now every row in hook_library came from a transcript of a video, so
-- neither column needed to exist. Carousel hooks come from the caption's
-- first line, and a ranking or a draft that cannot tell the two apart would
-- quietly compare a spoken opening line with a written one.
--
-- Defaults describe every existing row, so the backfill is the default.
alter table hook_library add column if not exists media_kind text
    check (media_kind in ('video', 'carousel'));
alter table hook_library add column if not exists source text
    check (source in ('transcript', 'caption'));

update hook_library set media_kind = 'video' where media_kind is null;
update hook_library set source = 'transcript' where source is null;

alter table hook_library alter column media_kind set default 'video';
alter table hook_library alter column source set default 'transcript';

-- One hook per post still, regardless of where it came from.
create index if not exists idx_hook_library_media_kind on hook_library (media_kind);
