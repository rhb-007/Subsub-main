-- 083: replying to a message by email.
--
-- Every message is emailed to the other side, and each person gets their own
-- reply address for each conversation: m-<token>@<MESSAGE_REPLY_DOMAIN>. A
-- reply to it is added to the conversation as that person, and only if it
-- comes from that person's own email address. See app/shared/messaging.js.
--
-- The token is random and stored rather than worked out from the thread and
-- the user, so nobody can build an address that posts into somebody else's
-- conversation. The row also records which seat it was issued to (the account
-- and the side), because the same person can sit on both sides of different
-- conversations. Whether they may still write is checked again on every reply.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS message_reply_tokens (
  token       TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  account_id  TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('home', 'party')),
  created_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_message_reply_tokens_seat
  ON message_reply_tokens(thread_id, user_id, account_id);
