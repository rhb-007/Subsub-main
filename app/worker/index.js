// SubSub API — Cloudflare Worker (Hono) over D1 + R2.
//
// Auth note: `authMiddleware` below is a DEV STUB. It trusts an
// `X-User-Id`/`X-Account-Id` header pair with no verification at all. This
// is fine for local development and for wiring up the frontend, but it is
// not real authentication — swap it for Clerk/Supabase session verification
// before this API is reachable from the public internet. See DEPLOYMENT.pdf.

import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
app.use("/api/*", cors());

// ---------------------------------------------------------------------------
// Field ownership — mirrors COMPANY_FIELDS / ENGAGEMENT_FIELDS in the UI.
// splitPatch() routes a flat "sub" patch to the right table; composeSub()
// flattens a company+engagement row back into that same flat shape.
// ---------------------------------------------------------------------------
const ENGAGEMENT_FIELDS = new Set([
  "docReview", "categories", "caps",
  "rating", "ratedJobs", "accepted", "declined", "autoSchedule", "notes", "status",
]);

const companyRowToJs = (r) => ({
  id: r.id, company: r.company, contact: r.contact, phone: r.phone, email: r.email,
  license: r.license, ubi: r.ubi,
  licenseCheck: parseJson(r.license_check),
  city: r.city, state: r.state, zip: r.zip,
  mailStreet: r.mail_street, mailCity: r.mail_city, mailState: r.mail_state, mailZip: r.mail_zip,
  crews: parseJson(r.crews, []),
  coverage: parseJson(r.coverage, {}),
  available: !!r.available,
  unavailableDays: parseJson(r.unavailable_days, []),
  warranty: parseJson(r.warranty),
  insurance: !!r.insurance, bond: !!r.bond, contract: !!r.contract,
  docFiles: parseJson(r.doc_files, {}),
  notify: parseJson(r.notify, { email: true, sms: false }),
});

const engagementRowToJs = (r) => ({
  engagementId: r.id, accountId: r.account_id, companyId: r.company_id,
  status: r.status,
  docReview: parseJson(r.doc_review, {}),
  categories: parseJson(r.categories, []),
  caps: parseJson(r.caps, []),
  rating: r.rating, ratedJobs: r.rated_jobs, accepted: r.accepted, declined: r.declined,
  autoSchedule: !!r.auto_schedule, notes: r.notes,
});

function composeSub(companyRow, engagementRow) {
  return { ...companyRowToJs(companyRow), ...engagementRowToJs(engagementRow), id: companyRow.id };
}

function parseJson(v, fallback = null) {
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

const uid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Auth (dev stub — see file header)
// ---------------------------------------------------------------------------
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/auth/dev-login") return next();
  const userId = c.req.header("X-User-Id");
  const accountId = c.req.header("X-Account-Id");
  if (!userId || !accountId) return c.json({ error: "unauthenticated" }, 401);

  const membership = await c.env.DB.prepare(
    `SELECT * FROM memberships WHERE user_id = ? AND account_id = ?`
  ).bind(userId, accountId).first();
  if (!membership) return c.json({ error: "forbidden" }, 403);

  c.set("auth", { userId, accountId, role: membership.role, companyId: membership.company_id });
  await next();
});

