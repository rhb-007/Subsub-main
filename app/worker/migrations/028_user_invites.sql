-- Telling somebody you have added them.
--
-- Adding a person under Users -> Add created a users row and a membership
-- and sent nothing. No email, no link, nothing. The only way they learned
-- they had an account was being told out loud, and the only way in was
-- noticing "Already invited? Create your password" on the sign-in screen and
-- working out that it meant them. A manager added on a Friday had no way to
-- discover any of that on their own.
--
-- Tenants and subcontractors both get a real invite now. This is the same
-- thing for the people who work at the account, and the last of the three.
--
-- Its own table rather than a row in tenant_invites, which is the closest
-- existing shape. That table's public accept route takes a password and
-- finishes somebody as a tenant; a staff invite sitting in it would be one
-- lookup away from being accepted down that path, and roles are not a thing
-- to be casual about.
--
-- No role column: the membership is written when the admin adds them, so
-- this carries nothing but "prove you own this address and choose a
-- password". Which means a leaked token grants exactly what an already
-- decided membership grants, and nothing it could widen.
CREATE TABLE IF NOT EXISTS user_invites (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  email       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  -- Only set when something actually left. An invite marked sent that never
  -- went is worse than one marked nothing, because somebody waits on it.
  sent_at     TEXT,
  used_at     TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_invites_account ON user_invites(account_id, created_at);
