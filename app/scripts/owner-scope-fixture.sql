-- Fixture for scripts/owner-scope-test.mjs.
--
-- Two owners with different buildings, so the test can ask the interesting
-- question: does one of them get the other's? Plus a job at a building nobody
-- owns, and a contractor engaged by the account with no work at either
-- owner's building -- the two cases where a filter written the obvious way
-- leaks.
--
--   npx wrangler d1 execute subsub-db --config=./wrangler.toml --local \
--     --file=./scripts/owner-scope-fixture.sql
DELETE FROM jobs WHERE account_id = 'acc_pm';

INSERT OR REPLACE INTO accounts (id,name,subdomain,kind,plan,billing,use_default_mark,trades)
VALUES ('acc_pm','Cascade Management','cascademanagement','property_manager','scale','monthly',1,'["roofing","siding"]');

INSERT OR REPLACE INTO users (id,auth_id,name,email) VALUES
  ('usr_pm','auth_pm','Richard Braun','pm@example.test'),
  ('usr_own1','auth_own1','Dana Whitfield','owner1@example.test'),
  ('usr_own2','auth_own2','Theo Marsh','owner2@example.test');

INSERT OR REPLACE INTO memberships (id,user_id,account_id,role,company_id) VALUES
  ('mem_pm','usr_pm','acc_pm','admin',NULL),
  ('mem_own1','usr_own1','acc_pm','owner',NULL),
  ('mem_own2','usr_own2','acc_pm','owner',NULL);

-- Sixteen buildings, so "the manager still sees the whole portfolio" is a
-- number that could not appear by accident.
INSERT OR REPLACE INTO properties (id,account_id,name,address,city,state,zip,units)
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 16)
  SELECT 'p' || i, 'acc_pm', 'Building ' || i, (100 + i) || ' Main St', 'Seattle', 'WA', '98101', 10 + i FROM n;

DELETE FROM membership_properties WHERE membership_id IN ('mem_own1','mem_own2');
INSERT INTO membership_properties (membership_id,property_id) VALUES
  ('mem_own1','p1'), ('mem_own1','p2'),
  ('mem_own2','p9');

INSERT OR REPLACE INTO jobs (id,account_id,title,address,date,trades,property_id,status) VALUES
  ('job_p1','acc_pm','Building 1 — roof repair','101 Main St','2026-10-02','["roofing"]','p1','active'),
  ('job_p2','acc_pm','Building 2 — gutters','102 Main St','2026-10-09','["roofing"]','p2','active'),
  ('job_p9','acc_pm','Building 9 — siding','109 Main St','2026-10-11','["siding"]','p9','active'),
  -- No building: the account's own work, which is nobody's to see.
  ('job_none','acc_pm','Office refit','1 HQ Way','2026-10-15','["roofing"]',NULL,'active');

INSERT OR REPLACE INTO companies (id,company,contact,email,insurance,bond,contract,w9) VALUES
  ('cmp_r','Rainier Roofing','Ana Ruiz','ana@rainier.test',1,1,1,1),
  ('cmp_s','Sound Siding','Ken Ito','ken@sound.test',1,1,1,1);
INSERT OR REPLACE INTO engagements (id,account_id,company_id,status,categories) VALUES
  ('en_r','acc_pm','cmp_r','active','["roofing"]'),
  -- Engaged by the account but working none of the owners' buildings.
  ('en_s','acc_pm','cmp_s','active','["siding"]');

-- A priced work order, so the money check has something to strip.
INSERT OR REPLACE INTO work_orders (id,wo_number,job_id,trade,company_id,engagement_id,crew_name,value_cents,status)
VALUES ('wo_1','WO-1001','job_p1','roofing','cmp_r','en_r','Crew A',480000,'accepted');
