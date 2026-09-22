-- Fixture for scripts/tenant-notify-test.mjs, on top of owner-scope-fixture.sql.
--
-- A work order can only be issued to a contractor whose documents have been
-- reviewed, and only a contractor with a login can accept one. The shared
-- fixture has neither, because nothing in it needs an assignment to go
-- through; this one does, because "a contractor has it" and "booked" are
-- two of the four things a tenant is told.
--
--   npx wrangler d1 execute subsub-db --config=./wrangler.toml --local \
--     --file=./scripts/tenant-notify-fixture.sql
UPDATE engagements
   SET doc_review = '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}'
 WHERE id = 'en_r';
-- The auth id is what the local Supabase stand-in mints for this address.
INSERT OR REPLACE INTO users (id, auth_id, name, email) VALUES
  ('usr_ana', 'auth_ana_rainier_test', 'Ana Ruiz', 'ana@rainier.test');
INSERT OR REPLACE INTO memberships (id, user_id, account_id, role, company_id) VALUES
  ('mem_ana', 'usr_ana', 'acc_pm', 'contractor', 'cmp_r');