function requireRole(...roles) {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!roles.includes(auth.role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

async function logEvent(env, accountId, actorId, kind, subjectId, payload) {
  await env.DB.prepare(
    `INSERT INTO events (account_id, actor_id, kind, subject_id, payload) VALUES (?, ?, ?, ?, ?)`
  ).bind(accountId, actorId ?? null, kind, subjectId ?? null, payload ? JSON.stringify(payload) : null).run();
}

// ---------------------------------------------------------------------------
// Dev login — looks up a user by email, returns their id + memberships.
// The frontend stores userId + a chosen accountId and sends them as headers.
// Replace with real session auth (Clerk/Supabase) before shipping.
// ---------------------------------------------------------------------------
app.post("/api/auth/dev-login", async (c) => {
  const { email } = await c.req.json();
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  if (!user) return c.json({ error: "not_found" }, 404);
  const { results: memberships } = await c.env.DB.prepare(
    `SELECT m.*, a.name as account_name, a.subdomain, a.plan, a.billing, a.logo_key, a.use_default_mark
     FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.user_id = ?`
  ).bind(user.id).all();
  return c.json({
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    memberships: memberships.map((m) => ({
      accountId: m.account_id, accountName: m.account_name, subdomain: m.subdomain,
      role: m.role, companyId: m.company_id,
      plan: m.plan, billing: m.billing, logoKey: m.logo_key, useDefaultMark: !!m.use_default_mark,
    })),
  });
});

// This account's members (admin/pm/contractor), composed with the person's
// name/email/phone — what the UI calls `accountUsers`.
app.get("/api/account-users", async (c) => {
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT u.*, m.role, m.company_id FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.account_id = ?`
  ).bind(accountId).all();
  return c.json(results.map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, role: r.role, subId: r.company_id,
  })));
});

// Add (or re-invite) a person to this account. Dedupes the person on email —
// same person can already exist as a user from another account.
app.post("/api/account-users", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json(); // { name, email, phone, role, subId }
  let user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(b.email).first();
  const userId = user?.id ?? uid();
  if (!user) {
    await c.env.DB.prepare(`INSERT INTO users (id, name, email, phone) VALUES (?, ?, ?, ?)`)
      .bind(userId, b.name, b.email, b.phone || null).run();
  }
  const existingMembership = await c.env.DB.prepare(
    `SELECT id FROM memberships WHERE user_id = ? AND account_id = ?`
  ).bind(userId, accountId).first();
  if (existingMembership) {
    await c.env.DB.prepare(`UPDATE memberships SET role = ?, company_id = ? WHERE id = ?`)
      .bind(b.role, b.subId ?? null, existingMembership.id).run();
  } else {
    await c.env.DB.prepare(`INSERT INTO memberships (id, user_id, account_id, role, company_id) VALUES (?, ?, ?, ?, ?)`)
      .bind(uid(), userId, accountId, b.role, b.subId ?? null).run();
  }
  return c.json({ id: userId }, 201);
});

app.patch("/api/account-users/:userId", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  const userId = c.req.param("userId");
  const b = await c.req.json(); // { name, email, phone, role, subId }
  if (b.name != null || b.email != null || b.phone != null) {
    await c.env.DB.prepare(`UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?`)
      .bind(b.name ?? null, b.email ?? null, b.phone ?? null, userId).run();
  }
  if (b.role != null) {
    await c.env.DB.prepare(`UPDATE memberships SET role = ?, company_id = ? WHERE user_id = ? AND account_id = ?`)
      .bind(b.role, b.subId ?? null, userId, accountId).run();
  }
  return c.json({ ok: true });
});

// Drops the membership, not the person — they may still belong elsewhere.
app.delete("/api/account-users/:userId", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  await c.env.DB.prepare(`DELETE FROM memberships WHERE user_id = ? AND account_id = ?`)
    .bind(c.req.param("userId"), accountId).run();
  return c.json({ ok: true });
});

// Current account's own info — lets a resumed session (page reload) rebuild
// its `accounts` state without needing to re-run dev-login.
app.get("/api/account", async (c) => {
  const { accountId, userId } = c.get("auth");
  const a = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!a) return c.json({ error: "not_found" }, 404);
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
  return c.json({
    id: a.id, name: a.name, subdomain: a.subdomain, plan: a.plan, billing: a.billing,
    logoKey: a.logo_key, useDefaultMark: !!a.use_default_mark,
    user: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone } : null,
  });
});

// Branding/plan/billing for the current account.
app.patch("/api/account", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json(); // { name, plan, billing, logoKey, useDefaultMark }
  const sets = [], vals = [];
  if (b.name != null) { sets.push("name = ?"); vals.push(b.name); }
  if (b.plan != null) { sets.push("plan = ?"); vals.push(b.plan); }
  if (b.billing != null) { sets.push("billing = ?"); vals.push(b.billing); }
  if (b.logoKey !== undefined) { sets.push("logo_key = ?"); vals.push(b.logoKey); }
  if (b.useDefaultMark != null) { sets.push("use_default_mark = ?"); vals.push(b.useDefaultMark ? 1 : 0); }
  if (sets.length) {
    vals.push(accountId);
    await c.env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Companies + engagements (the "subs" the UI works with)
// ---------------------------------------------------------------------------

// List every company engaged with the current account, composed flat.
app.get("/api/subs", async (c) => {
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, en.id as en_id, en.account_id as en_account_id, en.company_id as en_company_id,
            en.status as en_status, en.doc_review as en_doc_review, en.categories as en_categories,
            en.caps as en_caps, en.rating as en_rating, en.rated_jobs as en_rated_jobs,
            en.accepted as en_accepted, en.declined as en_declined,
            en.auto_schedule as en_auto_schedule, en.notes as en_notes
     FROM engagements en JOIN companies co ON co.id = en.company_id
     WHERE en.account_id = ?`
  ).bind(accountId).all();

  const subs = results.map((r) => composeSub(r, {
    id: r.en_id, account_id: r.en_account_id, company_id: r.en_company_id, status: r.en_status,
    doc_review: r.en_doc_review, categories: r.en_categories, caps: r.en_caps,
    rating: r.en_rating, rated_jobs: r.en_rated_jobs, accepted: r.en_accepted, declined: r.en_declined,
    auto_schedule: r.en_auto_schedule, notes: r.en_notes,
  }));
  return c.json(subs);
});

// Invite/add a company. Dedupes on license number first, then email —
// an existing company only gets a new engagement, never a duplicate row.
app.post("/api/subs", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const body = await c.req.json();
  const licenseKey = (body.license || "").trim().toUpperCase();

  let company = null;
  if (licenseKey) {
    company = await c.env.DB.prepare(`SELECT * FROM companies WHERE UPPER(TRIM(license)) = ?`).bind(licenseKey).first();
  }
  if (!company && body.email) {
    company = await c.env.DB.prepare(`SELECT * FROM companies WHERE email = ?`).bind(body.email).first();
  }

  let companyId;
  if (company) {
    companyId = company.id;
  } else {
    companyId = uid();
    await c.env.DB.prepare(
      `INSERT INTO companies (id, company, contact, phone, email, license, ubi, city, state, zip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(companyId, body.company || "", body.contact || null, body.phone || null, body.email || null,
      body.license || null, body.ubi || null, body.city || null, body.state || null, body.zip || null).run();
  }

  const existingEngagement = await c.env.DB.prepare(
    `SELECT id FROM engagements WHERE account_id = ? AND company_id = ?`
  ).bind(accountId, companyId).first();
  if (existingEngagement) return c.json({ error: "already_engaged", companyId }, 409);

  const engagementId = uid();
  await c.env.DB.prepare(
    `INSERT INTO engagements (id, account_id, company_id, status, categories, caps)
     VALUES (?, ?, ?, 'invited', ?, ?)`
  ).bind(engagementId, accountId, companyId, JSON.stringify(body.categories || []), JSON.stringify(body.caps || [])).run();

  await logEvent(c.env, accountId, userId, "engagement.invited", engagementId, { companyId });
  return c.json({ companyId, engagementId, reused: !!company }, 201);
});

// Patch a sub — routes fields to companies vs engagements exactly like the
// prototype's splitPatch(), so callers can keep sending the same flat object.
app.patch("/api/subs/:companyId", async (c) => {
  const auth = c.get("auth");
  const { accountId, userId } = auth;
  const companyId = c.req.param("companyId");
  if (auth.role === "contractor" && auth.companyId !== companyId) return c.json({ error: "forbidden" }, 403);
  const patch = await c.req.json();

  const engagement = await c.env.DB.prepare(
    `SELECT id FROM engagements WHERE account_id = ? AND company_id = ?`
  ).bind(accountId, companyId).first();
  if (!engagement) return c.json({ error: "not_found" }, 404);

  const coPatch = {}, enPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    (ENGAGEMENT_FIELDS.has(k) ? enPatch : coPatch)[k] = v;
  }

  const COL = {
    company: "company", contact: "contact", phone: "phone", email: "email",
    license: "license", ubi: "ubi", city: "city", state: "state", zip: "zip",
    mailStreet: "mail_street", mailCity: "mail_city", mailState: "mail_state", mailZip: "mail_zip",
    crews: "crews", coverage: "coverage", available: "available",
    unavailableDays: "unavailable_days", warranty: "warranty",
    insurance: "insurance", bond: "bond", contract: "contract",
    docFiles: "doc_files", notify: "notify",
  };
  const JSON_FIELDS = new Set(["crews", "coverage", "unavailableDays", "warranty", "docFiles", "notify"]);
  const coSets = [], coVals = [];
  for (const [k, v] of Object.entries(coPatch)) {
    if (!COL[k]) continue;
    coSets.push(`${COL[k]} = ?`);
    coVals.push(JSON_FIELDS.has(k) ? JSON.stringify(v) : (typeof v === "boolean" ? (v ? 1 : 0) : v));
  }
  if (coSets.length) {
    coVals.push(companyId);
    await c.env.DB.prepare(`UPDATE companies SET ${coSets.join(", ")} WHERE id = ?`).bind(...coVals).run();
  }

  const ECOL = {
    docReview: "doc_review", categories: "categories", caps: "caps",
    rating: "rating", ratedJobs: "rated_jobs", accepted: "accepted", declined: "declined",
    autoSchedule: "auto_schedule", notes: "notes", status: "status",
  };
  const EJSON_FIELDS = new Set(["docReview", "categories", "caps"]);
  const enSets = [], enVals = [];
  for (const [k, v] of Object.entries(enPatch)) {
    if (!ECOL[k]) continue;
    enSets.push(`${ECOL[k]} = ?`);
    enVals.push(EJSON_FIELDS.has(k) ? JSON.stringify(v) : (typeof v === "boolean" ? (v ? 1 : 0) : v));
  }
  if (enSets.length) {
    enVals.push(engagement.id);
    await c.env.DB.prepare(`UPDATE engagements SET ${enSets.join(", ")} WHERE id = ?`).bind(...enVals).run();
  }

  await logEvent(c.env, accountId, userId, "sub.updated", companyId, { fields: Object.keys(patch) });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// License verification — WA L&I open data (data.wa.gov), no key required.
// ---------------------------------------------------------------------------
const LNI = "https://data.wa.gov/resource";
const LNI_DATASETS = { general: "m8qx-ubtq", insurance: "ciwg-agsx", bond: "bzff-4fmt" };

async function verifyLicenseWithLNI(licenseNumber) {
  const q = `?contractorlicensenumber=${encodeURIComponent(licenseNumber)}`;
  const [general, insurance, bond] = await Promise.all([
    fetch(`${LNI}/${LNI_DATASETS.general}.json${q}`).then((r) => r.json()),
    fetch(`${LNI}/${LNI_DATASETS.insurance}.json${q}`).then((r) => r.json()),
    fetch(`${LNI}/${LNI_DATASETS.bond}.json${q}`).then((r) => r.json()),
  ]);
  const lic = general[0];
  if (!lic) return { found: false };

  const today = new Date().toISOString().slice(0, 10);
  const current = (rows, endField) =>
    rows.filter((r) => !r.cancel_date && (!r[endField] || r[endField].slice(0, 10) >= today))
      .sort((a, b) => (b.effective_date || "").localeCompare(a.effective_date || ""))[0] || null;

  return {
    found: true,
    businessName: lic.businessname,
    status: lic.contractorlicensestatus,
    licenseType: lic.contractorlicensetypecodedesc,
    ubi: lic.ubi,
    effectiveDate: lic.licenseeffectivedate?.slice(0, 10),
    expirationDate: lic.licenseexpirationdate?.slice(0, 10),
    suspendDate: lic.contractorlicensesuspenddate?.slice(0, 10) || null,
    principal: lic.primaryprincipalname,
    insurance: current(insurance, "insurance_expiration_date"),
    bond: current(bond, "bond_expiration_date"),
  };
}

app.post("/api/subs/:companyId/verify-license", requireRole("admin", "pm"), async (c) => {
  const companyId = c.req.param("companyId");
  const company = await c.env.DB.prepare(`SELECT license FROM companies WHERE id = ?`).bind(companyId).first();
  if (!company?.license) return c.json({ error: "no_license_on_file" }, 400);

  const result = await verifyLicenseWithLNI(company.license);

  await c.env.DB.prepare(
    `INSERT INTO license_checks
      (company_id, status, license_type, effective_date, expiration_date, suspend_date,
       bond_amount_cents, bond_surety, insurance_coverage_cents, insurance_carrier, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    companyId, result.status ?? "NOT_FOUND", result.licenseType ?? null,
    result.effectiveDate ?? null, result.expirationDate ?? null, result.suspendDate ?? null,
    result.bond ? Math.round(Number(result.bond.bond_amount || 0) * 100) : null,
    result.bond?.surety_company ?? null,
    result.insurance ? Math.round(Number(result.insurance.coverage_amount || 0) * 100) : null,
    result.insurance?.insurance_company ?? null,
    JSON.stringify(result)
  ).run();

  await c.env.DB.prepare(`UPDATE companies SET license_check = ? WHERE id = ?`)
    .bind(JSON.stringify(result), companyId).run();

  return c.json(result);
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
app.get("/api/jobs", async (c) => {
  const { accountId } = c.get("auth");
  const { results: jobs } = await c.env.DB.prepare(
    `SELECT * FROM jobs WHERE account_id = ? ORDER BY created_at DESC`
  ).bind(accountId).all();

  const { results: wos } = await c.env.DB.prepare(
    `SELECT wo.* FROM work_orders wo JOIN jobs j ON j.id = wo.job_id
     WHERE j.account_id = ? AND wo.voided_at IS NULL`
  ).bind(accountId).all();
  const woByJob = {};
  for (const w of wos) (woByJob[w.job_id] ||= []).push(w);

  return c.json(jobs.map((j) => jobRowToJs(j, woByJob[j.id] || [])));
});

// Every job the API has ever seen, across ALL accounts, but only the fact of
// a booking (no client/address/value) — this is what makes crew availability
// correct across GCs without leaking one account's job details to another.
app.get("/api/jobs/all-bookings", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT wo.company_id, wo.trade, wo.crew_name, j.id as job_id, j.date, j.account_id
     FROM work_orders wo JOIN jobs j ON j.id = wo.job_id
     WHERE wo.voided_at IS NULL AND wo.status != 'declined' AND j.status = 'active'`
  ).all();
  return c.json(results);
});

function jobRowToJs(j, workOrders) {
  const assignments = {};
  for (const w of workOrders) {
    assignments[w.trade] = {
      id: w.id, subId: w.company_id, wo: w.wo_number, woIssued: w.issued_at?.slice(0, 10),
      crewName: w.crew_name, tradeScope: w.trade_scope, value: w.value_cents != null ? String(w.value_cents / 100) : "",
      status: w.status, auto: !!w.auto_scheduled, responseWindow: w.response_window, respondBy: w.respond_by,
      respondedAt: w.responded_at, rating: w.rating, distance: w.distance, inRange: !!w.in_range,
      signedWO: w.signed_file_key,
    };
  }
  return {
    id: j.id, accountId: j.account_id, title: j.title, client: j.client, address: j.address, area: j.area, zip: j.zip,
    sqft: j.sqft, stories: j.stories, date: j.date, time: j.time,
    trades: parseJson(j.trades, []), scope: j.scope, materialSource: j.material_source,
    materialsPaidBy: j.materials_paid_by, measurementDocs: parseJson(j.measurement_docs, []),
    status: j.status, completedAt: j.completed_at, notes: j.notes, createdAt: j.created_at?.slice(0, 10), assignments,
  };
}

app.post("/api/jobs", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const b = await c.req.json();
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO jobs (id, account_id, title, client, address, area, zip, sqft, stories, date, time,
       trades, scope, material_source, materials_paid_by, measurement_docs, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, accountId, b.title, b.client || null, b.address || null, b.area || null, b.zip || null,
    b.sqft || null, b.stories || null, b.date || null, b.time || "07:00",
    JSON.stringify(b.trades || []), b.scope || null, b.materialSource || null, b.materialsPaidBy || null,
    JSON.stringify(b.measurementDocs || []), userId).run();

  await logEvent(c.env, accountId, userId, "job.created", id, { title: b.title });
  return c.json({ id }, 201);
});

app.post("/api/jobs/:id/complete", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ? AND account_id = ?`
  ).bind(new Date().toISOString().slice(0, 10), id, accountId).run();
  await logEvent(c.env, accountId, userId, "job.completed", id, {});
  return c.json({ ok: true });
});

app.post("/api/jobs/:id/reopen", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'active', completed_at = NULL WHERE id = ? AND account_id = ?`
  ).bind(c.req.param("id"), accountId).run();
  return c.json({ ok: true });
});

// Everything about a job that ISN'T a work order — notes, measurement docs.
app.patch("/api/jobs/:id", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const id = c.req.param("id");
  const b = await c.req.json(); // { notes?, measurementDocs? }
  const sets = [], vals = [];
  if (b.notes !== undefined) { sets.push("notes = ?"); vals.push(b.notes); }
  if (b.measurementDocs !== undefined) { sets.push("measurement_docs = ?"); vals.push(JSON.stringify(b.measurementDocs)); }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id, accountId);
  await c.env.DB.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ? AND account_id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Work orders — issuing one is atomic and server-side authoritative.
// ---------------------------------------------------------------------------
app.post("/api/jobs/:jobId/assign", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const jobId = c.req.param("jobId");
  const { trade, companyId, crewName, tradeScope, value, responseWindow } = await c.req.json();

  const job = await c.env.DB.prepare(`SELECT id FROM jobs WHERE id = ? AND account_id = ?`).bind(jobId, accountId).first();
  if (!job) return c.json({ error: "job_not_found" }, 404);

  const engagement = await c.env.DB.prepare(
    `SELECT * FROM engagements WHERE account_id = ? AND company_id = ?`
  ).bind(accountId, companyId).first();
  if (!engagement) return c.json({ error: "not_engaged" }, 404);

  // Documents must be complete before a work order can be issued.
  const company = await c.env.DB.prepare(`SELECT insurance, bond, contract, license FROM companies WHERE id = ?`).bind(companyId).first();
  const docReview = parseJson(engagement.doc_review, {});
  const verified = (k) => docReview[k]?.status === "verified";
  if (!verified("insurance") || !verified("bond") || !verified("contract")) {
    return c.json({ error: "documents_incomplete" }, 409);
  }

  const autoScheduled = !!engagement.auto_schedule;
  const woNumber = "WO-" + Math.floor(1000 + Math.random() * 9000);
  const id = uid();
  const valueCents = value ? Math.round(Number(String(value).replace(/[^0-9.]/g, "")) * 100) : null;
  const respondBy = autoScheduled ? null
    : new Date(Date.now() + windowMins(responseWindow) * 60000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO work_orders
      (id, wo_number, job_id, trade, company_id, engagement_id, crew_name, trade_scope, value_cents,
       status, auto_scheduled, response_window, respond_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, woNumber, jobId, trade, companyId, engagement.id, crewName || null, tradeScope || "",
    valueCents, autoScheduled ? "accepted" : "pending", autoScheduled ? 1 : 0,
    autoScheduled ? null : (responseWindow || "24h"), respondBy).run();

  await logEvent(c.env, accountId, userId, "wo.issued", id, { jobId, trade, companyId, woNumber });
  return c.json({ id, woNumber, status: autoScheduled ? "accepted" : "pending" }, 201);
});

const RESPONSE_WINDOW_MINS = { "2h": 120, "8h": 480, "24h": 1440, "48h": 2880 };
const windowMins = (id) => RESPONSE_WINDOW_MINS[id] ?? 1440;

// Void the live WO for a job+trade and issue a fresh one — this is how
// "editing" a work order actually works; nothing is ever UPDATEd in place.
app.post("/api/work-orders/:id/reissue", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const id = c.req.param("id");
  const wo = await c.env.DB.prepare(
    `SELECT wo.*, j.account_id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id WHERE wo.id = ?`
  ).bind(id).first();
  if (!wo || wo.account_id !== accountId) return c.json({ error: "not_found" }, 404);

  const b = await c.req.json();
  await c.env.DB.prepare(`UPDATE work_orders SET voided_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();

  const newId = uid();
  const woNumber = "WO-" + Math.floor(1000 + Math.random() * 9000);
  const valueCents = b.value ? Math.round(Number(String(b.value).replace(/[^0-9.]/g, "")) * 100) : wo.value_cents;
  await c.env.DB.prepare(
    `INSERT INTO work_orders
      (id, wo_number, job_id, trade, company_id, engagement_id, crew_name, trade_scope, value_cents, status, auto_scheduled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`
  ).bind(newId, woNumber, wo.job_id, wo.trade, wo.company_id, wo.engagement_id,
    b.crewName ?? wo.crew_name, b.tradeScope ?? wo.trade_scope, valueCents).run();

  await logEvent(c.env, accountId, userId, "wo.reissued", newId, { voided: id });
  return c.json({ id: newId, woNumber }, 201);
});

app.post("/api/work-orders/:id/respond", async (c) => {
  const { accountId, userId, role, companyId } = c.get("auth");
  const id = c.req.param("id");
  const { status } = await c.req.json(); // 'accepted' | 'declined'
  if (!["accepted", "declined"].includes(status)) return c.json({ error: "bad_status" }, 400);

  const wo = await c.env.DB.prepare(
    `SELECT wo.*, j.account_id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id WHERE wo.id = ?`
  ).bind(id).first();
  if (!wo || wo.account_id !== accountId) return c.json({ error: "not_found" }, 404);
  if (role === "contractor" && wo.company_id !== companyId) return c.json({ error: "forbidden" }, 403);

  await c.env.DB.prepare(
    `UPDATE work_orders SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, id).run();
  const counterCol = status === "accepted" ? "accepted" : "declined";
  await c.env.DB.prepare(
    `UPDATE engagements SET ${counterCol} = ${counterCol} + 1 WHERE id = ?`
  ).bind(wo.engagement_id).run();

  await logEvent(c.env, accountId, userId, `wo.${status}`, id, {});
  return c.json({ ok: true });
});

// Pull a trade off a job entirely — voids the live WO, issues nothing new.
app.post("/api/jobs/:jobId/unassign/:trade", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const { jobId, trade } = c.req.param();
  const wo = await c.env.DB.prepare(
    `SELECT wo.id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id
     WHERE wo.job_id = ? AND wo.trade = ? AND wo.voided_at IS NULL AND j.account_id = ?`
  ).bind(jobId, trade, accountId).first();
  if (!wo) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`UPDATE work_orders SET voided_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(wo.id).run();
  await logEvent(c.env, accountId, userId, "wo.voided", wo.id, { jobId, trade });
  return c.json({ ok: true });
});

// Reassigning which crew covers a WO is operational, not a contract term —
// unlike reissue(), this updates the live row in place.
app.post("/api/work-orders/:id/crew", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const id = c.req.param("id");
  const { crewName } = await c.req.json();
  const wo = await c.env.DB.prepare(
    `SELECT wo.id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id WHERE wo.id = ? AND j.account_id = ?`
  ).bind(id, accountId).first();
  if (!wo) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`UPDATE work_orders SET crew_name = ? WHERE id = ?`).bind(crewName, id).run();
  return c.json({ ok: true });
});

