// 093. A work order can only go to a company somebody signs in as, so a suite
// whose subject is assigning (not logins) needs its contractors to be on
// SubSub. This gives each one a contractor seat on a separate account, which
// is what `companyAnswersForItself` asks (unscoped) and leaves every check
// scoped to the suite's own account exactly as it was.
export const onSubsubSql = (companyIds = []) => `
  INSERT OR IGNORE INTO accounts(id,name,kind,subdomain,plan)
    VALUES ('acc_elsewhere','Elsewhere Property Co','property_manager','elsewhere','basic');
  ${companyIds.map((id) => `
  INSERT OR IGNORE INTO users(id,name,email) VALUES ('u_on_${id}','Login ${id}','login.${id}@elsewhere.test');
  INSERT OR IGNORE INTO memberships(id,user_id,account_id,role,company_id)
    VALUES ('m_on_${id}','u_on_${id}','acc_elsewhere','contractor','${id}');`).join("")}
`;

// Every company in the database, for a suite where nothing is about logins.
export const markAllOnSubsub = (db) => {
  const ids = db.prepare(`SELECT id FROM companies`).all().map((r) => r.id);
  db.exec(onSubsubSql(ids));
};

// A work order issued before 093 could go to a company with no login, and its
// claim link is how they get one. Issuing one now needs them on SubSub, so a
// suite about claiming makes them so for the issue and takes it away after.
export const offSubsubSql = (companyIds = []) =>
  companyIds.map((id) => `DELETE FROM memberships WHERE id = 'm_on_${id}'; DELETE FROM users WHERE id = 'u_on_${id}';`).join("\n");

// The same, through a D1 binding, for a suite that holds `env` and not the db.
const runEach = async (DB, sql) => {
  for (const st of sql.split(";").map((x) => x.trim()).filter(Boolean)) await DB.prepare(st).run();
};
export const withLogin = async (DB, companyIds, fn) => {
  await runEach(DB, onSubsubSql(companyIds));
  try { return await fn(); } finally { await runEach(DB, offSubsubSql(companyIds)); }
};
