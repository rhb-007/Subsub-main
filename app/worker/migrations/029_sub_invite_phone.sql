-- A mobile number on a subcontractor invite.
--
-- Email is not how this trade answers. A roofer reads a text on a ladder
-- and opens email on Sunday night, if at all, and an invite that only goes
-- to an inbox waits there. Both now go, and either link finishes the same
-- invite -- whichever they pick up first.
--
-- Stored as well as used, so the number the account already typed
-- pre-fills the application form instead of being asked for twice.
ALTER TABLE sub_invites ADD COLUMN phone TEXT;