app.post("/api/work-orders/:id/signed", async (c) => {
  const { accountId } = c.get("auth");
  const id = c.req.param("id");
  const { fileKey } = await c.req.json();
  const wo = await c.env.DB.prepare(
    `SELECT wo.id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id WHERE wo.id = ? AND j.account_id = ?`
  ).bind(id, accountId).first();
  if (!wo) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`UPDATE work_orders SET signed_file_key = ? WHERE id = ?`).bind(fileKey, id).run();
  return c.json({ ok: true });
});

// Rating a job's work belongs to the RELATIONSHIP, not the company — the
// engagement's rating is the average across every rated WO under it.
app.post("/api/work-orders/:id/rate", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const id = c.req.param("id");
  const { rating } = await c.req.json(); // 1-5
  const wo = await c.env.DB.prepare(
    `SELECT wo.*, j.account_id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id WHERE wo.id = ?`
  ).bind(id).first();
  if (!wo || wo.account_id !== accountId) return c.json({ error: "not_found" }, 404);

  await c.env.DB.prepare(`UPDATE work_orders SET rating = ? WHERE id = ?`).bind(rating, id).run();

  const { results: rated } = await c.env.DB.prepare(
    `SELECT rating FROM work_orders WHERE engagement_id = ? AND rating IS NOT NULL`
  ).bind(wo.engagement_id).all();
  const avg = rated.reduce((n, r) => n + r.rating, 0) / rated.length;
  await c.env.DB.prepare(`UPDATE engagements SET rating = ?, rated_jobs = ? WHERE id = ?`)
    .bind(Math.round(avg * 10) / 10, rated.length, wo.engagement_id).run();

  await logEvent(c.env, accountId, userId, "wo.rated", id, { rating });
  return c.json({ ok: true, rating: Math.round(avg * 10) / 10 });
});

