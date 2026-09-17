-- Local/dev seed data — mirrors the prototype's demo accounts so the API
-- can be smoke-tested against the same story used in the UI.

INSERT INTO accounts (id, name, subdomain, plan, billing, use_default_mark) VALUES
  ('a1', 'Outerhome', 'outerhome', 'basic', 'monthly', 0),
  ('a2', 'Harbor Point Builders', 'harborpoint', 'scale', 'annual', 1);

INSERT INTO companies (id, company, contact, phone, email, license, ubi, city, state, zip, crews, coverage, insurance, bond, contract, doc_files) VALUES
  ('c1', 'Cascade Roofworks', 'Miguel Alvarez', '206-555-0101', 'miguel@cascaderoof.com', 'CASCARW123AB', '601234567', 'Seattle', 'WA', '98101',
   '[{"id":"cr1","name":"Crew 1","available":true,"unavailableDays":[],"members":[{"name":"Miguel Alvarez","role":"Lead"}]}]',
   '{"mode":"cities","cities":["Seattle","Bellevue"]}',
   1, 1, 1, '{"insurance":"cascade-insurance.pdf","bond":"cascade-bond.pdf","contract":"cascade-agreement.pdf"}'),
  ('c2', 'Emerald Exteriors', 'Dana Cho', '206-555-0102', 'dana@emeraldext.com', 'EMERAEX456CD', '601234568', 'Tacoma', 'WA', '98402',
   '[{"id":"cr2","name":"Crew A","available":true,"unavailableDays":[],"members":[{"name":"Dana Cho","role":"Lead"}]}]',
   '{"mode":"cities","cities":["Tacoma","Auburn"]}', 0, 0, 0, '{}');

INSERT INTO engagements (id, account_id, company_id, status, categories, caps, rating, rated_jobs, auto_schedule, notes, doc_review) VALUES
  ('e1', 'a1', 'c1', 'active', '["roofing"]', '["tear_off"]', 4.8, 9, 0, 'Reliable, on time.',
   '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"}}'),
  ('e2', 'a1', 'c2', 'active', '["siding"]', '[]', 4.2, 3, 0, NULL, '{}'),
  ('e3', 'a2', 'c1', 'active', '["roofing"]', '["tear_off"]', 4.4, 6, 0, 'Roofing only for us.',
   '{"insurance":{"status":"pending"}}');

INSERT INTO users (id, name, email, phone) VALUES
  ('u1', 'Richard Braun', 'rb@outerhome.com', NULL),
  ('u2', 'Alicia Gomez', 'alicia@outerhome.com', NULL),
  ('u5', 'Ross Mather', 'ross@outerhome.com', NULL),
  ('u3', 'Miguel Alvarez', 'miguel@cascaderoof.com', NULL),
  ('u4', 'Dana Cho', 'dana@emeraldext.com', NULL);

INSERT INTO memberships (id, user_id, account_id, role, company_id) VALUES
  ('m1', 'u1', 'a1', 'admin', NULL),
  ('m2', 'u2', 'a1', 'pm', NULL),
  ('m3', 'u5', 'a2', 'admin', NULL),
  ('m4', 'u3', 'a1', 'contractor', 'c1'),
  ('m5', 'u3', 'a2', 'contractor', 'c1'),
  ('m6', 'u4', 'a1', 'contractor', 'c2');
