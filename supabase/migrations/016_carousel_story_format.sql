-- A second Instagram carousel format, so each post can carry two carousels
-- with different shapes: the existing 'carousel' is the framework kind
-- (numbered steps, one idea per slide) and 'carousel_story' is narrative
-- (a beat per slide, told in sequence).
--
-- Added because the format mix was a flat one-of-each -- 11% carousel --
-- and the requested mix is 40% Instagram carousel. Two per post, alongside
-- three rotating other formats, is exactly that. They are distinct format
-- keys rather than two rows under one key because (draft_id, platform,
-- format) is unique and regeneration upserts on it.

alter table draft_formats drop constraint if exists draft_formats_format_check;
alter table draft_formats add constraint draft_formats_format_check
    check (format in (
        'single_image', 'carousel', 'carousel_story', 'reel', 'story',  -- instagram
        'post', 'carousel_pdf',                                          -- linkedin
        'facebook_post', 'facebook_carousel',                            -- facebook
        'tweet'                                                          -- twitter/X
    ));