// ---------------------------------------------------------------------------
// Document review (per-engagement verdict on a company's uploaded file)
// ---------------------------------------------------------------------------
app.post("/api/subs/:companyId/documents/:kind/review", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const companyId = c.req.param("companyId");
  const kind = c.req.param("kind"); // insurance | bond | contract
  const body = await c.req.json(); // { status, limits, checks, overrides, note }

  const engagement = await c.env.DB.prepare(
    `SELECT * FROM engagements WHERE account_id = ? AND company_id = ?`
  ).bind(accountId, companyId).first();
  if (!engagement) return c.json({ error: "not_found" }, 404);

  const docReview = parseJson(engagement.doc_review, {});
  docReview[kind] = { ...body, verifiedBy: userId, verifiedAt: new Date().toISOString().slice(0, 10) };
  await c.env.DB.prepare(`UPDATE engagements SET doc_review = ? WHERE id = ?`)
    .bind(JSON.stringify(docReview), engagement.id).run();

  await logEvent(c.env, accountId, userId, "doc.reviewed", companyId, { kind, status: body.status });
  return c.json({ ok: true });
});

// The FILE belongs to the company (uploaded once, shared by every GC that
// engages them). Re-uploading reopens the review queue for EVERY account
// that engages this company, not just the one who uploaded it — same
// design as the prototype's uploadSubDoc().
app.post("/api/subs/:companyId/documents/:kind", requireRole("admin", "pm", "contractor"), async (c) => {
  const auth = c.get("auth");
  const { companyId } = c.req.param();
  const kind = c.req.param("kind"); // insurance | bond | contract | w9
  if (auth.role === "contractor" && auth.companyId !== companyId) return c.json({ error: "forbidden" }, 403);
  const { fileKey, fileName } = await c.req.json();

  const company = await c.env.DB.prepare(`SELECT doc_files FROM companies WHERE id = ?`).bind(companyId).first();
  if (!company) return c.json({ error: "not_found" }, 404);
  const docFiles = { ...parseJson(company.doc_files, {}), [kind]: fileName };

  const col = { insurance: "insurance", bond: "bond", contract: "contract" }[kind];
  await c.env.DB.prepare(
    `UPDATE companies SET doc_files = ?${col ? `, ${col} = 1` : ""} WHERE id = ?`
  ).bind(JSON.stringify(docFiles), companyId).run();

  const { results: engagements } = await c.env.DB.prepare(
    `SELECT id, doc_review FROM engagements WHERE company_id = ?`
  ).bind(companyId).all();
  for (const e of engagements) {
    const docReview = { ...parseJson(e.doc_review, {}), [kind]: { status: "pending" } };
    await c.env.DB.prepare(`UPDATE engagements SET doc_review = ? WHERE id = ?`).bind(JSON.stringify(docReview), e.id).run();
  }
  return c.json({ ok: true });
});

