-- 103: deleting a message somebody else wrote to you, for you only.
--
-- A message's author may delete it, and that removes it for everybody (the
-- event log keeps a record that it existed). Somebody else's message is not
-- theirs to remove from the other side's screen, so deleting it hides it from
-- the one person who pressed Delete, here, and from nobody else.
--
-- Per person, not per side: a teammate hiding a message does not hide it for
-- you. Removed with the message when its author deletes it.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS message_hides (
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  hidden_at   TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_message_hides_user ON message_hides(user_id);
