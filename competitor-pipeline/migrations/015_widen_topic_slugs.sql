-- Widens topic_slug, which was too narrow to classify a third of the hooks.
--
-- The original eight slugs describe one stage only: getting hired. Six are
-- usable (the two visa ones are excluded from new tagging), and all six are
-- pre-offer -- resume, interviews, callbacks, networking, local experience,
-- application volume. 29 of 82 usable hooks fit none of them, and the
-- highest-scoring hook in the whole library, at 225x, is one of them.
--
-- Reading those 29 back, they fall into five real subjects. Each is added
-- because Ark's reader meets it, not because a competitor posted about it:
--
--   ai-in-job-search      The largest and best-performing cluster by far --
--                         225x, 68x, and three more. AI tools, AI-earned
--                         certificates, what to automate and what not to.
--                         The library could not name its own strongest
--                         subject.
--   first-90-days         Landing the role is the start of the problem our
--                         reader is buying help with, not the end of it.
--   workplace-bias        Accent-based dismissal, appearance and
--                         "professionalism", reporting a manager. Squarely
--                         an internationally-trained person's experience.
--   pay-and-conditions    Unpaid overtime framed as opportunity, PTO that
--                         is not really unlimited, negotiating past base.
--   credential-translation  What an overseas PhD or MBA is actually worth
--                         in an Australian corporate market. This is the
--                         core of the audience's problem.
--
-- Deliberately NOT added: resignation, counteroffers and quitting (4
-- hooks), and executive presence blocking promotion (2). Both describe
-- someone already established in a corporate career. Ark's reader is in a
-- survival job trying to enter one. Those stay unslugged rather than being
-- given a home that would pull the content strategy toward the wrong
-- audience -- see reference/business-definition.md.
--
-- The two visa slugs are kept in the constraint, unchanged: live rows may
-- reference them and dropping a value that existing data uses would fail.
-- They remain excluded from NEW tagging by draft_hook_tags.

alter table hook_library drop constraint if exists hook_library_topic_slug_check;

alter table hook_library add constraint hook_library_topic_slug_check
    check (topic_slug = any (array[
        -- pre-offer: the original set
        'linkedin-networking',
        'interview-performance',
        'resume-not-working',
        'no-local-experience',
        'volume-no-results',
        'no-callbacks',
        -- kept for existing rows only; never applied to new tagging
        'visa-time-pressure',
        'visa-pr-blocker',
        -- added 2026-09-04
        'ai-in-job-search',
        'first-90-days',
        'workplace-bias',
        'pay-and-conditions',
        'credential-translation'
    ]));