app.delete("/api/subs/:companyId/documents/:kind", requireRole("admin", "pm", "contractor"), async (c) => {
  const auth = c.get("auth");
  const { companyId } = c.req.param();
  const kind = c.req.param("kind");
  if (auth.role === "contractor" && auth.companyId !== companyId) return c.json({ error: "forbidden" }, 403);

  const company = await c.env.DB.prepare(`SELECT doc_files FROM companies WHERE id = ?`).bind(companyId).first();
  if (!company) return c.json({ error: "not_found" }, 404);
  const docFiles = { ...parseJson(company.doc_files, {}), [kind]: null };

  const col = { insurance: "insurance", bond: "bond", contract: "contract" }[kind];
  await c.env.DB.prepare(
    `UPDATE companies SET doc_files = ?${col ? `, ${col} = 0` : ""} WHERE id = ?`
  ).bind(JSON.stringify(docFiles), companyId).run();

  const { results: engagements } = await c.env.DB.prepare(
    `SELECT id, doc_review FROM engagements WHERE company_id = ?`
  ).bind(companyId).all();
  for (const e of engagements) {
    const docReview = { ...parseJson(e.doc_review, {}) };
    delete docReview[kind];
    await c.env.DB.prepare(`UPDATE engagements SET doc_review = ? WHERE id = ?`).bind(JSON.stringify(docReview), e.id).run();
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// File uploads. R2Bucket has no createPresignedUrl() — that's an S3-style
// presigned URL, which on R2 needs the S3-compatible API signed with an R2
// API token (Account ID + Access Key + Secret), not the Workers binding.
// Simpler and sufficient for compliance-doc-sized files: stream the upload
// straight through the Worker into R2 with the binding's own put(). If
// upload volume ever justifies it, swap this for real presigned URLs via
// aws4fetch + an R2 API token to take the Worker out of the data path.
// ---------------------------------------------------------------------------
app.put("/api/uploads/:kind/:fileName", async (c) => {
  const { accountId } = c.get("auth");
  const { kind, fileName } = c.req.param();
  const key = `${accountId}/${kind}/${uid()}-${decodeURIComponent(fileName)}`;
  await c.env.FILES.put(key, c.req.raw.body, {
    httpMetadata: { contentType: c.req.header("Content-Type") || "application/octet-stream" },
  });
  return c.json({ key });
});

// ---------------------------------------------------------------------------
// Nightly sweep target — re-checks every company with a license on file and
// flags any status change. Wire this up as a Cron Trigger (see wrangler.toml).
// ---------------------------------------------------------------------------
app.get("/api/cron/license-sweep", async (c) => {
  if (c.req.header("Authorization") !== `Bearer ${c.env.CRON_SECRET}`) return c.json({ error: "forbidden" }, 403);
  const { results: companies } = await c.env.DB.prepare(
    `SELECT id, license, license_check FROM companies WHERE license IS NOT NULL AND license != ''`
  ).all();

  const flagged = [];
  for (const co of companies) {
    const prevStatus = parseJson(co.license_check)?.status;
    const result = await verifyLicenseWithLNI(co.license);
    if (result.status && result.status !== prevStatus) flagged.push({ companyId: co.id, from: prevStatus, to: result.status });
    await c.env.DB.prepare(
      `INSERT INTO license_checks (company_id, status, license_type, effective_date, expiration_date, suspend_date, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(co.id, result.status ?? "NOT_FOUND", result.licenseType ?? null, result.effectiveDate ?? null,
      result.expirationDate ?? null, result.suspendDate ?? null, JSON.stringify(result)).run();
    await c.env.DB.prepare(`UPDATE companies SET license_check = ? WHERE id = ?`)
      .bind(JSON.stringify(result), co.id).run();
  }
  return c.json({ checked: companies.length, flagged });
});

// ---------------------------------------------------------------------------
// Uniform orders (Scale-plan feature) — a contractor orders branded gear,
// the hiring account approves or denies it.
// ---------------------------------------------------------------------------
const uniformOrderRowToJs = (o) => ({
  id: o.id, subId: o.company_id, company: o.company_name,
  lines: parseJson(o.items, []), note: o.note, ship: parseJson(o.ship, {}),
  status: o.status, createdAt: o.created_at?.slice(0, 10),
});

app.get("/api/uniform-orders", async (c) => {
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT uo.*, co.company as company_name FROM uniform_orders uo
     JOIN companies co ON co.id = uo.company_id WHERE uo.account_id = ? ORDER BY uo.created_at DESC`
  ).bind(accountId).all();
  return c.json(results.map(uniformOrderRowToJs));
});

app.post("/api/uniform-orders", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "contractor" || !auth.companyId) return c.json({ error: "forbidden" }, 403);
  const b = await c.req.json(); // { lines, note, ship }
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO uniform_orders (id, account_id, company_id, items, note, ship) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.accountId, auth.companyId, JSON.stringify(b.lines || []), b.note || null, JSON.stringify(b.ship || {})).run();
  return c.json({ id }, 201);
});

app.post("/api/uniform-orders/:id/decide", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const { status } = await c.req.json(); // 'approved' | 'denied'
  if (!["approved", "denied"].includes(status)) return c.json({ error: "bad_status" }, 400);
  await c.env.DB.prepare(`UPDATE uniform_orders SET status = ? WHERE id = ? AND account_id = ?`)
    .bind(status, c.req.param("id"), accountId).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Service calls — a warranty claim or callback raised against a completed
// job. The contractor has to confirm (or propose a different date) before
// it counts as scheduled.
// ---------------------------------------------------------------------------
const serviceCallRowToJs = (r) => ({
  id: r.id, accountId: r.account_id, jobId: r.job_id, trade: r.trade, subId: r.company_id,
  company: r.company_name, crewName: r.crew_name, kind: r.kind, issue: r.issue,
  returnDate: r.return_date, status: r.status, subNote: r.sub_note,
  raisedBy: r.raised_by, raisedAt: r.raised_at, confirmedAt: r.confirmed_at, resolvedAt: r.resolved_at,
});

app.get("/api/service-calls", async (c) => {
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT sc.*, co.company as company_name FROM service_calls sc
     JOIN companies co ON co.id = sc.company_id WHERE sc.account_id = ? ORDER BY sc.raised_at DESC`
  ).bind(accountId).all();
  return c.json(results.map(serviceCallRowToJs));
});

app.post("/api/service-calls", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const b = await c.req.json(); // { jobId, trade, subId, crewName, kind, issue, returnDate, raisedBy }
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO service_calls (id, account_id, job_id, trade, company_id, crew_name, kind, issue, return_date, raised_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, accountId, b.jobId, b.trade, b.subId, b.crewName || null, b.kind, b.issue || null,
    b.returnDate || null, b.raisedBy || userId).run();
  return c.json({ id }, 201);
});

app.post("/api/service-calls/:id/confirm", async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json(); // { returnDate?, subNote? }
  const sets = ["status = 'scheduled'", "confirmed_at = CURRENT_TIMESTAMP"];
  const vals = [];
  if (b.returnDate !== undefined) { sets.push("return_date = ?"); vals.push(b.returnDate); }
  if (b.subNote !== undefined) { sets.push("sub_note = ?"); vals.push(b.subNote); }
  vals.push(c.req.param("id"), accountId);
  await c.env.DB.prepare(`UPDATE service_calls SET ${sets.join(", ")} WHERE id = ? AND account_id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

app.post("/api/service-calls/:id/resolve", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  await c.env.DB.prepare(
    `UPDATE service_calls SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND account_id = ?`
  ).bind(c.req.param("id"), accountId).run();
  return c.json({ ok: true });
});

export default app;
