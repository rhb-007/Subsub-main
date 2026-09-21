-- Staff acting inside a customer's account, for as long as it takes to see
-- what they are seeing.
--
-- "Sign in as this account" set the browser's idea of who it was and handed
-- over nothing the API would accept: the staff member's own login has no
-- membership in the customer's account, so every call was refused and the
-- app fell back to its last resort -- role "contractor" with no contractor
-- record -- and showed an empty screen. The button had been advertising a
-- session it could not issue.
--
-- The grant is this row, not the header carrying it. That is the whole
-- point: it expires on its own, it can be handed back, and it is one
-- account and one identity rather than a general-purpose key. A token that
-- leaks is worth half an hour of one customer's account and is revocable
-- the moment anybody notices, which is not true of a signed blob nobody can
-- take back.
--
-- It also cannot reach the platform console: /api/platform/* authenticates
-- staff separately and never consults this table, so an impersonation
-- session can do what the customer can do and nothing more.
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  token           TEXT PRIMARY KEY,          -- 32 bytes from crypto.getRandomValues, hex
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Whose seat they are sitting in. An admin of that account, so the role
  -- and permissions are the customer's own rather than anything invented.
  act_as_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- And who is really doing it. Every request under this token is
  -- attributable to a person, which is what makes the banner's promise
  -- ("actions are recorded") true rather than decorative.
  staff_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT NOT NULL,
  ended_at        TEXT                       -- set when handed back, before it expires
);
CREATE INDEX IF NOT EXISTS idx_impersonation_account
  ON impersonation_sessions(account_id, created_at DESC);
