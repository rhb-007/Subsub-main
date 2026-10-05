-- 069. THE PAPER EACH LINK IN A WAIVER CHAIN IS MADE OF.
--
-- 035 built the chain -- who signs to whom, through what date, and whether it
-- is clear -- and deliberately authored nothing. Nothing wrote a row either,
-- so the gate on every release has answered "no waiver has been requested
-- yet" since it shipped, and the only way past it was the override.
--
-- This is what a request, a signature and an upload need on top of 035, and
-- it is ONE TABLE RATHER THAN SIX `ADD COLUMN`s for the reason 048, 057, 063
-- and 066 all chose a table: `ALTER TABLE ... ADD COLUMN` is the one
-- statement that cannot be run twice, so six of them is six pastes and an
-- operator who has to get the order right. Every statement here is
-- `IF NOT EXISTS`; running the file again does nothing.
--
-- WHOSE PAPER. `subsub_standard` is SubSub's own form, rendered and signed in
-- the app -- only in a state that prescribes no form, because twelve states
-- set the wording in statute and a waiver on any other form can be void.
-- `uploaded` is signed outside the app and uploaded. See shared/waiverform.js.
--
-- EVERYTHING IS STAMPED. The parties are written here as they read at
-- request, and the template id AND version with them, so a company renamed
-- next year cannot change a waiver signed this year -- and so the hash taken
-- at signature can be reproduced from what is stored, which is the whole of
-- what makes it worth anything. Same rule as `agreements` and
-- `lien_waivers.governing_state`.
CREATE TABLE IF NOT EXISTS waiver_forms (
  waiver_id        TEXT PRIMARY KEY REFERENCES lien_waivers(id) ON DELETE CASCADE,
  source           TEXT NOT NULL CHECK (source IN ('subsub_standard', 'uploaded')),
  template_id      TEXT,
  template_version TEXT,
  -- claimant, customer, job, property: the words printed in the document.
  parties          TEXT NOT NULL DEFAULT '{}',
  -- An upload: what it was called and what it was. The bytes are in R2 under
  -- lien_waivers.doc_key, and lien_waivers.doc_sha256 is their hash.
  file_name        TEXT,
  file_type        TEXT,
  uploaded_by      TEXT REFERENCES users(id),
  -- Which side put the signed copy here. The claimant uploading their own
  -- signed form is a signature; the paying side uploading one they were
  -- emailed is a record of a signature somebody else made, and the screen
  -- has to be able to say which.
  uploaded_side    TEXT CHECK (uploaded_side IN ('claimant', 'recipient')),
  -- Whether the request email went. A row reading "sent" over a supplier who
  -- was never told is how somebody says they never got it while the screen
  -- says they did.
  emailed          INTEGER NOT NULL DEFAULT 0,
  answered_at      TEXT,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ONE OPEN REQUEST PER LINK AND KIND. A second identical request is two links
-- in one inbox and a list that reads as two problems; the route answers
-- `already_requested` for the sequential case, and this is what is correct
-- when two presses arrive at once. PARTIAL, on `requested` only, so a waiver
-- declined or withdrawn can be asked for again.
CREATE UNIQUE INDEX IF NOT EXISTS ux_waiver_open
  ON lien_waivers (release_id, kind) WHERE status = 'requested' AND tier = 0 AND release_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_waiver_open_lower
  ON lien_waivers (parent_id, from_email, kind) WHERE status = 'requested' AND parent_id IS NOT NULL;
