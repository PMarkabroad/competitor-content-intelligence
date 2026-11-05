-- Lets a competitor be inserted without a tier.
--
-- Migration 020 retired tiers and stopped everything reading the column, but
-- left it NOT NULL -- so the first attempt to add a new account after that
-- failed outright: "null value in column tier violates not-null constraint".
-- Deprecating a column is not the same as making it optional, and the
-- difference does not show up until someone inserts.
--
-- Dropping NOT NULL rather than dropping the column: the existing values are
-- the only record of how the roster was tiered, and a column drop is
-- irreversible. New rows simply leave it null, which is now what "this
-- account has no tier, because tiers do not exist" correctly looks like.
--
-- Drop the column itself whenever the historical values stop being worth
-- keeping:  alter table competitors drop column tier;

alter table competitors alter column tier drop not null;
alter table competitors alter column tier drop default;

comment on column competitors.tier is
    'DEPRECATED 2026-11-05 (migrations 020/022). Nothing reads this and new rows leave it null. Retained only as a record of the old tiering; category is the single axis now. Safe to drop.';
