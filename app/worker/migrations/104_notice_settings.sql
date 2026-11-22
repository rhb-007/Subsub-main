-- 104: what staff saved for each email SubSub sends on its own.
--
-- One row per notice kind (the keys in shared/notices.js), and only for a
-- notice somebody changed. No row means the standard words, switched on.
-- `enabled` 0 stops that email product-wide; the sender logs the refusal as
-- notice_off, so the mail log says why nothing went. `subject` and `body` are
-- templates with {{placeholders}}; NULL keeps the standard words for that half.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS notice_settings (
  kind        TEXT PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 1,
  subject     TEXT,
  body        TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
