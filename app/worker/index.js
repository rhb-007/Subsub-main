// SubSub API — Cloudflare Worker (Hono) over D1 + R2.
//
// Auth note: `authMiddleware` below is a DEV STUB. It trusts an
// `X-User-Id`/`X-Account-Id` header pair with no verification at all. This
// is fine for local development and for wiring up the frontend, but it is
// not real authentication — swap it for Clerk/Supabase session verification
// before this API is reachable from the public internet. See DEPLOYMENT.pdf.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { sendEmail, docRequestEmail, workOrderIssuedEmail, applicationReceivedEmail,
  tenantInviteEmail, tenantInviteSms, customInviteEmail, withInviteLink,
  INVITE_LINK_TOKEN, tenantStatusEmail, tenantStatusSms, visitWhen } from "./mail.js";
import { sendSms, toE164 } from "./sms.js";
// The same file the browser reads, so the two cannot disagree about what an
// emergency is. Severity is decided here from the problem the tenant picked,
// never taken from what the browser claims -- otherwise a dripping tap could
// be labelled urgent and call somebody out at the account's expense.
import { severityOf } from "../shared/emergency.js";
import { stripeCall, verifyStripeWebhook, priceFor, stripeTime, ENTITLED } from "./billing.js";
import { verifyAccessJwt } from "./access.js";
import {
  hostnameConfig, brandedHost, provisionHostname, deprovisionHostname, checkHostname, diagnose,
} from "./hostnames.js";
import { setupCheck } from "./setup-check.js";

const app = new Hono();
app.use("/api/*", cors());

// An unhandled throw was reaching the browser as a bare 500 with an empty
// body, which is the least useful thing a server can say: indistinguishable,
// from the outside, from a network failure. Every one of these is a bug here,
// so name it.
//
// The message goes in the response as well as the log. These are a real
// user's own API calls, not a public surface, and what comes back is a D1 or
// runtime error string -- the difference between a diagnosable failure and a
// mystery is worth more than keeping column names to ourselves. Revisit if
// any of this becomes reachable unauthenticated.
app.onError((err, c) => {
  console.error("[unhandled]", c.req.method, c.req.path, err?.stack || err?.message || err);
  return c.json({
    error: "server_error",
    // Kept in the response as well as the log because these are a signed-in
    // person's own API calls, and it turns an afternoon of guessing into one
    // look. It is not shown on screen -- the interface says what to do; this
    // is for whoever is reading the console or the network tab.
    detail: String(err?.message || err).slice(0, 300),
  }, 500);
});

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
  insurance: !!r.insurance, bond: !!r.bond, contract: !!r.contract, w9: !!r.w9,
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
  // Which properties this vendor is scoped to. Empty = every property on the
  // account, which is how a general contractor uses it.
  propertyIds: r.property_ids ? String(r.property_ids).split(",") : [],
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
// Auth — real when SUPABASE_URL/SUPABASE_ANON_KEY are configured (see
// wrangler.toml and app/README.md), a dev stub otherwise. The dev stub
// trusts a plain X-User-Id header with zero verification — fine for local
// development, never for anything reachable from the internet. Neither
// mode has been exercised against a live network from this environment
// (see README) — the Supabase branch in particular needs a real check
// once deployed.
// ---------------------------------------------------------------------------
// Verifies a `Bearer <token>` header against Supabase itself (no
// crypto/JWKS handling needed in the Worker — costs one extra fetch per
// request; swap for local JWKS verification later if that latency ever
// matters) and resolves it to an internal users row, linking by email on
// first login if one exists but auth_id hasn't been set yet. Returns null
// on any failure — every caller turns that into its own 401/403.
async function verifySupabaseToken(env, authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supaRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!supaRes.ok) return null;
  return supaRes.json(); // { id, email, ... } — Supabase's own user object
}

async function resolveSupabaseUser(env, authHeader) {
  const supaUser = await verifySupabaseToken(env, authHeader);
  if (!supaUser) return null;

  let user = await env.DB.prepare(`SELECT * FROM users WHERE auth_id = ?`).bind(supaUser.id).first();
  if (!user && supaUser.email) {
    // First real login for someone who already has an internal users row
    // (seeded, or added via the invite flow before they'd signed up) —
    // link it by email instead of requiring a separate provisioning step.
    user = await env.DB.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).bind(supaUser.email).first();
    if (user) await env.DB.prepare(`UPDATE users SET auth_id = ? WHERE id = ?`).bind(supaUser.id, user.id).run();
  }
  return user;
}

app.use("/api/*", async (c, next) => {
  // A brand logo has to render on the login screen, before anyone is
  // authenticated — so this one route is intentionally public. Never do
  // this for compliance documents; those stay behind auth.
  // /api/account-by-subdomain/* is the same idea: the login screen for
  // e.g. outerhome.subsub.work needs to know which account that subdomain
  // belongs to (for its branding) before anyone has signed in.
  // /api/auth/me and /api/auth/dev-login are also exempted: both exist
  // specifically to discover which accounts a person can choose from
  // *before* any X-Account-Id is known, so they can't require one — they
  // do their own (lighter) verification inline instead. /api/cron/* is a
  // Cron Trigger target with no user session at all — it does its own
  // CRON_SECRET bearer check inline instead (was dead code behind this
  // middleware until this exemption: every call 401'd before reaching it).
  // /api/apply/* is the public subcontractor-application form — genuinely
  // unauthenticated, since the applicant has no session at all yet (that's
  // exactly what a successful application eventually leads to).
  if (c.req.path === "/api/auth/dev-login" || c.req.path === "/api/auth/me" || c.req.path === "/api/signup"
    || c.req.path.startsWith("/api/platform/")
    || c.req.path.startsWith("/api/apply/")
    || c.req.path.startsWith("/api/invite/")
    // The tenant equivalent, and public for the same reason: somebody
    // holding the link has no account yet -- getting one is the point. The
    // trailing slash matters: /api/tenants, the manager's roster, stays
    // behind auth, and so would any other path beginning the same way.
    || c.req.path.startsWith("/api/tenant-invite/")
    || c.req.path === "/api/stripe/webhook"
    || c.req.path === "/api/impersonation/end"
    || c.req.path.startsWith("/api/logo/") || c.req.path.startsWith("/api/cron/") || c.req.path.startsWith("/api/account-by-subdomain/")) return next();

  // Staff sitting in a customer's seat. Checked before anything else and
  // taken from the row rather than the request: the caller says which token,
  // never which account or which identity, so a stale or tampered header
  // cannot widen what it reaches. An expired or handed-back session stops
  // working the moment it is looked up, which is the reason this is a table
  // and not a signed blob nobody can take back.
  const impToken = c.req.header("X-Impersonation-Token");
  if (impToken) {
    const sess = await c.env.DB.prepare(
      `SELECT account_id, act_as_user_id, staff_user_id FROM impersonation_sessions
        WHERE token = ? AND ended_at IS NULL AND expires_at > datetime('now')`
    ).bind(impToken).first();
    if (!sess) return c.json({ error: "impersonation_expired" }, 401);

    const seat = await c.env.DB.prepare(
      `SELECT * FROM memberships WHERE user_id = ? AND account_id = ?`
    ).bind(sess.act_as_user_id, sess.account_id).first();
    // The seat can be removed while somebody is in it.
    if (!seat) return c.json({ error: "forbidden" }, 403);

    c.set("auth", {
      userId: sess.act_as_user_id, accountId: sess.account_id,
      role: seat.role, companyId: seat.company_id,
      membershipId: seat.id,
      // Staff sitting in an owner's seat see the owner's buildings and no
      // others. Support is not a reason to widen somebody's access.
      propertyIds: await propertyScope(c.env.DB, seat),
      // Who is really here. Nothing reads it yet; it is set because a
      // session whose real actor is unrecoverable is the one thing this
      // table exists to prevent.
      impersonatedBy: sess.staff_user_id,
    });
    return next();
  }

  const accountId = c.req.header("X-Account-Id");
  let userId;

  if (c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY) {
    if (!accountId) return c.json({ error: "unauthenticated" }, 401);
    const user = await resolveSupabaseUser(c.env, c.req.header("Authorization"));
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    userId = user.id;
  } else {
    userId = c.req.header("X-User-Id");
    if (!userId || !accountId) return c.json({ error: "unauthenticated" }, 401);
  }

  const membership = await c.env.DB.prepare(
    `SELECT * FROM memberships WHERE user_id = ? AND account_id = ?`
  ).bind(userId, accountId).first();
  if (!membership) return c.json({ error: "forbidden" }, 403);

  c.set("auth", {
    userId, accountId, role: membership.role, companyId: membership.company_id,
    membershipId: membership.id,
    propertyIds: await propertyScope(c.env.DB, membership),
  });
  await next();
});

// Which properties a seat may see, and therefore which jobs, which
// contractors and which of anything else hangs off a building.
//
// `null` means no restriction -- an admin or a project manager sees the whole
// account, which is what every membership was before building owners existed.
// An array means exactly those, and an EMPTY array means nothing: an owner
// nobody has granted a building to must not fall through to seeing them all.
// That asymmetry is the whole point, so it is decided here once rather than
// at each call site, where "no rows" reads like "no filter".
// The roles whose view of the account is limited to named buildings. A
// building owner sees theirs and can ask for work; a scoped property manager
// runs the work at theirs. Both are restricted the same way -- what differs is
// what they may do inside the restriction, which requireRole decides.
// Roles that are ALWAYS limited to named buildings, and for which an empty
// list means access to nothing. A property manager is deliberately not one of
// them: theirs is optional, and empty means the whole account -- see
// propertyScope, where that asymmetry lives.
const ALWAYS_SCOPED_ROLES = ["owner", "tenant"];

async function propertyScope(db, membership) {
  const role = membership.role;
  // A property manager's list is optional. Most firms have one or two people
  // who see the whole book; a big one assigns each manager to named buildings
  // and wants them to see only those. Same role either way -- the buildings
  // are the difference, not the job.
  if (role !== "pm" && !ALWAYS_SCOPED_ROLES.includes(role)) return null;

  const { results } = await db.prepare(
    `SELECT property_id FROM membership_properties WHERE membership_id = ?`
  ).bind(membership.id).all();
  const ids = (results || []).map((r) => r.property_id);

  // Here is the asymmetry, and it is deliberate. For a manager, no rows means
  // nobody narrowed them, so they see everything -- which is what every
  // membership was before any of this existed, and what an upgrade must leave
  // untouched. For an owner or a tenant, no rows means nobody has given them
  // a building, and they must see nothing rather than fall through to all.
  if (!ids.length && role === "pm") return null;
  return ids;
}

// Guards a single property id against the seat's scope.
const maySeeProperty = (auth, propertyId) =>
  !auth.propertyIds || (propertyId != null && auth.propertyIds.includes(propertyId));

// A `WHERE` fragment plus its bindings, for the scoped list endpoints. Written
// as `IN ()` with no members when the scope is empty, which SQLite reads as
// false -- the safe direction.
function scopeClause(auth, column) {
  if (!auth.propertyIds) return { sql: "", vals: [] };
  if (!auth.propertyIds.length) return { sql: ` AND 0 `, vals: [] };
  return {
    sql: ` AND ${column} IN (${auth.propertyIds.map(() => "?").join(",")}) `,
    vals: auth.propertyIds,
  };
}

// What a building owner may reach. An allowlist, not a deny-list, and that is
// deliberate: the routes here were all written when an account had three roles
// and some of them reason about the caller by elimination. The work-order
// response route, for instance, asks "is this a contractor working on someone
// else's order" -- a question that silently answers "no, let them through" for
// a role that did not exist when it was written. A deny-list would have to be
// amended every time a route is added, by somebody who remembers this exists.
// This way a new route refuses owners until somebody decides otherwise, which
// is the direction a mistake should fail in.
//
// Everything listed is either scoped to the owner's own buildings inside the
// handler, or carries nothing account-specific at all.
const OWNER_ALLOWED = [
  [/^\/api\/account$/, ["GET"]],
  [/^\/api\/account-by-subdomain\/[^/]+$/, ["GET"]],
  // One's own notification choices. The route only ever writes its caller's
  // row, so there is nothing here a narrow seat could reach that is not theirs.
  [/^\/api\/me$/, ["PATCH"]],
  [/^\/api\/logo\/[^/]+$/, ["GET"]],
  [/^\/api\/auth\/me$/, ["GET"]],
  [/^\/api\/account-users$/, ["GET"]],     // scoped: themselves only
  [/^\/api\/properties$/, ["GET"]],        // scoped: their buildings
  [/^\/api\/jobs$/, ["GET", "POST"]],      // scoped; POST creates a request
  [/^\/api\/subs$/, ["GET"]],              // scoped: who works their buildings
  [/^\/api\/service-calls$/, ["GET"]],     // scoped: on their own jobs
  [/^\/api\/visits$/, ["GET"]],
  [/^\/api\/jobs\/[^/]+\/withdraw$/, ["POST"]],
  [/^\/api\/jobs\/[^/]+\/report$/, ["PATCH"]],
  // Photos on their own report: attach after uploading, view, take one off.
  // A photo is reached by job and photo id, never by R2 key.
  [/^\/api\/jobs\/[^/]+\/photos$/, ["POST"]],
  [/^\/api\/jobs\/[^/]+\/photos\/[^/]+$/, ["GET", "DELETE"]],
  // The upload itself. Narrowed to this one kind: the generic route would
  // otherwise let a tenant write any prefix under the account.
  [/^\/api\/uploads\/report-photo\/.+$/, ["PUT"]],
];

// A tenant's is narrower again. They report problems and watch what happens
// to them; there is no portfolio to look at, no contractor list, and no
// building-wide view -- other people's repairs are not their business any
// more than theirs are other people's.
const TENANT_ALLOWED = [
  [/^\/api\/account$/, ["GET"]],
  [/^\/api\/account-by-subdomain\/[^/]+$/, ["GET"]],
  // One's own notification choices. The route only ever writes its caller's
  // row, so there is nothing here a narrow seat could reach that is not theirs.
  [/^\/api\/me$/, ["PATCH"]],
  [/^\/api\/logo\/[^/]+$/, ["GET"]],
  [/^\/api\/auth\/me$/, ["GET"]],
  [/^\/api\/account-users$/, ["GET"]],     // scoped: themselves only
  [/^\/api\/properties$/, ["GET"]],        // scoped: their building
  [/^\/api\/jobs$/, ["GET", "POST"]],      // scoped: their own reports
  // Their own report: taken back, or corrected within ten minutes.
  [/^\/api\/jobs\/[^/]+\/withdraw$/, ["POST"]],
  [/^\/api\/jobs\/[^/]+\/report$/, ["PATCH"]],
  // Photos on their own report: attach after uploading, view, take one off.
  // A photo is reached by job and photo id, never by R2 key.
  [/^\/api\/jobs\/[^/]+\/photos$/, ["POST"]],
  [/^\/api\/jobs\/[^/]+\/photos\/[^/]+$/, ["GET", "DELETE"]],
  // The upload itself. Narrowed to this one kind: the generic route would
  // otherwise let a tenant write any prefix under the account.
  [/^\/api\/uploads\/report-photo\/.+$/, ["PUT"]],
  // The proposed time for a repair of theirs, and their answer to it.
  [/^\/api\/visits$/, ["GET"]],
  [/^\/api\/visits\/[^/]+\/respond$/, ["POST"]],
];

app.use("/api/*", async (c, next) => {
  const auth = c.get("auth");
  const list = auth?.role === "owner" ? OWNER_ALLOWED
    : auth?.role === "tenant" ? TENANT_ALLOWED
    : null;
  if (!list) return next();
  const path = new URL(c.req.url).pathname;
  const ok = list.some(([re, methods]) => re.test(path) && methods.includes(c.req.method));
  if (!ok) return c.json({ error: "forbidden" }, 403);
  await next();
});

// Everything a scoped seat does to a named job, work order or service call,
// checked in one place.
//
// The list endpoints filter, so a scoped seat is never SHOWN another
// building's job. That is not the same as being unable to act on one: the id
// is in the URL, and guessing or remembering one is all it would take. Doing
// this per handler would mean getting it right in a dozen places and in every
// route added later, so it happens here, before any of them run.
app.use("/api/*", async (c, next) => {
  const auth = c.get("auth");
  if (!auth?.propertyIds) return next();          // an unrestricted seat
  const path = new URL(c.req.url).pathname;

  // A building named directly: editing or removing one that is not theirs.
  const prop = path.match(/^\/api\/properties\/([^/]+)$/);
  if (prop) {
    if (!maySeeProperty(auth, prop[1])) return c.json({ error: "forbidden" }, 403);
    return next();
  }
  // Adding one is not narrowing work at a building, it is changing the
  // portfolio, and somebody given five buildings to run is not the person who
  // decides there is a sixth. They would not be able to see it afterwards
  // either, which is its own kind of wrong.
  if (path === "/api/properties" && c.req.method === "POST") {
    return c.json({ error: "forbidden" }, 403);
  }

  // The three ways a request names work: directly, through the work order
  // issued for it, or through a service call raised against it.
  const job = path.match(/^\/api\/jobs\/([^/]+)(?:\/|$)/);
  const wo = path.match(/^\/api\/work-orders\/([^/]+)(?:\/|$)/);
  const sc = path.match(/^\/api\/service-calls\/([^/]+)(?:\/|$)/);
  // /api/jobs/all-bookings is a collection, not a job.
  const jobId = job && job[1] !== "all-bookings" ? job[1] : null;
  if (!jobId && !wo && !sc) return next();

  const row = jobId
    ? await c.env.DB.prepare(`SELECT property_id FROM jobs WHERE id = ? AND account_id = ?`)
        .bind(jobId, auth.accountId).first()
    : wo
    ? await c.env.DB.prepare(
        `SELECT j.property_id FROM work_orders w JOIN jobs j ON j.id = w.job_id
          WHERE w.id = ? AND j.account_id = ?`).bind(wo[1], auth.accountId).first()
    : await c.env.DB.prepare(
        `SELECT j.property_id FROM service_calls s JOIN jobs j ON j.id = s.job_id
          WHERE s.id = ? AND j.account_id = ?`).bind(sc[1], auth.accountId).first();

  // A missing row is reported as missing rather than forbidden: it is one or
  // the other and the caller learns nothing either way, but "not found" is
  // what it actually is.
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!maySeeProperty(auth, row.property_id)) return c.json({ error: "forbidden" }, 403);
  await next();
});

function requireRole(...roles) {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!roles.includes(auth.role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

// The per-account stream the console reads. Separate from `events`: that is a
// machine audit log keyed by subject id, this is the rendered sentence a human
// reads in support. Store the text at write time — the rows it refers to
// change, so rebuilding the sentence later from foreign keys gives the wrong
// answer. Never let a logging failure fail the request that caused it.
const companyName = async (db, id) =>
  (await db.prepare(`SELECT company FROM companies WHERE id = ?`).bind(id).first())?.company || "a subcontractor";

async function logActivity(env, accountId, userId, kind, text, meta) {
  if (!accountId || !text) return;
  try {
    await env.DB.prepare(
      `INSERT INTO activity (id, account_id, at, user_id, kind, text, meta)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), accountId, userId ?? null, kind, text,
      meta ? JSON.stringify(meta) : null).run();
  } catch (err) {
    console.error("[activity] write failed:", err?.message || err);
  }
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
// A person's own notification choices. Subcontractors choose on the company
// row; a tenant has no company, so the choice is theirs and lives on the
// person. NULL is the defaults: told by email when a report moves, which is
// what they would expect, and able to turn it off.
const DEFAULT_NOTIFY = { email: true, sms: false, statusChanges: true };
const notifyOf = (user) => ({ ...DEFAULT_NOTIFY, ...(parseJson(user?.notify, {}) || {}) });

async function loginResponse(db, user) {
  const { results: memberships } = await db.prepare(
    `SELECT m.*, a.name as account_name, a.subdomain, a.kind, a.plan, a.billing, a.logo_key,
            a.use_default_mark, a.theme, a.trades, a.subscription_status, a.current_period_end,
            a.comped, a.hostname_status, a.cancel_at_period_end
     FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.user_id = ?`
  ).bind(user.id).all();
  return {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, notify: notifyOf(user) },
    memberships: memberships.map((m) => ({
      accountId: m.account_id, accountName: m.account_name, subdomain: m.subdomain,
      role: m.role, companyId: m.company_id,
      kind: m.kind, plan: m.plan, billing: m.billing, logoKey: m.logo_key, useDefaultMark: !!m.use_default_mark,
      theme: parseJson(m.theme), trades: parseJson(m.trades),
      subscriptionStatus: m.subscription_status, currentPeriodEnd: m.current_period_end,
      comped: !!m.comped, cancelAtPeriodEnd: !!m.cancel_at_period_end,
      hostnameStatus: m.hostname_status || null,
    })),
  };
}

app.post("/api/auth/dev-login", async (c) => {
  // Local development only. With real auth configured this must be closed:
  // it takes an email in the request body and hands back that user's identity
  // and every account they belong to, with no credential at all. Harmless
  // against a local seed database, an unauthenticated disclosure endpoint
  // against a real one.
  if (c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY) {
    return c.json({ error: "not_available" }, 404);
  }
  const { email } = await c.req.json();
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).bind(email).first();
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json(await loginResponse(c.env.DB, user));
});

// Real-auth equivalent: identity comes from a verified Supabase bearer
// token, not a trusted request body. Exempted from the main auth
// middleware above for the same reason dev-login is — discovering which
// accounts to offer has to work before any of them is chosen yet.
app.get("/api/auth/me", async (c) => {
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_ANON_KEY) return c.json({ error: "auth_not_configured" }, 501);
  const user = await resolveSupabaseUser(c.env, c.req.header("Authorization"));
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  return c.json(await loginResponse(c.env.DB, user));
});

// Public subcontractor application (POST /api/apply/:subdomain): the
// SubSignup form a GC links from their own site, before anyone has an
// account at all — no Supabase token, no session, nothing. Creates a bare
// company profile (documents incomplete, same starting state as an admin's
// minimal "add a sub") + an 'invited' engagement + an internal users row
// (auth_id left null), so "Already invited? Create your password" on the
// login page links a real Supabase signup to this row by email later —
// resolveSupabaseUser() already does that linking, so nothing more is
// needed here. Dedupes the company by license number exactly like the
// admin's own POST /api/subs, so a contractor who's already on SubSub for
// another GC doesn't get a duplicate profile.
// ---------------------------------------------------------------------------
// Account signup — public, unauthenticated. This is how a customer creates
// their own workspace from the marketing site's get-started page.
// ---------------------------------------------------------------------------
// Creates three rows together: the account, its first user, and an admin
// membership joining them. In real-auth mode the Supabase user is created
// first, because a failure there must not leave an orphan account behind.
app.post("/api/signup", async (c) => {
  // Two ceilings, because they guard different things. The loose one bounds
  // probing (a rejected request writes nothing, and somebody mistyping their
  // subdomain three times is normal). The tight one bounds actual creation,
  // which is the expensive, abusable half.
  const attempts = await rateLimit(c.env, "signup-attempt", clientIp(c), { limit: 20, windowMinutes: 60 });
  if (!attempts.ok) return c.json({ error: "rate_limited" }, 429);

  const b = await c.req.json().catch(() => null);
  if (!b) return c.json({ error: "bad_request" }, 400);

  const kind = ACCOUNT_KINDS.includes(b.kind) ? b.kind : "general_contractor";
  const company = String(b.company || "").trim();
  const personName = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const phoneRaw = String(b.phone || "").trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const subdomain = validSubdomain(b.subdomain);
  const plan = b.plan === "scale" ? "scale" : "basic";
  const billing = b.billing === "annual" ? "annual" : "monthly";
  // Absent is fine (an older page, or a caller that does not collect them);
  // present but wrong is not, because it would store ids nothing can render.
  const trades = b.trades === undefined ? [] : validTrades(b.trades);

  if (!company) return c.json({ error: "company_required" }, 400);
  if (!personName) return c.json({ error: "name_required" }, 400);
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 400);
  // Mobile stays optional, but a half-typed one is worse than none: it reads
  // as reachable and never is.
  if (phoneRaw && !phone) return c.json({ error: "invalid_phone" }, 400);
  if (trades === null) return c.json({ error: "invalid_trades" }, 400);
  if (!subdomain) return c.json({ error: "invalid_subdomain" }, 400);

  const realAuth = !!(c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY);
  if (realAuth && String(b.password || "").length < 8) {
    return c.json({ error: "weak_password" }, 400);
  }

  // Check both uniqueness constraints up front, so the caller gets a field
  // name back instead of a bare constraint violation.
  const [subTaken, emailTaken] = await Promise.all([
    c.env.DB.prepare(`SELECT id FROM accounts WHERE subdomain = ?`).bind(subdomain).first(),
    c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).bind(email).first(),
  ]);
  if (subTaken) return c.json({ error: "subdomain_taken" }, 409);
  if (emailTaken) return c.json({ error: "email_in_use" }, 409);

  let authId = null, needsConfirmation = false;
  if (realAuth) {
    const signed = await supabaseSignUp(c.env, email, b.password);
    if (!signed.ok) {
      const status = signed.error === "email_in_use" ? 409
        : signed.error === "auth_unreachable" ? 502 : 400;
      return c.json({ error: signed.error, detail: signed.detail }, status);
    }
    authId = signed.authId;
    needsConfirmation = !signed.session;
  }

  const creations = await rateLimit(c.env, "signup-created", clientIp(c), { limit: 3, windowMinutes: 60 });
  if (!creations.ok) return c.json({ error: "rate_limited" }, 429);

  const accountId = uid(), userId = uid(), membershipId = uid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO accounts (id, name, subdomain, kind, plan, billing, trades, use_default_mark)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(accountId, company, subdomain, kind, plan, billing, JSON.stringify(trades)),
      c.env.DB.prepare(
        `INSERT INTO users (id, auth_id, name, email, phone) VALUES (?, ?, ?, ?, ?)`
      ).bind(userId, authId, personName, email, phone),
      c.env.DB.prepare(
        `INSERT INTO memberships (id, user_id, account_id, role) VALUES (?, ?, ?, 'admin')`
      ).bind(membershipId, userId, accountId),
    ]);
  } catch (err) {
    // Two signups racing on the same subdomain or email land here.
    console.error("[signup] insert failed:", err?.message || err);
    return c.json({ error: "signup_conflict" }, 409);
  }

  // A Scale signup gets its address started immediately; a Basic one has
  // none to start. Either way this does not hold up the response.
  if (plan === "scale") {
    syncHostnameAfter(c, { id: accountId, subdomain, plan }, { reason: "signup" });
  }

  await logEvent(c.env, accountId, userId, "account.created", accountId,
    { kind, plan, subdomain, viaAuth: realAuth });
  await logActivity(c.env, accountId, userId, "account_created",
    `${personName} created this account on the ${plan === "scale" ? "Scale" : "Basic"} plan`);

  return c.json({
    ok: true, accountId, userId, subdomain, kind,
    // The app is reached at the account's own subdomain once DNS is pointed
    // at it; the caller decides whether to send them there or to app.*.
    // Branding, and with it a company hostname, is a Scale feature. A Basic
    // account still reserves its subdomain, but signs in at the shared
    // address. Sending a Basic customer to their own subdomain is how they
    // end up staring at a certificate warning, because that hostname has no
    // certificate until someone adds it as a custom domain.
    // Always the shared address at this moment, even on Scale: provisioning
    // the branded hostname started a few lines above and its certificate is
    // a minute or two away. Sending somebody to an address that is not live
    // yet is how they meet a certificate warning on their first visit.
    signInUrl: "https://app.subsub.work",
    // Creating an account never signs anyone in. The address has not been
    // proved yet, and an account usable before anyone has opened the mailbox
    // it names is an account that can be opened on somebody else's address.
    // The person confirms by email, then signs in; this flag only tells the
    // signup page which of those two things to say.
    needsConfirmation,
  }, 201);
});

// The body of an application, shared by the two ways one can arrive: the
// public form at a customer's own subdomain, and a one-time link the
// customer generated and sent themselves. Identical work either way -- only
// how the applicant got here differs, which is what `note` records.
async function createApplication(env, account, body, note) {
  const licenseKey = (body.license || "").trim().toUpperCase();

  let company = null;
  if (licenseKey) {
    company = await env.DB.prepare(`SELECT * FROM companies WHERE UPPER(TRIM(license)) = ?`).bind(licenseKey).first();
  }
  if (!company && body.email) {
    company = await env.DB.prepare(`SELECT * FROM companies WHERE lower(email) = lower(?)`).bind(body.email).first();
  }

  let companyId;
  if (company) {
    companyId = company.id;
  } else {
    companyId = uid();
    await env.DB.prepare(
      `INSERT INTO companies (id, company, contact, phone, email, license, ubi, city, state, zip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(companyId, body.company, body.contact, normalizePhone(body.phone), body.email,
      body.license || null, body.ubi || null, body.city || null, body.state || null, body.zip || null).run();
  }

  let engagementId = (await env.DB.prepare(
    `SELECT id FROM engagements WHERE account_id = ? AND company_id = ?`
  ).bind(account.id, companyId).first())?.id;
  if (!engagementId) {
    engagementId = uid();
    await env.DB.prepare(
      `INSERT INTO engagements (id, account_id, company_id, status, categories, notes)
       VALUES (?, ?, ?, 'invited', ?, ?)`
    ).bind(engagementId, account.id, companyId, JSON.stringify(body.categories || []), note).run();
  }

  // Only for a genuinely new company — an existing (deduped) one keeps its
  // established profile, same rule POST /api/subs follows.
  if (!company) {
    await applySubPatch(env.DB, companyId, engagementId, {
      crews: [],
      coverage: { mode: "cities", cities: body.city ? [body.city] : [] },
      warranty: body.warranty || null,
      notify: { email: !!body.notifyEmail, sms: !!body.notifySms },
    });
  }

  let user = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).bind(body.email).first();
  if (!user) {
    const userId = uid();
    await env.DB.prepare(`INSERT INTO users (id, name, email, phone) VALUES (?, ?, ?, ?)`)
      .bind(userId, body.contact, body.email, normalizePhone(body.phone)).run();
    user = { id: userId };
  }
  const existingMembership = await env.DB.prepare(
    `SELECT id FROM memberships WHERE user_id = ? AND account_id = ?`
  ).bind(user.id, account.id).first();
  if (!existingMembership) {
    await env.DB.prepare(
      `INSERT INTO memberships (id, user_id, account_id, role, company_id) VALUES (?, ?, ?, 'contractor', ?)`
    ).bind(uid(), user.id, account.id, companyId).run();
  }

  await logEvent(env, account.id, user.id, "engagement.applied", engagementId, { companyId, reused: !!company });

  // Confirm it landed, and say what happens next. Public entry point, so a
  // failure here must never turn a successful application into an error.
  if (body.email) {
    const mail = applicationReceivedEmail({
      companyName: body.company, contact: body.contact, account,
    });
    const result = await sendEmail(env, { to: body.email, subject: mail.subject,
      text: mail.text, html: mail.html });
    await logMail(env, { accountId: account.id, companyId, to: body.email,
      kind: "application_received", subject: mail.subject, result, sentBy: null });
  }
  return { companyId, engagementId, userId: user.id };
}

// Requires the three fields nothing downstream can do without. Returns an
// error code, or null when the body is usable.
function applicationProblem(body) {
  if (!body.company?.trim() || !body.contact?.trim() || !body.email?.trim()) return "missing_fields";
  if (!EMAIL_RE.test(String(body.email).trim())) return "invalid_email";
  if (String(body.phone || "").trim() && !normalizePhone(body.phone)) return "invalid_phone";
  return null;
}

app.post("/api/apply/:subdomain", async (c) => {
  const rl = await rateLimit(c.env, "apply", clientIp(c), { limit: 10, windowMinutes: 60 });
  if (!rl.ok) return c.json({ error: "rate_limited" }, 429);
  const subdomain = c.req.param("subdomain").trim().toLowerCase();
  // name and subdomain are needed by the confirmation email, which says who
  // the application went to and where they will eventually sign in.
  const account = await c.env.DB.prepare(
    `SELECT id, name, subdomain FROM accounts WHERE subdomain = ?`).bind(subdomain).first();
  if (!account) return c.json({ error: "unknown_account" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const problem = applicationProblem(body);
  if (problem) return c.json({ error: problem }, 400);

  await createApplication(c.env, account, body, "Applied through the public application form.");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Billing (Stripe)
// ---------------------------------------------------------------------------
// Two doors out to Stripe and one door back in. Nothing here decides what a
// customer owes or whether they have paid -- Stripe decides, and the webhook
// records the answer. The accounts table is a cache of Stripe's last word,
// never an independent opinion about money.

const APP_ORIGIN = "https://app.subsub.work";

// Start an upgrade. Returns a Stripe Checkout URL for the browser to follow.
app.post("/api/billing/checkout", requireRole("admin"), async (c) => {
  const { accountId, userId } = c.get("auth");
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: "billing_not_configured" }, 501);

  const b = await c.req.json().catch(() => ({}));
  const cycle = b.cycle === "annual" ? "annual" : "monthly";
  const price = priceFor(c.env, cycle);
  if (!price) return c.json({ error: "billing_not_configured" }, 501);

  const account = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!account) return c.json({ error: "not_found" }, 404);
  const user = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(userId).first();

  // Embedded renders Stripe's form inside our own page; hosted sends the
  // browser to stripe.com. The caller asks for embedded only when it has a
  // publishable key to mount it with, so a build without one still works
  // rather than showing an empty box.
  const wantsEmbedded = b.mode === "embedded";

  // Everything that does not depend on where the form is drawn.
  const base = {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: accountId,
    allow_promotion_codes: true,
    // Reuse the customer if this account has ever paid, so a second
    // subscription does not arrive under a second customer with the same
    // email and split their billing history in two.
    ...(account.stripe_customer_id
      ? { customer: account.stripe_customer_id }
      : { customer_email: user?.email || undefined }),
    // Stamped in two places because the webhook may see either object
    // first, depending on which event arrives.
    metadata: { account_id: accountId },
    subscription_data: { metadata: { account_id: accountId } },
  };

  // Stripe renamed this value: `embedded` is refused now in favour of
  // `embedded_page`. Older API versions still want the old spelling, so both
  // are tried -- and if neither is accepted, the hosted page is. Where the
  // form is drawn is a preference; being able to pay is not, and a rename at
  // Stripe must never be the reason a customer cannot hand over money.
  const attempts = wantsEmbedded
    ? [
        { mode: "embedded", ui_mode: "embedded_page" },
        { mode: "embedded", ui_mode: "embedded" },
        { mode: "hosted" },
      ]
    : [{ mode: "hosted" }];

  let lastErr = null;
  try {
    for (const attempt of attempts) {
      const embedded = attempt.mode === "embedded";
      try {
        const session = await stripeCall(c.env, "/checkout/sessions", {
          params: {
            ...base,
            ...(embedded
              // Stripe substitutes the real id into this placeholder; it must
              // survive form-encoding as a literal, which it does, because the
              // value is decoded again at the other end.
              ? { ui_mode: attempt.ui_mode,
                  return_url: `${APP_ORIGIN}/?billing=done&session_id={CHECKOUT_SESSION_ID}` }
              : { success_url: `${APP_ORIGIN}/?billing=done`,
                  cancel_url: `${APP_ORIGIN}/?billing=cancelled` }),
          },
          // A double-tapped button within the same minute is one checkout, not
          // two. The spelling is part of the key: a retry after a refusal is a
          // different request, and reusing the key would replay the refusal.
          idempotencyKey: `checkout:${accountId}:${cycle}:${embedded ? attempt.ui_mode : "h"}:${Math.floor(Date.now() / 60000)}`,
        });
        if (attempt !== attempts[0]) {
          console.warn("[billing] checkout fell back to",
            attempt.ui_mode || "hosted", "--", lastErr?.message || "");
        }
        return c.json(embedded ? { clientSecret: session.client_secret } : { url: session.url });
      } catch (err) {
        lastErr = err;
        // Only a quarrel about ui_mode is worth another attempt. A declined
        // card or a missing price fails the same way every time, and retrying
        // it only delays the message that would have helped.
        if (!/ui_mode/i.test(String(err?.message || ""))) throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    console.error("[billing] checkout failed:", err?.message || err);
    return c.json({ error: "stripe_failed", detail: String(err?.message || err) }, 502);
  }
});

// Moving an account down to the free Basic plan, without leaving SubSub.
//
// "Cancel" is Stripe's word for it and this does call Stripe's cancel, but
// the product meaning is a downgrade: the account stays open, the data stays
// put, and only the paid features stop. Saying "cancel" to the customer
// reads as losing the account, which is not what happens and not what
// anybody wants to be told.
//
// Stripe's billing portal is a hosted page -- there is no embedded version
// of it -- so sending somebody there to cancel undoes the whole point of an
// embedded checkout: the last thing they see of us before they leave is
// somebody else's website. Cancelling is one API call, so it happens here.
//
// At period end, never immediately. They paid for the period; taking it away
// early is both wrong and the kind of thing that turns a quiet cancellation
// into a chargeback. The account keeps Scale until the date it was paid to.
app.post("/api/billing/cancel", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: "billing_not_configured" }, 501);

  const account = await c.env.DB.prepare(
    `SELECT stripe_subscription_id FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!account?.stripe_subscription_id) return c.json({ error: "no_subscription" }, 409);

  try {
    const sub = await stripeCall(c.env, `/subscriptions/${account.stripe_subscription_id}`, {
      params: { cancel_at_period_end: true },
    });
    // Write through rather than waiting for the webhook: the customer is
    // looking at the screen now, and "did that work?" should not depend on
    // how quickly Stripe calls back.
    const full = await accountRow(c.env, accountId);
    if (full) await applySubscription(c.env, full, sub);
    await logActivity(c.env, accountId, c.get("auth").userId, "plan_changed",
      "Scheduled to move to the free Basic plan at the end of the period");
    return c.json({ ok: true, endsAt: stripeTime(sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end) });
  } catch (err) {
    console.error("[billing] cancel failed:", err?.message || err);
    return c.json({ error: "stripe_failed", detail: String(err?.message || err) }, 502);
  }
});

// And changing their mind, which is the same call in reverse. Worth having:
// somebody who cancels by accident should not have to buy the plan again.
app.post("/api/billing/resume", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: "billing_not_configured" }, 501);

  const account = await c.env.DB.prepare(
    `SELECT stripe_subscription_id FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!account?.stripe_subscription_id) return c.json({ error: "no_subscription" }, 409);

  try {
    const sub = await stripeCall(c.env, `/subscriptions/${account.stripe_subscription_id}`, {
      params: { cancel_at_period_end: false },
    });
    const full = await accountRow(c.env, accountId);
    if (full) await applySubscription(c.env, full, sub);
    await logActivity(c.env, accountId, c.get("auth").userId, "plan_changed",
      "Staying on Scale — the move to Basic was called off");
    return c.json({ ok: true });
  } catch (err) {
    console.error("[billing] resume failed:", err?.message || err);
    return c.json({ error: "stripe_failed", detail: String(err?.message || err) }, 502);
  }
});

// Stripe's own billing portal: card changes, invoices, cancellation. Building
// any of that ourselves would mean handling card details, which is the one
// thing worth never touching.
app.post("/api/billing/portal", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: "billing_not_configured" }, 501);

  const account = await c.env.DB.prepare(
    `SELECT stripe_customer_id FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!account?.stripe_customer_id) return c.json({ error: "no_subscription" }, 409);

  try {
    const session = await stripeCall(c.env, "/billing_portal/sessions", {
      params: { customer: account.stripe_customer_id, return_url: `${APP_ORIGIN}/` },
    });
    return c.json({ url: session.url });
  } catch (err) {
    console.error("[billing] portal failed:", err?.message || err);
    return c.json({ error: "stripe_failed", detail: String(err?.message || err) }, 502);
  }
});

// What the app shows on the billing panel. Read from our own cache rather
// than Stripe, so opening a settings page is not an API call to a third party.
app.get("/api/billing", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const a = await c.env.DB.prepare(
    `SELECT plan, billing, subscription_status, current_period_end, stripe_customer_id
     FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!a) return c.json({ error: "not_found" }, 404);

  const { results: invoices } = await c.env.DB.prepare(
    `SELECT id, amount_cents, status, period_start, period_end, paid_at, attempt_count
     FROM invoices WHERE account_id = ? ORDER BY period_start DESC LIMIT 12`
  ).bind(accountId).all();

  return c.json({
    plan: a.plan, cycle: a.billing,
    status: a.subscription_status,
    currentPeriodEnd: a.current_period_end,
    hasCustomer: !!a.stripe_customer_id,
    configured: !!c.env.STRIPE_SECRET_KEY,
    invoices: invoices.map((i) => ({
      id: i.id, amountCents: i.amount_cents, status: i.status,
      periodStart: i.period_start, periodEnd: i.period_end,
      paidAt: i.paid_at, attemptCount: i.attempt_count,
    })),
  });
});

// Find the account a Stripe object belongs to. The metadata is stamped at
// checkout, but a subscription changed from Stripe's own dashboard may
// arrive without it, so the customer id is the fallback.
async function accountForStripe(env, { accountId, customerId }) {
  if (accountId) {
    const a = await env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(accountId).first();
    if (a) return a;
  }
  if (customerId) {
    return env.DB.prepare(`SELECT * FROM accounts WHERE stripe_customer_id = ?`).bind(customerId).first();
  }
  return null;
}

// Write the plan change and the row that explains it. mrr_delta is signed, so
// the platform console can sum a month without re-deriving who moved where.
const accountRow = (env, id) =>
  env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first();

async function applySubscription(env, account, sub) {
  const status = sub.status;
  const entitled = ENTITLED.has(status);
  const item = sub.items?.data?.[0];
  const cycle = item?.price?.recurring?.interval === "year" ? "annual" : "monthly";
  // A comped account keeps Scale whatever Stripe says. Somebody who was given
  // the plan should not lose it because a card they never entered expired,
  // or because a cancelled trial from months ago finally reported in.
  const plan = (entitled || account.comped) ? "scale" : "basic";
  // Stripe moved current_period_end off the subscription and onto its items,
  // so reading only the old place returned nothing and the app fell back to
  // "renews annually" with no date -- which is exactly what it looked like.
  // Both are read, newest first, so this works either side of that change.
  const periodEnd = stripeTime(item?.current_period_end ?? sub.current_period_end);
  // Status stays `active` on a subscription that is cancelling, so this is
  // the only thing that distinguishes "renews on" from "ends on".
  const cancelAtEnd = sub.cancel_at_period_end ? 1 : 0;

  const was = account.plan;
  // The cancel flag lives in a column added by migration 013. A deploy can
  // land before somebody runs the migration, and if that makes this write
  // throw then every webhook fails -- payments succeed at Stripe and never
  // reach the account, which is the worst failure this file has. So the
  // newer shape is tried and the older one is the fallback: a missing column
  // costs one field, not the whole subscription.
  try {
    await env.DB.prepare(
      `UPDATE accounts SET plan = ?, billing = ?, stripe_subscription_id = ?,
              stripe_customer_id = COALESCE(stripe_customer_id, ?),
              subscription_status = ?, current_period_end = ?, cancel_at_period_end = ?
       WHERE id = ?`
    ).bind(plan, cycle, sub.id, sub.customer, status, periodEnd, cancelAtEnd, account.id).run();
  } catch (err) {
    if (!/no such column/i.test(String(err?.message || err))) throw err;
    console.warn("[billing] cancel_at_period_end column missing -- run migration 013");
    await env.DB.prepare(
      `UPDATE accounts SET plan = ?, billing = ?, stripe_subscription_id = ?,
              stripe_customer_id = COALESCE(stripe_customer_id, ?),
              subscription_status = ?, current_period_end = ?
       WHERE id = ?`
    ).bind(plan, cycle, sub.id, sub.customer, status, periodEnd, account.id).run();
  }

  if (was !== plan) {
    const monthly = cycle === "annual" ? 8250 : 9900;   // $990/yr and $99/mo, in cents
    const kind = plan === "scale" ? "upgraded" : (status === "canceled" ? "canceled" : "downgraded");
    await env.DB.prepare(
      `INSERT INTO subscription_events (id, account_id, at, kind, from_plan, to_plan, cycle, mrr_delta_cents, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stripe')`
    ).bind(uid(), account.id, new Date().toISOString(), kind, was, plan, cycle,
      plan === "scale" ? monthly : -monthly).run();

    await logActivity(env, account.id, null, "plan_changed",
      plan === "scale" ? `Upgraded to Scale (${cycle})` : "Moved to Basic");

    // Paying for Scale is the moment the branded address is owed, and
    // stopping is the moment it is not. No ctx here -- the webhook handler
    // awaits this, which is right: Stripe retries a failed webhook, and a
    // hostname left unprovisioned because the response beat it is worse
    // than a webhook that took another second.
    await syncHostname(env, { id: account.id, subdomain: account.subdomain, plan },
      { reason: "stripe" });
  }
}

// Stripe's way in. Unauthenticated by necessity -- Stripe has no session --
// so the signature is the only thing establishing that this is real, and a
// failed check must stop everything.
app.post("/api/stripe/webhook", async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "billing_not_configured" }, 501);

  // The raw bytes, before any parsing: the signature is over exactly what
  // Stripe sent, and re-serialising JSON would not reproduce it.
  const raw = await c.req.text();
  const event = await verifyStripeWebhook(raw, c.req.header("stripe-signature"), secret);
  if (!event) {
    console.error("[stripe] rejected an unsigned or stale webhook");
    return c.json({ error: "bad_signature" }, 400);
  }

  // Stripe retries until it gets a 2xx and can deliver the same event twice
  // on its own, so every handler below runs at most once per event id.
  try {
    await c.env.DB.prepare(`INSERT INTO stripe_events (id, type) VALUES (?, ?)`)
      .bind(event.id, event.type).run();
  } catch {
    return c.json({ ok: true, duplicate: true });
  }

  try {
    const obj = event.data?.object || {};
    switch (event.type) {
      case "checkout.session.completed": {
        const account = await accountForStripe(c.env, {
          accountId: obj.client_reference_id || obj.metadata?.account_id,
          customerId: obj.customer,
        });
        if (!account) break;
        // Record the customer immediately, so the portal works even if the
        // subscription events arrive late or out of order.
        await c.env.DB.prepare(`UPDATE accounts SET stripe_customer_id = ? WHERE id = ?`)
          .bind(obj.customer, account.id).run();
        if (obj.subscription) {
          const sub = await stripeCall(c.env, `/subscriptions/${obj.subscription}`, { method: "GET" });
          await applySubscription(c.env, account, sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const account = await accountForStripe(c.env, {
          accountId: obj.metadata?.account_id, customerId: obj.customer,
        });
        if (!account) break;
        await applySubscription(c.env, account, obj);
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const account = await accountForStripe(c.env, {
          accountId: obj.subscription_details?.metadata?.account_id, customerId: obj.customer,
        });
        if (!account) break;
        // Keyed by Stripe's invoice id, so a retry overwrites rather than
        // duplicating, and a failed invoice later paid updates in place.
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO invoices
             (id, account_id, amount_cents, status, period_start, period_end, paid_at, attempt_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(obj.id, account.id, obj.amount_due ?? obj.amount_paid ?? 0, obj.status,
          stripeTime(obj.period_start) || new Date().toISOString(),
          stripeTime(obj.period_end) || new Date().toISOString(),
          obj.status === "paid" ? stripeTime(obj.status_transitions?.paid_at) : null,
          obj.attempt_count ?? 0).run();
        break;
      }

      default:
        break;   // Stripe sends a great deal we have no opinion about.
    }
  } catch (err) {
    // Forget the event so Stripe's retry gets a real second attempt rather
    // than being deduplicated against a run that failed halfway.
    console.error("[stripe] handler failed:", event.type, err?.message || err);
    await c.env.DB.prepare(`DELETE FROM stripe_events WHERE id = ?`).bind(event.id).run().catch(() => {});
    return c.json({ error: "handler_failed" }, 500);
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Subcontractor invite links
// ---------------------------------------------------------------------------
// The token is the credential: whoever holds the link can file an
// application against this account. So it is 32 bytes of CSPRNG output, it
// expires, and it is spent on first use. Nothing about the account is
// guessable from it and nothing else is needed to use it, which is the whole
// point -- a contractor with a phone and a text message should not have to
// be told a subdomain, an email address or a password first.
const INVITE_TTL_DAYS = 30;

function newInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Where a holder of this token should be sent. A query string rather than a
// path, because the app is a single page served by Pages: an unknown path
// depends on SPA-fallback configuration to resolve, and a query string
// always does.
const inviteUrl = (token) => `https://app.subsub.work/?invite=${token}`;

const inviteRowToJs = (r) => ({
  id: r.id, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at,
  usedAt: r.used_at, revokedAt: r.revoked_at, companyId: r.company_id,
  url: inviteUrl(r.token),
  status: r.revoked_at ? "revoked"
    : r.used_at ? "accepted"
    : new Date(r.expires_at) < new Date() ? "expired"
    : "open",
});

// A PM can hand out links; only an admin should be able to revoke one, same
// split as everywhere else in the account.
app.post("/api/invites", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  const label = String(b.label || "").trim().slice(0, 120) || null;

  const id = uid(), token = newInviteToken();
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO sub_invites (id, account_id, token, label, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, accountId, token, label, userId, expires).run();

  await logActivity(c.env, accountId, userId, "invite_created",
    label ? `Invite link created for ${label}` : "Invite link created");

  const row = await c.env.DB.prepare(`SELECT * FROM sub_invites WHERE id = ?`).bind(id).first();
  return c.json(inviteRowToJs(row), 201);
});

app.get("/api/invites", async (c) => {
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM sub_invites WHERE account_id = ? ORDER BY created_at DESC LIMIT 100`
  ).bind(accountId).all();
  return c.json(results.map(inviteRowToJs));
});

app.delete("/api/invites/:id", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  // Scoped by account, so an id from another account is a miss rather than a
  // revocation of somebody else's link.
  const res = await c.env.DB.prepare(
    `UPDATE sub_invites SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = ? AND account_id = ? AND used_at IS NULL AND revoked_at IS NULL`
  ).bind(c.req.param("id"), accountId).run();
  if (!res.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// Public. Looks a token up so the application form can name who it is for and
// carry their branding, before the applicant has typed anything.
async function lookupInvite(env, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return { error: "invalid" };
  const row = await env.DB.prepare(`SELECT * FROM sub_invites WHERE token = ?`).bind(token).first();
  if (!row) return { error: "invalid" };
  if (row.revoked_at) return { error: "revoked" };
  if (row.used_at) return { error: "used" };
  if (new Date(row.expires_at) < new Date()) return { error: "expired" };
  const account = await env.DB.prepare(
    `SELECT id, name, subdomain, theme, logo_key, use_default_mark FROM accounts WHERE id = ?`
  ).bind(row.account_id).first();
  if (!account) return { error: "invalid" };
  return { invite: row, account };
}

app.get("/api/invite/:token", async (c) => {
  const { error, invite, account } = await lookupInvite(c.env, c.req.param("token"));
  // Every failure reads the same from outside: a token that was never valid
  // and one that was spent an hour ago are not worth telling apart for
  // somebody probing, and the person holding a real dead link needs the same
  // instruction either way -- ask for a new one.
  if (error) return c.json({ error }, error === "invalid" ? 404 : 410);
  return c.json({
    label: invite.label,
    account: {
      name: account.name, subdomain: account.subdomain,
      theme: parseJson(account.theme),
      logoKey: account.logo_key, useDefaultMark: !!account.use_default_mark,
      id: account.id,
    },
  });
});

app.post("/api/invite/:token", async (c) => {
  const rl = await rateLimit(c.env, "apply", clientIp(c), { limit: 10, windowMinutes: 60 });
  if (!rl.ok) return c.json({ error: "rate_limited" }, 429);

  const { error, invite, account } = await lookupInvite(c.env, c.req.param("token"));
  if (error) return c.json({ error }, error === "invalid" ? 404 : 410);

  const body = await c.req.json().catch(() => ({}));
  const problem = applicationProblem(body);
  if (problem) return c.json({ error: problem }, 400);

  const { companyId } = await createApplication(c.env, account, body,
    invite.label ? `Applied through an invite link sent to ${invite.label}.`
      : "Applied through an invite link.");

  // Spent, and only now -- an application that failed halfway should leave
  // the link usable rather than stranding somebody with a dead one.
  await c.env.DB.prepare(
    `UPDATE sub_invites SET used_at = CURRENT_TIMESTAMP, company_id = ? WHERE id = ?`
  ).bind(companyId, invite.id).run();

  await logActivity(c.env, account.id, null, "invite_accepted",
    `${body.company} joined through an invite link`);

  return c.json({ ok: true });
});

// This account's members (admin/pm/contractor), composed with the person's
// name/email/phone — what the UI calls `accountUsers`.
app.get("/api/account-users", async (c) => {
  const auth = c.get("auth");
  const { accountId } = auth;
  // A building owner is a guest in somebody else's account: who else has a
  // login there is not theirs to read. They still need their own row, which
  // is how the app knows which seat it is sitting in. A scoped property
  // manager does need the list -- they answer the owners who raise work, and
  // a request signed "an owner" is no use to them.
  const mine = (auth.role === "owner" || auth.role === "tenant") ? ` AND m.user_id = ? ` : "";
  const { results } = await c.env.DB.prepare(
    `SELECT u.*, m.role, m.company_id, m.unit FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.account_id = ? ${mine}`
  ).bind(accountId, ...((auth.role === "owner" || auth.role === "tenant") ? [auth.userId] : [])).all();
  const { results: scopes } = await c.env.DB.prepare(
    `SELECT mp.property_id, m.user_id FROM membership_properties mp
       JOIN memberships m ON m.id = mp.membership_id WHERE m.account_id = ?`
  ).bind(accountId).all();
  const byUser = {};
  for (const r of scopes || []) (byUser[r.user_id] ||= []).push(r.property_id);

  return c.json(results.map((r) => ({
    // A tenant added by phone alone carries a placeholder address. It exists
    // so the row has a unique key, and it is nobody's address: handing it to
    // the browser gets it printed next to a mailto: link that goes nowhere.
    id: r.id, name: r.name, email: realEmail(r.email), phone: r.phone, role: r.role, subId: r.company_id,
    propertyIds: byUser[r.id] || [], unit: r.unit || null,
  })));
});

// Add (or re-invite) a person to this account. Dedupes the person on email —
// same person can already exist as a user from another account.
// A role the API will accept on a membership. The database no longer carries
// a CHECK for this (see migration 014), so this is the constraint.
const MEMBER_ROLES = ["admin", "pm", "owner", "tenant", "contractor"];

// Replaces a membership's building list. Only an owner has one: giving an
// admin a list would read as a restriction the rest of the code does not
// apply, so the rows are cleared instead of written.
async function setMembershipProperties(db, membershipId, accountId, role, propertyIds) {
  const stmts = [db.prepare(`DELETE FROM membership_properties WHERE membership_id = ?`).bind(membershipId)];
  // A manager with no list is unrestricted, so an empty list is a real state
  // to store rather than a reason to skip the write -- clearing one is how
  // somebody gets widened back to the whole account.
  if (role === "pm" || ALWAYS_SCOPED_ROLES.includes(role)) {
    for (const pid of [...new Set(propertyIds || [])]) {
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO membership_properties (membership_id, property_id)
         SELECT ?, id FROM properties WHERE id = ? AND account_id = ?`
      ).bind(membershipId, pid, accountId));
    }
  }
  await db.batch(stmts);
}

app.post("/api/account-users", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json(); // { name, email, phone, role, subId, propertyIds }
  if (!MEMBER_ROLES.includes(b.role)) return c.json({ error: "invalid_role" }, 400);
  // An owner or tenant scoped to nothing can see nothing, which is a login
  // that does not work and a support call that follows. A manager with no
  // list is the ordinary case -- the whole account -- so it is not refused.
  if (ALWAYS_SCOPED_ROLES.includes(b.role) && !(b.propertyIds || []).length) {
    return c.json({ error: "properties_required" }, 400);
  }
  let user = await c.env.DB.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).bind(b.email).first();
  const userId = user?.id ?? uid();
  if (!user) {
    await c.env.DB.prepare(`INSERT INTO users (id, name, email, phone) VALUES (?, ?, ?, ?)`)
      .bind(userId, b.name, b.email, b.phone || null).run();
  }
  const existingMembership = await c.env.DB.prepare(
    `SELECT id FROM memberships WHERE user_id = ? AND account_id = ?`
  ).bind(userId, accountId).first();
  let membershipId;
  if (existingMembership) {
    membershipId = existingMembership.id;
    await c.env.DB.prepare(`UPDATE memberships SET role = ?, company_id = ? WHERE id = ?`)
      .bind(b.role, b.subId ?? null, membershipId).run();
  } else {
    membershipId = uid();
    await c.env.DB.prepare(`INSERT INTO memberships (id, user_id, account_id, role, company_id) VALUES (?, ?, ?, ?, ?)`)
      .bind(membershipId, userId, accountId, b.role, b.subId ?? null).run();
  }
  await setMembershipProperties(c.env.DB, membershipId, accountId, b.role, b.propertyIds);
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
    if (!MEMBER_ROLES.includes(b.role)) return c.json({ error: "invalid_role" }, 400);
    await c.env.DB.prepare(`UPDATE memberships SET role = ?, company_id = ? WHERE user_id = ? AND account_id = ?`)
      .bind(b.role, b.subId ?? null, userId, accountId).run();
  }
  // The list travels with the role. Demoting somebody to owner without one
  // would leave them seeing nothing; promoting an owner to admin has to drop
  // theirs, or a stale list sits there looking like it means something.
  if (b.role != null || b.propertyIds !== undefined) {
    const m = await c.env.DB.prepare(
      `SELECT id, role FROM memberships WHERE user_id = ? AND account_id = ?`
    ).bind(userId, accountId).first();
    if (m) await setMembershipProperties(c.env.DB, m.id, accountId, m.role, b.propertyIds);
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
    id: a.id, name: a.name, subdomain: a.subdomain, kind: a.kind, plan: a.plan, billing: a.billing,
    logoKey: a.logo_key, useDefaultMark: !!a.use_default_mark, theme: parseJson(a.theme),
    // null when nobody has chosen yet -- which is the cue to ask, and is not
    // the same answer as an empty list.
    trades: parseJson(a.trades),
    // What Stripe last told us. The app shows the renewal date from this
    // rather than asking Stripe on every page load.
    subscriptionStatus: a.subscription_status,
    currentPeriodEnd: a.current_period_end,
    comped: !!a.comped,
    // Where their own address got to. The status only -- hostname_error is
    // Cloudflare's own words about our credentials or our zone, which is
    // staff's problem to read and nothing a customer can act on. Telling
    // them "dns: Authentication failed" would be alarming and useless.
    cancelAtPeriodEnd: !!a.cancel_at_period_end,
    hostnameStatus: a.hostname_status || null,
    hostnameCheckedAt: a.hostname_checked_at || null,
    // Who an urgent report goes straight to. Null means nothing dispatches
    // itself, which is how every account starts.
    emergencyCompanyId: a.emergency_company_id || null,
    user: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone, notify: notifyOf(user) } : null,
  });
});

// Public: serves an account's uploaded logo image. Only ever serves the one
// key stored against that account's own logo_key column — never an
// arbitrary path — so this can't be used to read anything else out of R2.
app.get("/api/logo/:accountId", async (c) => {
  const a = await c.env.DB.prepare(`SELECT logo_key FROM accounts WHERE id = ?`).bind(c.req.param("accountId")).first();
  if (!a?.logo_key) return c.notFound();
  const obj = await c.env.FILES.get(a.logo_key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
});

// Public: the branding a hiring account's own subdomain shows before login
// (e.g. outerhome.subsub.work). Only exposes what a logged-out login screen
// needs — never anything else about the account.
app.get("/api/account-by-subdomain/:subdomain", async (c) => {
  const a = await c.env.DB.prepare(
    // kind is read back below and was never selected, so every branded
    // sign-in page thought it belonged to a general contractor.
    `SELECT id, name, subdomain, kind, plan, billing, logo_key, use_default_mark, theme
       FROM accounts WHERE subdomain = ?`
  ).bind(c.req.param("subdomain").toLowerCase()).first();
  if (!a) return c.notFound();
  return c.json({
    id: a.id, name: a.name, subdomain: a.subdomain, kind: a.kind, plan: a.plan, billing: a.billing,
    logoKey: a.logo_key, useDefaultMark: !!a.use_default_mark, theme: parseJson(a.theme),
  });
});

// Every value in a theme must be a plain 6-digit hex color. These get
// interpolated as CSS custom properties on a public, unauthenticated page
// (the login screen and the application form), so an unvalidated string is
// a stylesheet-injection vector — reject anything that isn't exactly this
// shape rather than trying to sanitize it.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// ---------------------------------------------------------------------------
// Public-endpoint guards
// ---------------------------------------------------------------------------
// A Worker holds no state between requests, so the counter lives in D1. This
// is a floor, not a wall: it stops one script hammering an endpoint. It does
// not stop a distributed flood — put Cloudflare's own rate limiting rules and
// a CAPTCHA in front of these paths too before linking them publicly.
async function rateLimit(env, kind, key, { limit, windowMinutes }) {
  const now = new Date();
  const slot = Math.floor(now.getTime() / (windowMinutes * 60_000));
  const bucket = `${kind}:${key}`;
  const window = String(slot);
  try {
    await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, window, hits) VALUES (?, ?, 1)
       ON CONFLICT (bucket, window) DO UPDATE SET hits = hits + 1`
    ).bind(bucket, window).run();
    const row = await env.DB.prepare(
      `SELECT hits FROM rate_limits WHERE bucket = ? AND window = ?`
    ).bind(bucket, window).first();
    return { ok: (row?.hits ?? 0) <= limit, hits: row?.hits ?? 0 };
  } catch (err) {
    // A missing table (migration not yet applied) must not take the endpoint
    // down — fail open and say so in the log rather than 500 on every signup.
    console.error("[rateLimit] unavailable, allowing request:", err?.message || err);
    return { ok: true, hits: 0 };
  }
}

const clientIp = (c) =>
  c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";

// Subdomains become hostnames, so the rules are stricter than a slug: no
// leading/trailing dash, no double dash, 3-40 chars. The reserved list covers
// the hostnames the product itself uses plus the usual impersonation risks.
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED_SUBDOMAINS = new Set([
  "app", "www", "admin", "api", "platform", "dashboard", "portal", "status",
  "mail", "smtp", "ftp", "cdn", "assets", "static", "help", "support",
  "docs", "blog", "billing", "account", "accounts", "login", "signup",
  "subsub", "test", "staging", "dev", "demo",
]);
function validSubdomain(sub) {
  const s = String(sub || "").trim().toLowerCase();
  if (!SUBDOMAIN_RE.test(s)) return null;
  if (s.includes("--")) return null;
  if (RESERVED_SUBDOMAINS.has(s)) return null;
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Ten digits, stored the way the forms display them, so the database doesn't
// end up holding four spellings of the same number and no way to match them.
// A leading US country code is dropped rather than rejected, because numbers
// pasted out of a contact card usually carry one. Returns null for anything
// that isn't ten digits -- callers decide whether that's empty or invalid.
const normalizePhone = (v) => {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6)}`;
};

// Create the auth user with Supabase's own signup endpoint. The anon key is
// the public one and this is exactly what it is for, so no service_role key
// is needed anywhere in this codebase.
// `redirectTo` is where the confirmation link brings them back to. Without
// it Supabase uses the project's Site URL -- the shared address -- so a
// tenant who set a password on their building's branded page confirmed it
// on a page that had never heard of their building. It has to be on the
// project's redirect allow-list (https://*.subsub.work/**) or Supabase
// quietly falls back to the Site URL again.
async function supabaseSignUp(env, email, password, { redirectTo } = {}) {
  let res, body;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password, ...(redirectTo ? { email_redirect_to: redirectTo } : {}) }),
    });
    body = await res.json();
  } catch (err) {
    return { ok: false, error: "auth_unreachable", detail: String(err?.message || err) };
  }
  if (!res.ok) {
    const msg = String(body?.msg || body?.error_description || body?.error || "");
    if (/already registered|already been registered|User already/i.test(msg)) {
      return { ok: false, error: "email_in_use" };
    }
    if (/password/i.test(msg)) return { ok: false, error: "weak_password", detail: msg };
    // Confirmation is on but the mail could not go out, so Supabase refuses
    // the whole signup. Worth its own code: it is a configuration fault on
    // our side, not anything the person filling in the form can fix, and it
    // is the single most likely way a correctly filled form still fails.
    if (/sending confirmation|error sending|smtp|mail/i.test(msg)) {
      return { ok: false, error: "auth_email_failed", detail: msg };
    }
    return { ok: false, error: "auth_failed", detail: msg };
  }
  // A project with email confirmation on returns a user but no session.
  // Only whether one exists is reported: the tokens themselves are
  // deliberately not passed on. Signup does not sign anyone in -- see the
  // note on needsConfirmation below.
  //
  // `existed` is Supabase's enumeration protection showing through: with
  // confirmation on, signing up an address that is already registered
  // answers 200 with a user object whose id is fabricated and whose
  // identities list is empty, rather than admitting the address is taken.
  // Storing that id would overwrite a real auth_id with one that matches
  // nobody, so it has to be detected rather than trusted.
  const user = body?.user || body;
  const existed = Array.isArray(user?.identities) && user.identities.length === 0;
  return {
    ok: true, existed,
    authId: existed ? null : (user?.id || null),
    session: !!body?.access_token,
  };
}

// A password nobody will ever use or see. It exists because Supabase needs
// one to create an account, and the person it belongs to will set their own
// from the reset link that follows.
function throwawayPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "Aa1!" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Make sure this address exists in Supabase, creating it if it does not.
//
// Staff can create an account or add a colleague from the console, and both
// wrote a users row with auth_id left null and no Supabase account behind it.
// "Send reset link" then called /auth/v1/recover, which answers 200 for an
// address it has never seen -- deliberately, so the endpoint cannot be used
// to discover who has an account. The console reported a reset sent, no mail
// was ever going to arrive, and the person could never sign in.
//
// Creating it here is the anon-key signup the public form already uses, so
// no new secret and no extra privilege. Already-registered is the expected
// answer, not a failure: it means there was nothing to do.
async function ensureAuthUser(env, email) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { ok: false, error: "auth_not_configured" };
  const signed = await supabaseSignUp(env, email, throwawayPassword());
  // `existed` and `email_in_use` are the same answer wearing two faces --
  // whether Supabase admits the address is taken depends on its enumeration
  // setting. Both mean there was nothing to do.
  if (signed.ok) return { ok: true, created: !signed.existed, authId: signed.authId };
  if (signed.error === "email_in_use") return { ok: true, created: false, authId: null };
  return { ok: false, error: signed.error, detail: signed.detail };
}

// ---------------------------------------------------------------------------
// Branded hostnames
// ---------------------------------------------------------------------------

// Bring an account's hostname into line with its plan, and write down what
// happened. Never throws: every caller is a request somebody is waiting on --
// a signup, a payment, a plan change -- and none of them should fail because
// Cloudflare's API was slow. What it cannot finish now, the nightly sweep
// finishes later.
async function syncHostname(env, account, { reason } = {}) {
  const sub = account?.subdomain;
  if (!sub) return null;
  if (!hostnameConfig(env)) return null;      // not wired up; nothing to record

  const wanted = account.plan === "scale";
  try {
    const res = wanted
      ? await provisionHostname(env, sub)
      : await deprovisionHostname(env, sub);
    await env.DB.prepare(
      `UPDATE accounts SET hostname_status = ?, hostname_error = ?, hostname_checked_at = ? WHERE id = ?`
    ).bind(res.status, res.error || null, new Date().toISOString(), account.id).run();
    if (res.status === "failed") {
      console.error("[hostname]", reason || "sync", sub, res.error);
    }
    return res;
  } catch (err) {
    // A thrown error here is a bug in this code, not a Cloudflare refusal,
    // but the account still should not be left claiming an address it has
    // not got.
    console.error("[hostname] threw:", sub, err?.stack || err?.message || err);
    try {
      await env.DB.prepare(
        `UPDATE accounts SET hostname_status = 'failed', hostname_error = ?, hostname_checked_at = ? WHERE id = ?`
      ).bind(String(err?.message || err).slice(0, 300), new Date().toISOString(), account.id).run();
    } catch { /* the log above is the record */ }
    return { ok: false, status: "failed", error: String(err?.message || err) };
  }
}

// Fire and forget, without losing the work when the response returns. A
// Worker stops executing the moment it replies unless the platform is told
// to wait, so this is not decoration.
function syncHostnameAfter(c, account, opts) {
  const run = syncHostname(c.env, account, opts);
  try { c.executionCtx.waitUntil(run); } catch { /* no ctx in tests; it still runs */ }
  return run;
}

// Changing an address is two operations, and the order matters. The old
// hostname comes down first: leaving it up means a name the account has given
// up still answers for them, and whoever claims it next cannot have it. Taking
// it down is best-effort -- a Cloudflare refusal there must not stop the new
// address being set up, because the account is already on the new name in the
// database and an account with no address at all is the worse outcome.
async function moveHostnameAfter(c, account, from) {
  const run = (async () => {
    if (!hostnameConfig(c.env)) return null;
    if (from && from !== account.subdomain) {
      try {
        const gone = await deprovisionHostname(c.env, from);
        if (!gone.ok) console.error("[hostname] could not take down", from, gone.error);
      } catch (err) {
        console.error("[hostname] take-down threw:", from, err?.message || err);
      }
    }
    return syncHostname(c.env, account, { reason: "subdomain_changed" });
  })();
  try { c.executionCtx.waitUntil(run); } catch { /* no ctx in tests; it still runs */ }
  return run;
}

const ACCOUNT_KINDS = ["general_contractor", "property_manager", "building_owner", "portfolio_manager"];
// The kinds that keep a building list, and so are the only ones with anything
// for a tenant or a building owner to be attached to.
const ACCOUNT_KINDS_WITH_PROPERTIES = ["property_manager", "building_owner", "portfolio_manager"];

// The trade categories an account can hire out -- the same thirty ids the app
// renders from. Kept here too because the browser's copy is a convenience and
// this is the one that decides what is storable: an id the app cannot render
// is worse stored than rejected.
const TRADE_IDS = new Set([
  "roofing", "siding", "windows_doors", "gutters", "soffit_fascia", "coping", "masonry", "solar",
  "framing", "concrete", "foundation", "excavation", "demolition",
  "electrical", "plumbing", "hvac", "insulation",
  "drywall", "painting", "flooring", "tile_stone", "cabinets_counters", "trim_carpentry",
  "deck_fence", "hardscaping", "landscaping",
  "garage_doors", "restoration", "cleaning",
]);

// Returns the cleaned list, or null if anything in it is not a trade we know.
// Order is not meaningful, but duplicates are dropped so the stored value is
// the set it is meant to be.
function validTrades(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const raw of v) {
    const id = String(raw ?? "").trim();
    if (!TRADE_IDS.has(id)) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function validTheme(theme) {
  if (!theme || typeof theme !== "object") return null;
  const out = {};
  for (const k of ["bg", "surface", "text", "accent", "btnText"]) {
    if (typeof theme[k] !== "string" || !HEX_COLOR.test(theme[k])) return null;
    out[k] = theme[k];
  }
  return out;
}

// One's own notification choices. Any signed-in person, their own row only:
// there is nothing here about anybody else.
app.patch("/api/me", async (c) => {
  const { userId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  const n = b.notify || {};
  const notify = {
    email: !!n.email, sms: !!n.sms,
    statusChanges: n.statusChanges === undefined ? true : !!n.statusChanges,
  };
  try {
    await c.env.DB.prepare(`UPDATE users SET notify = ? WHERE id = ?`)
      .bind(JSON.stringify(notify), userId).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (migration) return c.json({ error: "migration_needed", migration }, 503);
    throw err;
  }
  return c.json({ ok: true, notify });
});

// Branding/plan/billing for the current account.
app.patch("/api/account", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json(); // { name, subdomain, kind, plan, billing, logoKey, useDefaultMark, theme, trades }
  const sets = [], vals = [];
  if (b.name != null) { sets.push("name = ?"); vals.push(b.name); }

  // Moving to a different address. Held separately from the other fields
  // because it is the only one that changes something outside this database:
  // a hostname at Cloudflare, which has to be taken down at the old name and
  // put up at the new one once the row is written.
  let movedFrom = null, current = null;
  if (b.subdomain != null) {
    current = await c.env.DB.prepare(
      `SELECT subdomain, plan FROM accounts WHERE id = ?`).bind(accountId).first();
    const next = validSubdomain(b.subdomain);
    if (!next) return c.json({ error: "invalid_subdomain" }, 400);
    if (current && next !== current.subdomain) {
      const taken = await c.env.DB.prepare(
        `SELECT id FROM accounts WHERE subdomain = ? AND id <> ?`).bind(next, accountId).first();
      if (taken) return c.json({ error: "subdomain_taken" }, 409);
      sets.push("subdomain = ?"); vals.push(next);
      // The old address is no longer theirs and the new one is not live yet.
      // Carrying "active" across the gap would have the account page telling
      // somebody their address works while it points at nothing.
      sets.push("hostname_status = ?"); vals.push(null);
      sets.push("hostname_error = ?"); vals.push(null);
      movedFrom = current.subdomain;
    }
  }
  if (b.kind != null) {
    if (!ACCOUNT_KINDS.includes(b.kind)) return c.json({ error: "invalid_kind" }, 400);
    sets.push("kind = ?"); vals.push(b.kind);
  }
  if (b.plan != null) { sets.push("plan = ?"); vals.push(b.plan); }
  if (b.billing != null) { sets.push("billing = ?"); vals.push(b.billing); }
  if (b.logoKey !== undefined) { sets.push("logo_key = ?"); vals.push(b.logoKey); }
  if (b.useDefaultMark != null) { sets.push("use_default_mark = ?"); vals.push(b.useDefaultMark ? 1 : 0); }
  if (b.theme !== undefined) {
    const theme = validTheme(b.theme);
    if (b.theme != null && !theme) return c.json({ error: "invalid_theme" }, 400);
    sets.push("theme = ?"); vals.push(theme ? JSON.stringify(theme) : null);
  }
  if (b.trades !== undefined) {
    const trades = validTrades(b.trades);
    if (!trades) return c.json({ error: "invalid_trades" }, 400);
    sets.push("trades = ?"); vals.push(JSON.stringify(trades));
  }
  // Who takes an emergency call-out. Checked rather than stored as given:
  // this is the one setting that lets a tenant's tap commit the account to
  // a contractor, so it has to name somebody the account actually works
  // with. Clearing it turns automatic dispatch off, which is the default.
  if (b.emergencyCompanyId !== undefined) {
    const want = b.emergencyCompanyId || null;
    if (want) {
      const eng = await c.env.DB.prepare(
        `SELECT id, status FROM engagements WHERE account_id = ? AND company_id = ?`)
        .bind(accountId, want).first();
      if (!eng || eng.status === "ended") return c.json({ error: "not_engaged" }, 400);
    }
    sets.push("emergency_company_id = ?"); vals.push(want);
  }
  if (sets.length) {
    vals.push(accountId);
    try {
      await c.env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
    } catch (err) {
      // Two accounts claiming one address race past the check above and are
      // caught here by the unique index instead. Same answer either way.
      if (movedFrom && /UNIQUE|constraint/i.test(String(err?.message || err))) {
        return c.json({ error: "subdomain_taken" }, 409);
      }
      throw err;
    }
  }

  const after = await c.env.DB.prepare(
    `SELECT subdomain, hostname_status FROM accounts WHERE id = ?`).bind(accountId).first();
  if (movedFrom) {
    await logActivity(c.env, accountId, c.get("auth").userId, "subdomain_changed",
      `Sign-in address changed from ${movedFrom}.subsub.work to ${after?.subdomain}.subsub.work`,
      { from: movedFrom, to: after?.subdomain });
    moveHostnameAfter(c, { id: accountId, subdomain: after?.subdomain, plan: current?.plan }, movedFrom);
  }
  // The saved address goes back, not the one that was asked for: the browser
  // should show what the database holds, so a rejected or tidied-up value
  // cannot sit on screen looking saved.
  return c.json({ ok: true, subdomain: after?.subdomain || null,
                  hostnameStatus: after?.hostname_status || null });
});

// ---------------------------------------------------------------------------
// Companies + engagements (the "subs" the UI works with)
// ---------------------------------------------------------------------------

// List every company engaged with the current account, composed flat.
app.get("/api/subs", async (c) => {
  const auth = c.get("auth");
  const { accountId } = auth;
  // An owner has no contractor directory -- they see who is coming to their
  // own buildings and nobody else. A scoped property manager is the opposite
  // case: they have to pick somebody, so they get the whole roster even though
  // their buildings are limited.
  const onlyMine = auth.role === "owner" ? `
       AND en.company_id IN (
         SELECT wo.company_id FROM work_orders wo JOIN jobs j ON j.id = wo.job_id
          WHERE j.account_id = ? AND wo.voided_at IS NULL
            AND j.property_id IN (${auth.propertyIds.map(() => "?").join(",") || "NULL"}))` : "";
  const scopeVals = auth.role === "owner" ? [accountId, ...auth.propertyIds] : [];
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, en.id as en_id, en.account_id as en_account_id, en.company_id as en_company_id,
            en.status as en_status, en.doc_review as en_doc_review, en.categories as en_categories,
            en.caps as en_caps, en.rating as en_rating, en.rated_jobs as en_rated_jobs,
            en.accepted as en_accepted, en.declined as en_declined,
            en.auto_schedule as en_auto_schedule, en.notes as en_notes,
            (SELECT group_concat(ep.property_id) FROM engagement_properties ep
              WHERE ep.engagement_id = en.id) as en_property_ids
     FROM engagements en JOIN companies co ON co.id = en.company_id
     WHERE en.account_id = ? ${onlyMine}`
  ).bind(accountId, ...scopeVals).all();

  const subs = results.map((r) => composeSub(r, {
    id: r.en_id, account_id: r.en_account_id, company_id: r.en_company_id, status: r.en_status,
    doc_review: r.en_doc_review, categories: r.en_categories, caps: r.en_caps,
    rating: r.en_rating, rated_jobs: r.en_rated_jobs, accepted: r.en_accepted, declined: r.en_declined,
    auto_schedule: r.en_auto_schedule, notes: r.en_notes,
    property_ids: r.en_property_ids,
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
    company = await c.env.DB.prepare(`SELECT * FROM companies WHERE lower(email) = lower(?)`).bind(body.email).first();
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

  // Only for a genuinely NEW company: crews, coverage, doc flags, etc. from
  // the invite form. An EXISTING (deduped) company keeps its established
  // profile — categories/caps above are the only things that are ever
  // this account's own to set on someone else's shared company record.
  if (!company) {
    await applySubPatch(c.env.DB, companyId, engagementId, body);
  }

  await logEvent(c.env, accountId, userId, "engagement.invited", engagementId, { companyId, reused: !!company });
  await logActivity(c.env, accountId, userId, "sub_added",
    `Added ${await companyName(c.env.DB, companyId)}`);
  return c.json({ companyId, engagementId, reused: !!company }, 201);
});

// Routes a flat patch to companies/engagements exactly like splitPatch() on
// the client, and writes both halves. Shared by PATCH /api/subs/:companyId
// (editing an existing sub) and POST /api/subs (a new sub's initial fields —
// crews, coverage, doc flags, categories — beyond just its identity).
const SUB_COMPANY_COL = {
  company: "company", contact: "contact", phone: "phone", email: "email",
  license: "license", ubi: "ubi", city: "city", state: "state", zip: "zip",
  mailStreet: "mail_street", mailCity: "mail_city", mailState: "mail_state", mailZip: "mail_zip",
  crews: "crews", coverage: "coverage", available: "available",
  unavailableDays: "unavailable_days", warranty: "warranty",
  insurance: "insurance", bond: "bond", contract: "contract", w9: "w9",
  docFiles: "doc_files", notify: "notify",
};
const SUB_COMPANY_JSON_FIELDS = new Set(["crews", "coverage", "unavailableDays", "warranty", "docFiles", "notify"]);
const SUB_ENGAGEMENT_COL = {
  docReview: "doc_review", categories: "categories", caps: "caps",
  rating: "rating", ratedJobs: "rated_jobs", accepted: "accepted", declined: "declined",
  autoSchedule: "auto_schedule", notes: "notes", status: "status",
};
const SUB_ENGAGEMENT_JSON_FIELDS = new Set(["docReview", "categories", "caps"]);

async function applySubPatch(db, companyId, engagementId, patch) {
  const coPatch = {}, enPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    (ENGAGEMENT_FIELDS.has(k) ? enPatch : coPatch)[k] = v;
  }

  const coSets = [], coVals = [];
  for (const [k, v] of Object.entries(coPatch)) {
    if (!SUB_COMPANY_COL[k]) continue;
    coSets.push(`${SUB_COMPANY_COL[k]} = ?`);
    coVals.push(SUB_COMPANY_JSON_FIELDS.has(k) ? JSON.stringify(v) : (typeof v === "boolean" ? (v ? 1 : 0) : v));
  }
  if (coSets.length) {
    coVals.push(companyId);
    await db.prepare(`UPDATE companies SET ${coSets.join(", ")} WHERE id = ?`).bind(...coVals).run();
  }

  const enSets = [], enVals = [];
  for (const [k, v] of Object.entries(enPatch)) {
    if (!SUB_ENGAGEMENT_COL[k]) continue;
    enSets.push(`${SUB_ENGAGEMENT_COL[k]} = ?`);
    enVals.push(SUB_ENGAGEMENT_JSON_FIELDS.has(k) ? JSON.stringify(v) : (typeof v === "boolean" ? (v ? 1 : 0) : v));
  }
  if (enSets.length) {
    enVals.push(engagementId);
    await db.prepare(`UPDATE engagements SET ${enSets.join(", ")} WHERE id = ?`).bind(...enVals).run();
  }
}

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

  await applySubPatch(c.env.DB, companyId, engagement.id, patch);

  await logEvent(c.env, accountId, userId, "sub.updated", companyId, { fields: Object.keys(patch) });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// License verification. WA (L&I, data.wa.gov) was the original, hand-built
// integration and its field names come from confirmed dataset knowledge.
// The other six states below (STATE_LICENSING_APIS.md's "Tier 1") are new:
// their dataset IDs and field names are best-effort, from search results,
// NOT a live schema check — this sandbox's network policy blocks
// *.state-domains the same way it blocks data.wa.gov, so none of this has
// been exercised against a live response. Every result carries
// `fieldMappingVerified` so callers (and the UI) can tell confirmed WA
// parsing apart from best-effort parsing elsewhere, and the full raw
// response is always stored — if a field name below is wrong, the raw
// data is still there to fix it from, not lost.
//
// Coverage caveats worth knowing before trusting a result, from the
// survey doc: CT/IA have no insurance or bond fields at all (registration-
// only); IL's dataset only covers roofing (Illinois has no general
// contractor license); TX's TDLR dataset has NO general-contractor
// license at all (only trades like electrical/HVAC); DC's is a general
// business-license registry, not a dedicated contractor board.
// ---------------------------------------------------------------------------

const SOCRATA_STATES = {
  WA: {
    base: "https://data.wa.gov/resource", licenseField: "contractorlicensenumber",
    datasets: { general: "m8qx-ubtq", insurance: "ciwg-agsx", bond: "bzff-4fmt" },
    fieldMappingVerified: true,
    map: (lic, insuranceRows, bondRows) => {
      const today = new Date().toISOString().slice(0, 10);
      const current = (rows, endField) =>
        rows.filter((r) => !r.cancel_date && (!r[endField] || r[endField].slice(0, 10) >= today))
          .sort((a, b) => (b.effective_date || "").localeCompare(a.effective_date || ""))[0] || null;
      return {
        businessName: lic.businessname, status: lic.contractorlicensestatus,
        licenseType: lic.contractorlicensetypecodedesc, ubi: lic.ubi,
        effectiveDate: lic.licenseeffectivedate?.slice(0, 10),
        expirationDate: lic.licenseexpirationdate?.slice(0, 10),
        suspendDate: lic.contractorlicensesuspenddate?.slice(0, 10) || null,
        principal: lic.primaryprincipalname,
        insurance: current(insuranceRows, "insurance_expiration_date"),
        bond: current(bondRows, "bond_expiration_date"),
      };
    },
  },
  OR: {
    base: "https://data.oregon.gov/resource", licenseField: "ccb_number",
    datasets: { general: "g77e-6bhs" }, fieldMappingVerified: false,
    // Single dataset reportedly carries bond + insurance inline — no
    // second/third fetch needed if this field mapping holds up.
    map: (lic) => ({
      businessName: lic.business_name || lic.dba_name, status: lic.status,
      licenseType: lic.endorsement || lic.license_type,
      effectiveDate: lic.issue_date?.slice(0, 10), expirationDate: lic.expiration_date?.slice(0, 10),
      suspendDate: null, principal: lic.principal_name,
      insurance: lic.insurance_company ? { insurance_company: lic.insurance_company, coverage_amount: lic.insurance_amount } : null,
      bond: lic.bond_company ? { surety_company: lic.bond_company, bond_amount: lic.bond_amount } : null,
    }),
  },
  CT: {
    base: "https://data.ct.gov/resource", licenseField: "license_number",
    datasets: { general: "5r9m-qgni" }, fieldMappingVerified: false,
    map: (lic) => ({
      businessName: lic.business_name, status: lic.license_status, licenseType: "Home Improvement Contractor",
      effectiveDate: lic.issue_date?.slice(0, 10), expirationDate: lic.expiration_date?.slice(0, 10),
      suspendDate: null, principal: null, insurance: null, bond: null, // CT dataset has no bond/insurance fields
    }),
  },
  IA: {
    base: "https://data.iowa.gov/resource", licenseField: "registration_number",
    datasets: { general: "dpf3-iz94" }, fieldMappingVerified: false,
    map: (lic) => ({
      businessName: lic.business_name, status: "ACTIVE", // dataset is pre-filtered to active-only
      licenseType: lic.primary_activity,
      effectiveDate: lic.issue_date?.slice(0, 10), expirationDate: lic.expire_date?.slice(0, 10),
      suspendDate: null, principal: [lic.first_name, lic.last_name].filter(Boolean).join(" ") || null,
      insurance: null, bond: null, // registration roster only — no bond/insurance in this dataset
    }),
  },
  IL: {
    base: "https://data.illinois.gov/resource", licenseField: "license_number",
    datasets: { general: "pzzh-kp68" }, fieldMappingVerified: false,
    // No statewide GC license in Illinois — this only covers roofing
    // contractors within IDFPR's combined 100+-profession dataset.
    map: (lic) => ({
      businessName: lic.name || lic.business_name, status: lic.license_status,
      licenseType: lic.profession || "Roofing Contractor",
      effectiveDate: lic.original_issue_date?.slice(0, 10), expirationDate: lic.expiration_date?.slice(0, 10),
      suspendDate: null, principal: null, insurance: null, bond: null,
    }),
  },
  TX: {
    base: "https://data.texas.gov/resource", licenseField: "license_number",
    datasets: { general: "7358-krk7" }, fieldMappingVerified: false,
    // Texas has NO general-contractor license — only useful for
    // TDLR-regulated trades (electrical, HVAC, etc).
    map: (lic) => ({
      businessName: lic.business_name || lic.licensee_name, status: lic.license_status,
      licenseType: lic.license_type || lic.endorsement,
      effectiveDate: lic.original_issue_date?.slice(0, 10), expirationDate: lic.expiration_date?.slice(0, 10),
      suspendDate: null, principal: null, insurance: null, bond: null,
    }),
  },
};

// Datasets are public open-data endpoints outside our control — a block
// page, rate-limit response, or outage can come back as non-JSON even on a
// 200. Never let that throw past this function; surface it as a check
// failure instead of a 500.
async function fetchJsonSafe(url) {
  let resp;
  try {
    resp = await fetch(url);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
  const text = await resp.text();
  if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: `non-JSON response: ${text.slice(0, 200)}` };
  }
}

async function verifySocrataState(cfg, licenseNumber) {
  const q = `?${cfg.licenseField}=${encodeURIComponent(licenseNumber)}`;
  const rows = {};
  for (const [key, id] of Object.entries(cfg.datasets)) {
    const res = await fetchJsonSafe(`${cfg.base}/${id}.json${q}`);
    if (!res.ok) return { found: false, status: "CHECK_FAILED", error: res.error, fieldMappingVerified: cfg.fieldMappingVerified };
    rows[key] = res.data;
  }
  const lic = rows.general?.[0];
  if (!lic) return { found: false, fieldMappingVerified: cfg.fieldMappingVerified };
  return { found: true, fieldMappingVerified: cfg.fieldMappingVerified, raw: lic, ...cfg.map(lic, rows.insurance || [], rows.bond || []) };
}

// DC: ArcGIS Feature Service, not Socrata — different query shape entirely.
async function verifyDC(licenseNumber) {
  const url = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0/query"
    + `?where=${encodeURIComponent(`LICENSENUMBER='${licenseNumber.replace(/'/g, "''")}'`)}`
    + "&outFields=*&f=json";
  const res = await fetchJsonSafe(url);
  if (!res.ok) return { found: false, status: "CHECK_FAILED", error: res.error, fieldMappingVerified: false };
  const attrs = res.data?.features?.[0]?.attributes;
  if (!attrs) return { found: false, fieldMappingVerified: false };
  const esriDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
  return {
    found: true, fieldMappingVerified: false, raw: attrs,
    businessName: attrs.BUSINESSNAME || attrs.LICENSEE, status: attrs.LICENSESTATUS,
    licenseType: attrs.LICENSECATEGORY || attrs.LICENSETYPE,
    effectiveDate: esriDate(attrs.ISSUEDATE), expirationDate: esriDate(attrs.EXPIRATIONDATE),
    suspendDate: null, principal: null, insurance: null, bond: null,
  };
}

async function verifyLicenseForState(state, licenseNumber) {
  const code = (state || "").trim().toUpperCase();
  if (code === "DC") return verifyDC(licenseNumber);
  const cfg = SOCRATA_STATES[code];
  if (!cfg) return { found: false, status: "UNSUPPORTED_STATE", supportedStates: [...Object.keys(SOCRATA_STATES), "DC"] };
  return verifySocrataState(cfg, licenseNumber);
}

async function storeLicenseCheck(db, companyId, state, result) {
  await db.prepare(
    `INSERT INTO license_checks
      (company_id, state, status, license_type, effective_date, expiration_date, suspend_date,
       bond_amount_cents, bond_surety, insurance_coverage_cents, insurance_carrier, field_mapping_verified, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    companyId, state, result.status ?? (result.found ? null : "NOT_FOUND"), result.licenseType ?? null,
    result.effectiveDate ?? null, result.expirationDate ?? null, result.suspendDate ?? null,
    result.bond ? Math.round(Number(result.bond.bond_amount || 0) * 100) : null,
    result.bond?.surety_company ?? null,
    result.insurance ? Math.round(Number(result.insurance.coverage_amount || 0) * 100) : null,
    result.insurance?.insurance_company ?? null,
    result.fieldMappingVerified ? 1 : 0,
    JSON.stringify(result)
  ).run();
  await db.prepare(`UPDATE companies SET license_check = ? WHERE id = ?`)
    .bind(JSON.stringify(result), companyId).run();
}

app.post("/api/subs/:companyId/verify-license", requireRole("admin", "pm"), async (c) => {
  const companyId = c.req.param("companyId");
  const company = await c.env.DB.prepare(`SELECT license, state FROM companies WHERE id = ?`).bind(companyId).first();
  if (!company?.license) return c.json({ error: "no_license_on_file" }, 400);
  // Best available proxy for "which state issued this license" — the
  // company's own business-address state. Add a dedicated license_state
  // column later if a company's licensing state can differ from its
  // mailing address in practice.
  const state = (company.state || "WA").trim().toUpperCase();

  const result = await verifyLicenseForState(state, company.license);
  await storeLicenseCheck(c.env.DB, companyId, state, result);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------
// The same shape as a subcontractor invite -- a one-use link with a life --
// but accepted by naming a building rather than a company.

// Tenants arrive at the account's own address, not app.subsub.work: the whole
// point is that the letter or noticeboard says their building's name. Falls
// back to the generic address for an account with no branded hostname yet.
const accountOrigin = (account) =>
  account?.hostname_status === "active" && account?.subdomain
    ? `https://${account.subdomain}.subsub.work`
    : "https://app.subsub.work";
const tenantInviteUrl = (account, token) => `${accountOrigin(account)}/?tenant=${token}`;

const tenantInviteRowToJs = (r, account, propertyName) => ({
  id: r.id, label: r.label, propertyId: r.property_id, propertyName: propertyName || null,
  createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at,
  revokedAt: r.revoked_at, userId: r.user_id,
  url: tenantInviteUrl(account, r.token),
  status: r.revoked_at ? "revoked"
    : r.used_at ? "accepted"
    : new Date(r.expires_at) < new Date() ? "expired"
    : "open",
});

async function lookupTenantInvite(env, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return { error: "invalid" };
  const row = await env.DB.prepare(`SELECT * FROM tenant_invites WHERE token = ?`).bind(token).first();
  if (!row) return { error: "invalid" };
  if (row.revoked_at) return { error: "revoked" };
  if (row.used_at) return { error: "used" };
  if (new Date(row.expires_at) < new Date()) return { error: "expired" };
  const account = await env.DB.prepare(
    `SELECT id, name, subdomain, theme, logo_key, use_default_mark, kind, hostname_status
       FROM accounts WHERE id = ?`).bind(row.account_id).first();
  if (!account) return { error: "invalid" };
  return { invite: row, account };
}

// Adding a tenant is not handing somebody a link. A managing agent with three
// hundred apartments is never going to paste three hundred links, and the
// person who has to be chased for it is the busiest one in the building. They
// type in who lives where -- or upload the list they already have -- and
// SubSub does the sending.
//
// Everything about one tenant that the account has to know, plus whether the
// invite got out and how.
const tenantRowToJs = (r) => ({
  userId: r.user_id, name: r.name, email: r.email, phone: r.phone,
  unit: r.unit, propertyId: r.property_id, propertyName: r.property_name || null,
  addedAt: r.created_at,
  // "invited" until they set a password; after that the seat is theirs.
  status: r.used_at ? "active" : "invited",
  invitedAt: r.invite_created_at || null,
  lastSentAt: r.last_sent_at || null,
});

// The roster. Scoped like everything else -- a manager assigned to two
// buildings sees the tenants of those two.
app.get("/api/tenants", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const scope = scopeClause(auth, "mp.property_id");
  try {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS user_id, u.name, u.email, u.phone,
            m.unit, m.created_at,
            mp.property_id, p.name AS property_name,
            ti.first_created AS invite_created_at, ti.used_at, ti.last_sent_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN membership_properties mp ON mp.membership_id = m.id
       LEFT JOIN properties p ON p.id = mp.property_id
       -- Rolled up, not joined row for row: resending mints a fresh invite
       -- and revokes the old one, so a tenant who has been chased twice has
       -- three rows here and would otherwise appear three times, each with a
       -- different idea of whether they had signed in.
       LEFT JOIN (
         SELECT user_id, account_id,
                MAX(used_at)    AS used_at,
                MAX(sent_at)    AS last_sent_at,
                MIN(created_at) AS first_created
           FROM tenant_invites GROUP BY user_id, account_id
       ) ti ON ti.user_id = u.id AND ti.account_id = m.account_id
      WHERE m.account_id = ? AND m.role = 'tenant' ${scope.sql}
      ORDER BY p.name, m.unit, u.name`
  ).bind(auth.accountId, ...scope.vals).all();
  return c.json((results || []).map(tenantRowToJs));
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    console.error("[tenants] schema not migrated:", err?.message || err);
    return c.json({ error: "migration_needed", migration }, 503);
  }
});

// One tenant, created and invited in a single step. Returns what happened to
// the sending as well as the creating, because "added but not told" is a
// state somebody has to be able to see and fix.
async function createTenant(c, auth, row, account) {
  const first = String(row.firstName || "").trim().slice(0, 60);
  const last = String(row.lastName || "").trim().slice(0, 60);
  const name = [first, last].filter(Boolean).join(" ");
  const email = String(row.email || "").trim().toLowerCase();
  const phoneRaw = String(row.phone || "").trim();
  // Stored the way every other number here is stored; toE164 turns it into
  // what Twilio wants at the moment of sending, and refusing early means a
  // spreadsheet row with a bad number is reported as bad rather than
  // silently never texted.
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const textable = phoneRaw ? toE164(phoneRaw) : null;
  const unit = String(row.unit || "").trim().slice(0, 60) || null;
  const propertyId = row.propertyId || null;

  if (!name) return { ok: false, error: "name_required" };
  // One of the two, not both: a tenant with a phone and no email is ordinary,
  // and so is the reverse. With neither there is no way to tell them.
  if (!email && !phone) return { ok: false, error: "contact_required" };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "bad_email" };
  if (phoneRaw && (!phone || !textable)) return { ok: false, error: "bad_phone" };
  if (!propertyId) return { ok: false, error: "property_required" };
  if (!maySeeProperty(auth, propertyId)) return { ok: false, error: "forbidden" };

  const property = await c.env.DB.prepare(
    `SELECT id, name FROM properties WHERE id = ? AND account_id = ?`
  ).bind(propertyId, auth.accountId).first();
  if (!property) return { ok: false, error: "property_not_found" };

  // Two people in one apartment is normal -- a couple, roommates, a business
  // and its owner -- so the unit is a label, never a key. The email is the
  // key, because that is what a login is.
  let user = email
    ? await c.env.DB.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).bind(email).first()
    : null;
  const userId = user?.id ?? uid();
  if (!user) {
    await c.env.DB.prepare(`INSERT INTO users (id, name, email, phone) VALUES (?, ?, ?, ?)`)
      .bind(userId, name, email || `${userId}@no-email.invalid`, phone).run();
  } else {
    await c.env.DB.prepare(`UPDATE users SET phone = COALESCE(?, phone) WHERE id = ?`)
      .bind(phone, userId).run();
  }

  const seat = await c.env.DB.prepare(
    `SELECT id, role FROM memberships WHERE user_id = ? AND account_id = ?`
  ).bind(userId, auth.accountId).first();
  if (seat && seat.role !== "tenant") return { ok: false, error: "already_a_member" };

  const membershipId = seat?.id ?? uid();
  if (seat) {
    await c.env.DB.prepare(`UPDATE memberships SET unit = COALESCE(?, unit) WHERE id = ?`)
      .bind(unit, membershipId).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO memberships (id, user_id, account_id, role, unit) VALUES (?, ?, ?, 'tenant', ?)`
    ).bind(membershipId, userId, auth.accountId, unit).run();
  }
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO membership_properties (membership_id, property_id) VALUES (?, ?)`
  ).bind(membershipId, propertyId).run();

  const sent = await issueTenantInvite(c, auth, {
    userId, name, first, email, phone, unit, account, property,
    channels: row.channels,
  });
  return { ok: true, userId, name, email, phone, unit,
    propertyId, propertyName: property.name, sent };
}

// Mint a fresh token for this tenant and send it. Used both when they are
// first added and when somebody presses resend, which is the same act: the
// old link stops working, which is what "resend" should mean.
async function issueTenantInvite(c, auth, t) {
  const token = newInviteToken();
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();
  await c.env.DB.prepare(
    `UPDATE tenant_invites SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND account_id = ? AND used_at IS NULL AND revoked_at IS NULL`
  ).bind(t.userId, auth.accountId).run();
  const inviteId = uid();
  await c.env.DB.prepare(
    `INSERT INTO tenant_invites (id, account_id, property_id, token, label, created_by, expires_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(inviteId, auth.accountId, t.property.id, token, t.unit, auth.userId, expires, t.userId).run();

  const link = tenantInviteUrl(t.account, token);
  const want = Array.isArray(t.channels) && t.channels.length
    ? t.channels
    : [t.email ? "email" : null, t.phone ? "sms" : null].filter(Boolean);
  const out = { email: null, sms: null };

  if (want.includes("email") && t.email && !t.email.endsWith("@no-email.invalid")) {
    // Whatever the manager edited, if they edited anything. The link is put
    // in here rather than in the draft, because the draft was written before
    // this token existed.
    const mail = t.draft?.message
      ? customInviteEmail({
          subject: t.draft.subject
            || tenantInviteEmail({ firstName: t.first || t.name, account: t.account,
                 propertyName: t.property.name, unit: t.unit, link }).subject,
          text: t.draft.message, link })
      : tenantInviteEmail({
          firstName: t.first || t.name, account: t.account,
          propertyName: t.property.name, unit: t.unit, link,
        });
    const res = await sendEmail(c.env, { to: t.email, subject: mail.subject, text: mail.text, html: mail.html });
    out.email = res.ok ? "sent" : (res.error || "failed");
    await logMail(c.env, { accountId: auth.accountId, to: t.email, kind: "tenant_invite",
      subject: mail.subject, result: res, sentBy: auth.userId });
  }
  if (want.includes("sms") && t.phone) {
    const body = t.draft?.sms
      ? withInviteLink(t.draft.sms, link)
      : tenantInviteSms({ account: t.account, propertyName: t.property.name, unit: t.unit, link });
    const res = await sendSms(c.env, { to: t.phone, body });
    out.sms = res.ok ? "sent" : (res.error || "failed");
    await logSms(c.env, { accountId: auth.accountId, to: t.phone, kind: "tenant_invite",
      result: { ...res, body } });
  }

  // Only counted as sent if something actually went out. An invite recorded
  // as sent that never left is the worst of both worlds: nobody chases it.
  if (out.email === "sent" || out.sms === "sent") {
    await c.env.DB.prepare(`UPDATE tenant_invites SET sent_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(inviteId).run();
  }
  return out;
}

// Which migration a D1 complaint is really about. The message names the
// column or table, so the answer is in the error and only needs reading.
function missingSchema(err) {
  // D1 sometimes carries the real message on the cause rather than the error
  // itself, so both are read.
  const m = [err?.message, err?.cause?.message, err].map((x) => String(x || "")).join(" | ");
  // SQLite has two ways of saying the same thing and they do not share a
  // word: a SELECT or UPDATE against a column that is not there says "no such
  // column: unit", while an INSERT says "table memberships has no column
  // named unit". Matching only the first meant adding a tenant before
  // migration 015 -- an INSERT -- threw a plain 500, and the form said
  // "Could not add them. Try again." instead of naming the migration.
  if (!/no such (table|column)|has no column named/i.test(m)) return null;
  if (/\bnotify\b/i.test(m)) return "018_user_notify";
  if (/\bvisits\b/i.test(m)) return "019_visits";
  if (/withdrawn_(at|note)/i.test(m)) return "020_withdrawn_reports";
  if (/declined_(at|note)/i.test(m)) return "021_declined_requests";
  if (/\bphotos\b|report_detail/i.test(m)) return "022_report_photos";
  if (/\bseverity\b|emergency_company_id/i.test(m)) return "023_emergencies";
  if (/pay_kind|rate_cents|cap_hours/i.test(m)) return "024_hourly_work_orders";
  if (/updated_at/i.test(m)) return "025_job_activity";
  if (/tenant_invites|memberships\.unit|\bunit\b/i.test(m)) {
    return /sent_at/i.test(m) ? "017_tenant_invite_sent" : "015_tenants";
  }
  if (/membership_properties/i.test(m)) return "014_building_owners";
  if (/cancel_at_period_end/i.test(m)) return "013_cancel_at_period_end";
  return "unknown";
}

app.post("/api/tenants", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const account = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(auth.accountId).first();
  if (!ACCOUNT_KINDS_WITH_PROPERTIES.includes(account?.kind || "")) {
    return c.json({ error: "not_a_property_account" }, 400);
  }
  const b = await c.req.json().catch(() => ({}));
  let res;
  try {
    res = await createTenant(c, auth, b, account);
  } catch (err) {
    const migration = missingSchema(err);
    if (migration) {
      console.error("[tenants] schema not migrated:", err?.message || err);
      return c.json({ error: "migration_needed", migration }, 503);
    }
    throw err;
  }
  if (!res.ok) return c.json({ error: res.error }, res.error === "forbidden" ? 403 : 400);
  await logActivity(c.env, auth.accountId, auth.userId, "tenant_added",
    `Added tenant ${res.name}${res.unit ? ` (${res.unit})` : ""} at ${res.propertyName}`);
  return c.json(res, 201);
});

// The same thing, many at a time, for the list a managing agent already has
// in a spreadsheet. The browser parses the file and sends rows in batches, so
// this stays a plain array and nothing here has to understand a file format.
//
// Every row is reported on individually. A bulk import that fails as a unit
// because row 184 has a typo is one somebody gives up on.
app.post("/api/tenants/bulk", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const account = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(auth.accountId).first();
  if (!ACCOUNT_KINDS_WITH_PROPERTIES.includes(account?.kind || "")) {
    return c.json({ error: "not_a_property_account" }, 400);
  }
  const b = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? b.rows : [];
  // A cap, because this runs inside one request and a spreadsheet can hold
  // anything. The browser sends in batches of this size or smaller.
  if (rows.length > 25) return c.json({ error: "too_many", max: 25 }, 400);

  const results = [];
  for (const row of rows) {
    try {
      const res = await createTenant(c, auth, row, account);
      results.push(res.ok
        ? { ok: true, userId: res.userId, name: res.name, unit: res.unit, sent: res.sent }
        : { ok: false, error: res.error });
    } catch (err) {
      console.error("[tenants] bulk row failed:", err);
      results.push({ ok: false, error: "failed" });
    }
  }
  const added = results.filter((r) => r.ok).length;
  if (added) {
    await logActivity(c.env, auth.accountId, auth.userId, "tenants_imported",
      `Imported ${added} tenant${added === 1 ? "" : "s"}`);
  }
  return c.json({ results });
});

// One tenant's seat, by user id, with the property they are attached to and
// whether their invite is still outstanding. Shared by the three routes
// below, all of which have the same two things to check first.
async function tenantSeat(c, auth, userId) {
  const row = await c.env.DB.prepare(
    `SELECT m.id AS membership_id, m.unit, u.id AS user_id, u.name, u.email, u.phone, u.auth_id,
            mp.property_id, p.name AS property_name,
            ti.used_at, ti.open_invites, ti.last_sent_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN membership_properties mp ON mp.membership_id = m.id
       LEFT JOIN properties p ON p.id = mp.property_id
       LEFT JOIN (
         SELECT user_id, account_id, MAX(used_at) AS used_at, MAX(sent_at) AS last_sent_at,
                SUM(CASE WHEN used_at IS NULL AND revoked_at IS NULL THEN 1 ELSE 0 END) AS open_invites
           FROM tenant_invites GROUP BY user_id, account_id
       ) ti ON ti.user_id = u.id AND ti.account_id = m.account_id
      WHERE m.user_id = ? AND m.account_id = ? AND m.role = 'tenant'`
  ).bind(userId, auth.accountId).first();
  if (!row) return { error: "not_found", status: 404 };
  if (!maySeeProperty(auth, row.property_id)) return { error: "forbidden", status: 403 };
  return { row };
}

const realEmail = (e) => e && !String(e).endsWith("@no-email.invalid") ? e : null;

// What is about to be sent, before it is sent -- so somebody can read it,
// change it, or decide not to. The link is a placeholder here: the real one
// does not exist until the moment of sending, because sending mints a fresh
// token and revokes whatever came before.
app.get("/api/tenants/:userId/invite", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const { row, error, status } = await tenantSeat(c, auth, c.req.param("userId"));
  if (error) return c.json({ error }, status);
  const account = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(auth.accountId).first();
  const first = String(row.name || "").split(" ")[0];
  const property = { id: row.property_id, name: row.property_name };
  const mail = tenantInviteEmail({ firstName: first, account,
    propertyName: property.name, unit: row.unit, link: INVITE_LINK_TOKEN });
  return c.json({
    userId: row.user_id, name: row.name, email: realEmail(row.email), phone: row.phone,
    unit: row.unit, propertyId: row.property_id, propertyName: property.name,
    status: row.used_at ? "active" : "invited",
    // Somebody who has already signed in has a login keyed to their address,
    // so it is not ours to change underneath them.
    emailLocked: !!(row.used_at || row.auth_id),
    openInvite: (row.open_invites || 0) > 0,
    lastSentAt: row.last_sent_at || null,
    linkToken: INVITE_LINK_TOKEN,
    draft: {
      subject: mail.subject,
      message: mail.text,
      sms: tenantInviteSms({ account, propertyName: property.name, unit: row.unit, link: INVITE_LINK_TOKEN }),
    },
  });
});

// Correcting the record before chasing it again -- a mistyped address, the
// wrong unit, the wrong building. The commonest reason an invite goes
// nowhere is that it was addressed wrongly, and re-sending it unchanged
// sends it to the same wrong place.
app.patch("/api/tenants/:userId", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const userId = c.req.param("userId");
  const { row, error, status } = await tenantSeat(c, auth, userId);
  if (error) return c.json({ error }, status);
  const b = await c.req.json().catch(() => ({}));

  const first = String(b.firstName ?? "").trim().slice(0, 60);
  const last = String(b.lastName ?? "").trim().slice(0, 60);
  const name = [first, last].filter(Boolean).join(" ") || row.name;
  if (!name) return c.json({ error: "name_required" }, 400);

  const userSets = ["name = ?"], userVals = [name];

  if (b.email !== undefined) {
    const email = String(b.email || "").trim().toLowerCase();
    const current = realEmail(row.email);
    if (email !== (current || "")) {
      // Their sign-in is that address. Moving it would leave them holding a
      // password for an account this one no longer points at.
      if (row.used_at || row.auth_id) return c.json({ error: "email_locked" }, 409);
      if (email) {
        if (!EMAIL_RE.test(email)) return c.json({ error: "bad_email" }, 400);
        const clash = await c.env.DB.prepare(
          `SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?`).bind(email, userId).first();
        if (clash) return c.json({ error: "email_taken" }, 409);
        userSets.push("email = ?"); userVals.push(email);
      } else {
        // Back to no address at all: the placeholder is what the rest of the
        // code reads as "reachable by phone only".
        userSets.push("email = ?"); userVals.push(`${userId}@no-email.invalid`);
      }
    }
  }

  if (b.phone !== undefined) {
    const raw = String(b.phone || "").trim();
    const phone = raw ? normalizePhone(raw) : null;
    if (raw && !phone) return c.json({ error: "bad_phone" }, 400);
    userSets.push("phone = ?"); userVals.push(phone);
  }

  // Neither an address nor a number leaves nobody to tell.
  const nextEmail = b.email !== undefined
    ? realEmail(String(b.email || "").trim().toLowerCase() || null) : realEmail(row.email);
  const nextPhone = b.phone !== undefined
    ? (String(b.phone || "").trim() ? normalizePhone(String(b.phone)) : null) : row.phone;
  if (!nextEmail && !nextPhone) return c.json({ error: "contact_required" }, 400);

  if (b.propertyId !== undefined && b.propertyId !== row.property_id) {
    if (!b.propertyId) return c.json({ error: "property_required" }, 400);
    if (!maySeeProperty(auth, b.propertyId)) return c.json({ error: "forbidden" }, 403);
    const prop = await c.env.DB.prepare(
      `SELECT id FROM properties WHERE id = ? AND account_id = ?`).bind(b.propertyId, auth.accountId).first();
    if (!prop) return c.json({ error: "property_not_found" }, 400);
    await c.env.DB.prepare(`DELETE FROM membership_properties WHERE membership_id = ?`)
      .bind(row.membership_id).run();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO membership_properties (membership_id, property_id) VALUES (?, ?)`
    ).bind(row.membership_id, b.propertyId).run();
  }

  if (b.unit !== undefined) {
    await c.env.DB.prepare(`UPDATE memberships SET unit = ? WHERE id = ?`)
      .bind(String(b.unit || "").trim().slice(0, 60) || null, row.membership_id).run();
  }

  userVals.push(userId);
  try {
    await c.env.DB.prepare(`UPDATE users SET ${userSets.join(", ")} WHERE id = ?`).bind(...userVals).run();
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err?.message || err))) return c.json({ error: "email_taken" }, 409);
    const migration = missingSchema(err);
    if (migration) return c.json({ error: "migration_needed", migration }, 503);
    throw err;
  }

  const after = await tenantSeat(c, auth, userId);
  return c.json({ ok: true, name, unit: after.row?.unit ?? null,
    email: realEmail(after.row?.email), phone: after.row?.phone ?? null,
    propertyId: after.row?.property_id ?? null, propertyName: after.row?.property_name ?? null });
});

// Calling it off without removing the person. Their outstanding link stops
// working; they stay on the roster, so somebody can fix the record and send
// again rather than adding them from scratch.
app.post("/api/tenants/:userId/revoke", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const userId = c.req.param("userId");
  const { row, error, status } = await tenantSeat(c, auth, userId);
  if (error) return c.json({ error }, status);
  if (row.used_at) return c.json({ error: "already_accepted" }, 409);
  const res = await c.env.DB.prepare(
    `UPDATE tenant_invites SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND account_id = ? AND used_at IS NULL AND revoked_at IS NULL`
  ).bind(userId, auth.accountId).run();
  const revoked = res?.meta?.changes ?? 0;
  if (revoked) {
    await logActivity(c.env, auth.accountId, auth.userId, "tenant_invite_revoked",
      `Revoked the invite for ${row.name}`);
  }
  return c.json({ ok: true, revoked });
});

app.post("/api/tenants/:userId/resend", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const userId = c.req.param("userId");
  const b = await c.req.json().catch(() => ({}));
  const { row, error, status } = await tenantSeat(c, auth, userId);
  if (error) return c.json({ error }, status);
  const account = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(auth.accountId).first();

  // Wording the manager changed, if they changed any. Bounded because it is
  // going out over somebody else's mail server and somebody else's phone
  // bill; an SMS beyond this is several messages and several charges.
  const draft = {
    subject: b.subject == null ? null : String(b.subject).trim().slice(0, 200),
    message: b.message == null ? null : String(b.message).slice(0, 4000),
    sms: b.sms == null ? null : String(b.sms).slice(0, 480),
  };
  if (draft.message !== null && !draft.message.trim()) return c.json({ error: "empty_message" }, 400);
  if (draft.message !== null && !draft.subject) return c.json({ error: "empty_subject" }, 400);

  const sent = await issueTenantInvite(c, auth, {
    userId, name: row.name, first: String(row.name || "").split(" ")[0],
    email: row.email, phone: row.phone, unit: row.unit, account,
    property: { id: row.property_id, name: row.property_name },
    channels: b.channels, draft,
  });
  return c.json({ ok: true, sent, edited: !!draft.message });
});

// Removing a tenant drops their seat here, not the person: the same address
// may be a tenant of somebody else's building.
app.delete("/api/tenants/:userId", requireRole("admin", "pm"), async (c) => {
  const auth = c.get("auth");
  const userId = c.req.param("userId");
  const row = await c.env.DB.prepare(
    `SELECT m.id, mp.property_id FROM memberships m
       LEFT JOIN membership_properties mp ON mp.membership_id = m.id
      WHERE m.user_id = ? AND m.account_id = ? AND m.role = 'tenant'`
  ).bind(userId, auth.accountId).first();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!maySeeProperty(auth, row.property_id)) return c.json({ error: "forbidden" }, 403);
  await c.env.DB.prepare(`DELETE FROM memberships WHERE id = ?`).bind(row.id).run();
  await c.env.DB.prepare(
    `UPDATE tenant_invites SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND account_id = ? AND used_at IS NULL AND revoked_at IS NULL`
  ).bind(userId, auth.accountId).run();
  return c.json({ ok: true });
});

// What the branded page shows somebody holding a tenant link, before they
// have any account at all. Public, so it says as little as it can get away
// with: the building's name and the account's branding.
// What the branded page shows somebody holding a tenant link, before they
// have any account at all. Public, so it says as little as it can: their own
// first name, their building, and the branding of whoever set them up.
app.get("/api/tenant-invite/:token", async (c) => {
  const { error, invite, account } = await lookupTenantInvite(c.env, c.req.param("token"));
  if (error) return c.json({ error }, error === "invalid" ? 404 : 410);

  const who = invite.user_id
    ? await c.env.DB.prepare(`SELECT name, email FROM users WHERE id = ?`).bind(invite.user_id).first()
    : null;
  const property = invite.property_id
    ? await c.env.DB.prepare(`SELECT name FROM properties WHERE id = ?`).bind(invite.property_id).first()
    : null;

  // A tenant added by phone alone has a placeholder address on file, which is
  // fine for texting them and no use as a login. Rather than send them a link
  // that turns them away, the page asks for an address at this point -- the
  // one moment they are already here and paying attention.
  const placeholder = !who?.email || String(who.email).endsWith("@no-email.invalid");

  return c.json({
    // A first name only. The link arrived in their inbox or on their phone,
    // so this is recognition rather than disclosure -- and the surname and
    // the full address are not needed to say "this is yours".
    firstName: String(who?.name || "").split(" ")[0] || null,
    needsEmail: placeholder,
    propertyName: property?.name || null,
    unit: invite.label || null,
    account: {
      id: account.id, name: account.name, subdomain: account.subdomain,
      theme: parseJson(account.theme),
      logoKey: account.logo_key, useDefaultMark: !!account.use_default_mark,
      kind: account.kind,
    },
  });
});

// Accepting one. Everything about them is already known -- their building
// manager typed it in, or uploaded it -- so the only thing left is a
// password, which they choose and Supabase stores. No service_role key is
// involved here or anywhere else in this codebase.
app.post("/api/tenant-invite/:token", async (c) => {
  const rl = await rateLimit(c.env, "tenant-invite", clientIp(c), { limit: 20, windowMinutes: 60 });
  if (!rl.ok) return c.json({ error: "rate_limited" }, 429);

  const { error, invite, account } = await lookupTenantInvite(c.env, c.req.param("token"));
  if (error) return c.json({ error }, error === "invalid" ? 404 : 410);
  if (!invite.user_id) return c.json({ error: "invalid" }, 404);

  const b = await c.req.json().catch(() => ({}));
  const password = String(b.password || "");
  if (password.length < 8) return c.json({ error: "weak_password" }, 400);

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(invite.user_id).first();
  if (!user) return c.json({ error: "invalid" }, 404);

  // Added by phone alone: there is no address to sign in with, so they give
  // one now. Taking it here rather than refusing them is the difference
  // between a text that works and a text that wastes somebody's afternoon.
  let email = user.email;
  if (!email || String(email).endsWith("@no-email.invalid")) {
    email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return c.json({ error: "email_required" }, 400);
    const clash = await c.env.DB.prepare(
      `SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?`).bind(email, user.id).first();
    if (clash) return c.json({ error: "email_in_use_here" }, 409);
    await c.env.DB.prepare(`UPDATE users SET email = ? WHERE id = ?`).bind(email, user.id).run();
  }

  const signed = await supabaseSignUp(c.env, email, password, { redirectTo: `${accountOrigin(account)}/` });
  if (!signed.ok && signed.error !== "email_in_use") {
    return c.json({ error: signed.error, detail: signed.detail }, 400);
  }
  // `existed` is Supabase's enumeration protection showing through: an
  // address that is already registered answers 200 with a fabricated id and
  // an empty identities list. Writing that id would point auth_id at nobody.
  const already = signed.error === "email_in_use" || signed.existed;
  if (signed.ok && !signed.existed && signed.authId && !user.auth_id) {
    await c.env.DB.prepare(`UPDATE users SET auth_id = ? WHERE id = ? AND auth_id IS NULL`)
      .bind(signed.authId, user.id).run();
  }

  await c.env.DB.prepare(
    `UPDATE tenant_invites SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(invite.id).run();
  await logActivity(c.env, account.id, null, "tenant_joined",
    `${user.name} set up their login${invite.label ? ` (${invite.label})` : ""}`);

  return c.json({
    ok: true, email,
    // Supabase projects with email confirmation on will not sign them in
    // yet. Saying so is the difference between "check your email" and a
    // person typing a correct password into a screen that keeps refusing it.
    needsConfirmation: signed.ok && !signed.session && !already,
    // Already registered: they have a password from somewhere and the one
    // just typed was not used. Telling them to sign in beats telling them
    // nothing and letting them wonder why it does not work.
    existed: already,
  });
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
app.get("/api/jobs", async (c) => {
  const auth = c.get("auth");
  const { accountId } = auth;
  // An owner sees the jobs at their own buildings and nothing else. A job with
  // no property is account-wide work and is not theirs to see either, which
  // `property_id IN (...)` gives for free -- NULL matches nothing.
  //
  // A tenant is narrower still: their own reports, not the building's work.
  // Sharing a building with somebody is not a reason to see their repairs.
  const scope = scopeClause(auth, "property_id");
  const mine = auth.role === "tenant" ? ` AND requested_by = ? ` : "";
  const binds = [accountId, ...scope.vals, ...(auth.role === "tenant" ? [auth.userId] : [])];
  // `order` is interpolated rather than bound because ORDER BY cannot be a
  // bound parameter. Both callers below pass a literal written here; nothing
  // from a request reaches it, and nothing may be added that does.
  const listJobs = (order) => c.env.DB.prepare(
    `SELECT * FROM jobs WHERE account_id = ? ${scope.sql} ${mine} ORDER BY ${order}`
  ).bind(...binds).all();

  // The order we want needs the column migration 025 adds. The order is a
  // nicety; this list is the entire page. A database still waiting on 025
  // failed the whole query, and the browser -- which treats a failed call
  // here as an empty result, because a refused one really is empty -- drew
  // the account as having no jobs at all. Signing in to an empty company is
  // the worst possible way to be told a migration is pending. So: ask for
  // the good order, and if the column is not there yet, ask again for the
  // plain one.
  let jobs;
  try {
    ({ results: jobs } = await listJobs("COALESCE(updated_at, created_at) DESC, created_at DESC"));
  } catch (err) {
    if (missingSchema(err) !== "025_job_activity") throw err;
    console.warn("[jobs] 025_job_activity not applied - falling back to created_at order");
    ({ results: jobs } = await listJobs("created_at DESC"));
  }

  const { results: wos } = await c.env.DB.prepare(
    `SELECT wo.* FROM work_orders wo JOIN jobs j ON j.id = wo.job_id
     WHERE j.account_id = ? AND wo.voided_at IS NULL`
  ).bind(accountId).all();
  const woByJob = {};
  for (const w of wos) (woByJob[w.job_id] ||= []).push(w);

  return c.json(jobs.map((j) => stripMoney(auth, jobRowToJs(j, woByJob[j.id] || []))));
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

// Mark a job as having just moved.
//
// Called from everywhere that changes a job or anything hanging off it --
// its work orders, its visits -- so that "moved" means what a person means
// by it rather than "the jobs row happened to be written to". Deliberately
// swallows its own failure: a job that could not be timestamped is still a
// job, and losing an assignment because the clock write failed would be a
// far worse trade than a row that sorts a little low.
async function touchJob(env, jobId) {
  if (!jobId) return;
  try {
    // datetime('now'), not a JS ISO string. The column is sorted as text and
    // falls back to created_at, which SQLite writes as "2026-09-22 19:28:16".
    // An ISO value carries a "T" where that has a space, and "T" sorts above
    // every digit -- so one job updated at one in the morning would outrank
    // another created at eleven at night. Same format, or no ordering.
    await env.DB.prepare(`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`)
      .bind(jobId).run();
  } catch (err) {
    if (!missingSchema(err)) throw err;      // a real error is still an error
  }
}

function jobRowToJs(j, workOrders) {
  const assignments = {};
  for (const w of workOrders) {
    assignments[w.trade] = {
      id: w.id, subId: w.company_id, wo: w.wo_number, woIssued: w.issued_at?.slice(0, 10),
      crewName: w.crew_name, tradeScope: w.trade_scope, value: w.value_cents != null ? String(w.value_cents / 100) : "",
      // How it is priced. value stays the ceiling either way, so anything
      // that only cares what this might cost need not know the difference.
      payKind: w.pay_kind || "fixed",
      rate: w.rate_cents != null ? String(w.rate_cents / 100) : "",
      capHours: w.cap_hours != null ? w.cap_hours : null,
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
    // Only what is needed to list and fetch them -- the R2 key stays on the
    // server, so a photo is only ever reachable through the route below,
    // which re-checks who is asking.
    photos: parseJson(j.photos, []).map((p) => ({ id: p.id, name: p.name, type: p.type, size: p.size, at: p.at })),
    // What the tenant actually answered, for showing back and for editing.
    // Null on anything not raised through the tenant's form, and on reports
    // made before this was kept -- the composed scope is all those have.
    reportDetail: parseJson(j.report_detail, null),
    // "911" or "urgent", or null for the great majority. Decided from what
    // they picked -- see shared/emergency.js.
    severity: j.severity || null,
    status: j.status, completedAt: j.completed_at, notes: j.notes, createdAt: j.created_at?.slice(0, 10), assignments,
    // The column has been on jobs since the beginning and was cleared when a
    // property was deleted, but nothing ever wrote it and nothing ever read
    // it back, so a job's building survived only until the page reloaded.
    propertyId: j.property_id || null,
    // Set when a building owner asked for the work. Until approved_at is
    // filled in it is a request, and nothing may be assigned against it.
    requestedBy: j.requested_by || null, approvedAt: j.approved_at || null,
    // Taken back by whoever reported it. Not a status, because the status
    // column has a CHECK on it; a withdrawn job is out of everything live.
    withdrawnAt: j.withdrawn_at || null, withdrawnNote: j.withdrawn_note || null,
    // Turned down by the manager, with the reason they gave. A request that
    // is neither approved nor declined is still waiting on them.
    declinedAt: j.declined_at || null, declinedNote: j.declined_note || null,
    // The full timestamp, for the ten minutes in which a report can still be
    // corrected. createdAt above is the date alone and always was.
    createdAtIso: j.created_at || null,
    // When it last moved, by any route: assigned, replied to, scheduled,
    // corrected, approved. What the list sorts on, and what "just updated"
    // is measured from.
    updatedAtIso: j.updated_at || j.created_at || null,
  };
}

// What a building owner is not shown. They see the work, the schedule and who
// is coming; what the account pays a subcontractor is not theirs. Applied on
// the way out of the API rather than hidden in the page, because a value the
// browser is sent is a value the browser can be made to show.
function stripMoney(auth, job) {
  if (auth.role !== "owner" && auth.role !== "tenant") return job;
  const assignments = {};
  for (const [trade, a] of Object.entries(job.assignments || {})) {
    const { value, ...rest } = a;
    assignments[trade] = rest;
  }
  return { ...job, assignments };
}

// An owner may raise work, which is why this is not requireRole("admin","pm"):
// what they create is a request rather than a job, and the difference is
// enforced below rather than left to the caller to declare.
app.post("/api/jobs", requireRole("admin", "pm", "owner", "tenant"), async (c) => {
  const auth = c.get("auth");
  const { accountId, userId } = auth;
  const b = await c.req.json();
  const id = uid();

  const propertyId = b.propertyId || null;
  // A scoped seat's work has to be at one of their own buildings. Refusing
  // here rather than filtering means work aimed somewhere else is an error
  // they see, not a row that quietly goes missing.
  if (auth.propertyIds) {
    if (!propertyId) return c.json({ error: "property_required" }, 400);
    if (!maySeeProperty(auth, propertyId)) return c.json({ error: "forbidden" }, 403);
  } else if (propertyId) {
    const owned = await c.env.DB.prepare(
      `SELECT id FROM properties WHERE id = ? AND account_id = ?`).bind(propertyId, accountId).first();
    if (!owned) return c.json({ error: "property_not_found" }, 404);
  }

  // Owners and tenants raise requests; a scoped property manager is there to
  // run the work, so what they create is a job like any other manager's.
  const requestedBy = (auth.role === "owner" || auth.role === "tenant") ? userId : null;
  const photos = cleanPhotos(b.photos, accountId);
  // A tenant's report sends its answers; everything else sends a scope it
  // wrote itself. Composing here rather than in the browser means the
  // sentence and the parts cannot disagree, whichever of the two edits it.
  const detail = b.reportDetail ? cleanDetail({ ...b.reportDetail, title: b.title }) : null;
  const scope = detail ? composeScope({ ...detail, title: b.title }) : (b.scope || null);
  // Worked out here from what they picked, never taken from the request.
  // Only a tenant's or owner's report can be an emergency: a manager
  // creating their own job already knows how to prioritise it.
  const severity = requestedBy ? severityOf(detail?.problem) : null;
  try {
    await c.env.DB.prepare(
      `INSERT INTO jobs (id, account_id, title, client, address, area, zip, sqft, stories, date, time,
         trades, scope, material_source, materials_paid_by, measurement_docs, created_by,
         property_id, requested_by, photos, report_detail, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, accountId, b.title, b.client || null, b.address || null, b.area || null, b.zip || null,
      b.sqft || null, b.stories || null, b.date || null, b.time || "07:00",
      JSON.stringify(b.trades || []), scope, b.materialSource || null, b.materialsPaidBy || null,
      JSON.stringify(b.measurementDocs || []), userId, propertyId, requestedBy,
      photos.length ? JSON.stringify(photos) : null, detail ? JSON.stringify(detail) : null,
      severity).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }

  if (requestedBy) {
    await logEvent(c.env, accountId, userId, "job.requested", id, { title: b.title });
    await logActivity(c.env, accountId, userId, "job_requested", `Requested work: ${b.title}`);
  } else {
    await logEvent(c.env, accountId, userId, "job.created", id, { title: b.title });
    await logActivity(c.env, accountId, userId, "job_created", `Created job ${b.title}`);
  }
  // The row as stored, not just its id. What the browser can guess about a
  // job it has just created is not the same as what was written: it has no
  // created_at to the second, so the ten-minute edit window read as already
  // over, and no ids for the photos it just sent, so they could not be
  // fetched back. Both looked like features that did not work.
  // Urgent, and somebody named to take it: send them, now, and say so in
  // the answer so the tenant is told a contractor is already coming rather
  // than being left to wonder. A fire never reaches this -- emergency
  // services are not a subcontractor.
  let emergency = null;
  if (severity === "urgent") {
    emergency = await dispatchEmergency(c, id, accountId);
  }

  const saved = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
  const wos = saved ? (await c.env.DB.prepare(
    `SELECT * FROM work_orders WHERE job_id = ? AND voided_at IS NULL`).bind(id).all()).results : [];
  return c.json({ id, requested: !!requestedBy, severity,
    emergency, job: saved ? jobRowToJs(saved, wos) : null }, 201);
});

// Turning an owner's request into a job somebody can be assigned to. Only the
// account can do this -- that is the entire point of a request.
// Tell the tenant who reported a job that it has moved, if they asked to be
// told. Never throws: a message that could not go out must not undo the
// approval or the assignment that caused it. Owners raise requests too, but
// they have a dashboard for this; a tenant has an inbox.
async function notifyTenant(c, jobId, stage, detail = null) {
  try {
    const job = await c.env.DB.prepare(
      `SELECT id, title, account_id, requested_by, withdrawn_at FROM jobs WHERE id = ?`).bind(jobId).first();
    if (!job?.requested_by || job.withdrawn_at) return;
    const [user, seat, account] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(job.requested_by).first(),
      c.env.DB.prepare(`SELECT role FROM memberships WHERE user_id = ? AND account_id = ?`)
        .bind(job.requested_by, job.account_id).first(),
      c.env.DB.prepare(`SELECT id, name, subdomain, hostname_status FROM accounts WHERE id = ?`)
        .bind(job.account_id).first(),
    ]);
    if (!user || seat?.role !== "tenant") return;
    const prefs = notifyOf(user);
    if (!prefs.statusChanges) return;
    const link = `${accountOrigin(account)}/`;
    const firstName = String(user.name || "").split(" ")[0];
    const email = realEmail(user.email);
    const sentBy = c.get("auth")?.userId ?? null;
    if (prefs.email && email) {
      const m = tenantStatusEmail({ firstName, account, title: job.title, stage, link, detail });
      const result = await sendEmail(c.env, { to: email, subject: m.subject, text: m.text, html: m.html });
      await logMail(c.env, { accountId: job.account_id, to: email, kind: "tenant_status",
        subject: m.subject, result, sentBy });
    }
    if (prefs.sms && user.phone) {
      const body = tenantStatusSms({ account, title: job.title, stage, link, detail });
      const result = await sendSms(c.env, { to: user.phone, body });
      await logSms(c.env, { accountId: job.account_id, to: user.phone, kind: "tenant_status",
        result: { ...result, body } });
    }
  } catch (err) {
    console.error("[tenant-notify] failed:", err?.message || err);
  }
}

app.post("/api/jobs/:id/approve", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const id = c.req.param("id");
  const job = await c.env.DB.prepare(
    `SELECT id, title, requested_by, approved_at, withdrawn_at FROM jobs WHERE id = ? AND account_id = ?`
  ).bind(id, accountId).first();
  if (!job) return c.json({ error: "job_not_found" }, 404);
  if (!job.requested_by) return c.json({ error: "not_a_request" }, 400);
  if (job.withdrawn_at) return c.json({ error: "withdrawn" }, 409);
  if (job.approved_at) return c.json({ ok: true, alreadyApproved: true });

  // Clearing the decline as well: approving one that was turned down is
  // changing your mind about it, and it must not read as both.
  await c.env.DB.prepare(
    `UPDATE jobs SET approved_at = datetime('now'), declined_at = NULL, declined_note = NULL
      WHERE id = ? AND account_id = ?`
  ).bind(id, accountId).run();
  await touchJob(c.env, id);
  await logEvent(c.env, accountId, userId, "job.approved", id, { title: job.title });
  await logActivity(c.env, accountId, userId, "job_approved", `Approved requested work: ${job.title}`);
  await notifyTenant(c, id, "approved");
  return c.json({ ok: true });
});

// Saying no. A request that cannot be said no to sits on the dashboard
// forever and the person who asked is never told, which is worse than a
// refusal. The reason is required: "declined" on its own is what makes
// somebody pick up the phone, and not having to pick up the phone is the
// point of all this.
app.post("/api/jobs/:id/decline", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const note = String(b.note || "").trim().slice(0, 500);
  if (!note) return c.json({ error: "reason_required" }, 400);
  const job = await c.env.DB.prepare(
    `SELECT id, title, requested_by, approved_at, withdrawn_at, declined_at, status
       FROM jobs WHERE id = ? AND account_id = ?`).bind(id, accountId).first();
  if (!job) return c.json({ error: "job_not_found" }, 404);
  if (!job.requested_by) return c.json({ error: "not_a_request" }, 400);
  if (job.withdrawn_at) return c.json({ error: "withdrawn" }, 409);
  if (job.status === "completed") return c.json({ error: "already_completed" }, 409);
  if (job.approved_at) return c.json({ error: "already_approved" }, 409);
  if (job.declined_at) return c.json({ ok: true, alreadyDeclined: true });
  try {
    await c.env.DB.prepare(`UPDATE jobs SET declined_at = ?, declined_note = ? WHERE id = ?`)
      .bind(new Date().toISOString(), note, id).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }
  await logEvent(c.env, accountId, userId, "job.declined", id, { title: job.title, note });
  await logActivity(c.env, accountId, userId, "job_declined", `Didn't approve "${job.title}": ${note}`);
  await touchJob(c.env, id);
  await notifyTenant(c, id, "declined", note);
  return c.json({ ok: true });
});

app.post("/api/jobs/:id/complete", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ? AND account_id = ?`
  ).bind(new Date().toISOString().slice(0, 10), id, accountId).run();
  await logEvent(c.env, accountId, userId, "job.completed", id, {});
  { const j = await c.env.DB.prepare(`SELECT title FROM jobs WHERE id = ?`).bind(id).first();
    await logActivity(c.env, accountId, userId, "job_completed", `Completed ${j?.title || "a job"}`); }
  await touchJob(c.env, id);
  await notifyTenant(c, id, "done");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Visits: the proposed time for a repair, confirmed by the tenant
// ---------------------------------------------------------------------------
//
// A report went from "contractor assigned" to "done" with the person who
// lives there told nothing about when anybody would turn up. The manager or
// the contractor proposes a date and a window; the tenant confirms it or
// says it doesn't work, in the app; only a confirmed visit puts a date on
// the job and reads as "Scheduled" to them. One live visit per job.

const visitRowToJs = (v) => ({
  id: v.id, jobId: v.job_id, date: v.date, startTime: v.start_time || null, endTime: v.end_time || null,
  note: v.note || null, status: v.status, tenantNote: v.tenant_note || null,
  proposedBy: v.proposed_by || null, createdAt: v.created_at, respondedAt: v.responded_at || null,
});
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

app.get("/api/visits", async (c) => {
  const auth = c.get("auth");
  const scope = scopeClause(auth, "j.property_id");
  const mine = auth.role === "tenant" ? " AND j.requested_by = ? " : "";
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT v.* FROM visits v JOIN jobs j ON j.id = v.job_id
        WHERE v.account_id = ? ${scope.sql} ${mine} AND v.status != 'superseded'
        ORDER BY v.created_at DESC`
    ).bind(auth.accountId, ...scope.vals, ...(auth.role === "tenant" ? [auth.userId] : [])).all();
    return c.json((results || []).map(visitRowToJs));
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }
});

// Propose one. The manager, or a contractor who holds a live work order on
// the job -- they are the one who knows when they can come.
app.post("/api/jobs/:id/visits", requireRole("admin", "pm", "contractor"), async (c) => {
  const auth = c.get("auth");
  const jobId = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const job = await c.env.DB.prepare(
    `SELECT id, title, requested_by, approved_at FROM jobs WHERE id = ? AND account_id = ?`
  ).bind(jobId, auth.accountId).first();
  if (!job) return c.json({ error: "job_not_found" }, 404);
  if (job.requested_by && !job.approved_at) return c.json({ error: "not_approved" }, 409);
  if (auth.role === "contractor") {
    const wo = await c.env.DB.prepare(
      `SELECT id FROM work_orders WHERE job_id = ? AND company_id = ? AND voided_at IS NULL`
    ).bind(jobId, auth.companyId).first();
    if (!wo) return c.json({ error: "forbidden" }, 403);
  }
  const date = String(b.date || "").trim();
  const start = b.startTime ? String(b.startTime).trim() : null;
  const end = b.endTime ? String(b.endTime).trim() : null;
  if (!DATE_RE.test(date)) return c.json({ error: "bad_date" }, 400);
  if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end))) return c.json({ error: "bad_time" }, 400);
  if (start && end && end <= start) return c.json({ error: "bad_window" }, 400);
  const note = String(b.note || "").trim().slice(0, 500) || null;

  // Who has to agree. A tenant's repair needs the tenant; anything else has
  // nobody to ask, so the proposal stands.
  const seat = job.requested_by ? await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE user_id = ? AND account_id = ?`).bind(job.requested_by, auth.accountId).first() : null;
  const needsTenant = seat?.role === "tenant";
  const id = uid();
  try {
    await c.env.DB.prepare(
      `UPDATE visits SET status = 'superseded' WHERE job_id = ? AND status IN ('proposed', 'declined')`
    ).bind(jobId).run();
    await c.env.DB.prepare(
      `INSERT INTO visits (id, account_id, job_id, proposed_by, date, start_time, end_time, note, status, responded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, auth.accountId, jobId, auth.userId, date, start, end, note,
      needsTenant ? "proposed" : "confirmed", needsTenant ? null : new Date().toISOString()).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }
  const when = visitWhen({ date, start_time: start, end_time: end });
  if (needsTenant) {
    await logActivity(c.env, auth.accountId, auth.userId, "visit_proposed",
      `Proposed a visit for "${job.title}": ${when}`);
    await notifyTenant(c, jobId, "visit", when);
  } else {
    await c.env.DB.prepare(`UPDATE jobs SET date = ?, time = ? WHERE id = ?`).bind(date, start || "07:00", jobId).run();
    await logActivity(c.env, auth.accountId, auth.userId, "visit_set", `Set a visit for "${job.title}": ${when}`);
  }
  await touchJob(c.env, jobId);
  const row = await c.env.DB.prepare(`SELECT * FROM visits WHERE id = ?`).bind(id).first();
  return c.json(visitRowToJs(row), 201);
});

// The tenant's answer. Only the person who reported it; only while it is
// still open. Confirming puts the date on the job -- that is the moment it
// becomes scheduled, not the moment somebody proposed it.
app.post("/api/visits/:id/respond", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "tenant") return c.json({ error: "forbidden" }, 403);
  const b = await c.req.json().catch(() => ({}));
  const status = b.status === "confirmed" ? "confirmed" : b.status === "declined" ? "declined" : null;
  if (!status) return c.json({ error: "bad_status" }, 400);
  const v = await c.env.DB.prepare(
    `SELECT v.*, j.requested_by, j.title FROM visits v JOIN jobs j ON j.id = v.job_id
      WHERE v.id = ? AND v.account_id = ?`).bind(c.req.param("id"), auth.accountId).first();
  if (!v) return c.json({ error: "not_found" }, 404);
  if (v.requested_by !== auth.userId) return c.json({ error: "forbidden" }, 403);
  if (v.status !== "proposed") return c.json({ error: "not_open", status: v.status }, 409);
  const note = String(b.note || "").trim().slice(0, 500) || null;
  await c.env.DB.prepare(
    `UPDATE visits SET status = ?, tenant_note = ?, responded_at = ? WHERE id = ?`
  ).bind(status, note, new Date().toISOString(), v.id).run();
  const when = visitWhen(v);
  if (status === "confirmed") {
    await c.env.DB.prepare(`UPDATE jobs SET date = ?, time = ? WHERE id = ?`)
      .bind(v.date, v.start_time || "07:00", v.job_id).run();
    await logActivity(c.env, auth.accountId, auth.userId, "visit_confirmed",
      `Confirmed the visit for "${v.title}": ${when}`);
  } else {
    await logActivity(c.env, auth.accountId, auth.userId, "visit_declined",
      `Can't make the visit for "${v.title}" (${when})${note ? `: ${note}` : ""}`);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM visits WHERE id = ?`).bind(v.id).first();
  await touchJob(c.env, v.job_id);
  return c.json(visitRowToJs(row));
});

// ---------------------------------------------------------------------------
// A tenant's own report: taken back, or corrected while it is still fresh
// ---------------------------------------------------------------------------

// Whose report, and is it still theirs to change. Owners raise requests the
// same way, so they get the same two things.
// Photos on a report. The numbers are deliberate rather than generous: six
// is more than enough to show one problem from every useful angle, and a
// phone photo is two to four megabytes, so ten leaves room for an
// unprocessed one without leaving room for a video renamed .jpg.
// The sentence a contractor reads, built from what the tenant answered.
// Kept in one function because it is written on create and rewritten on
// every edit, and two copies of this would drift the first time one changed.
// Order matters: it is the order somebody reads it in.
function composeScope(d = {}) {
  return [
    d.unit ? `Unit ${d.unit}.` : null,
    d.problem && d.problem !== d.title ? `Reported as: ${d.problem}.` : null,
    d.started ? `Started: ${String(d.started).toLowerCase()}.` : null,
    String(d.words || "").trim(),
  ].filter(Boolean).join(" ");
}
// What is kept of the tenant's answers, apart from the prose above.
const cleanDetail = (d = {}) => ({
  problem: String(d.problem || "").slice(0, 140) || null,
  started: String(d.started || "").slice(0, 60) || null,
  words: String(d.words || "").slice(0, 4000),
  unit: String(d.unit || "").slice(0, 40) || null,
});

const MAX_REPORT_PHOTOS = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"]);
// A filename becomes part of an R2 key and comes straight off a phone, so
// it is rewritten rather than trusted: no slashes to climb out of the
// account's prefix, no dot-dot, nothing that is not plainly a name.
const safeFileName = (raw) => {
  let n = raw;
  try { n = decodeURIComponent(raw); } catch { /* already literal */ }
  return (n.replace(/[^\w.\-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[.\-]+/, "").slice(-80) || "photo.jpg");
};

// What the client sends back after uploading is a claim, not a fact: it says
// which key it wrote and what was in it. The key is checked to be inside
// this account's own prefix -- without that, one account could attach
// another's file by guessing a key and then read it through the route below,
// which serves whatever the row points at.
function cleanPhotos(raw, accountId, existing = []) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const key = String(p?.key || "");
    if (!key.startsWith(`${accountId}/report-photo/`)) continue;
    if (key.includes("..")) continue;
    if (existing.some((e) => e.key === key) || out.some((e) => e.key === key)) continue;
    const type = String(p?.type || "").toLowerCase();
    out.push({
      id: uid(),
      key,
      name: String(p?.name || "photo").slice(0, 120),
      type: PHOTO_TYPES.has(type) ? type : "image/jpeg",
      size: Number.isFinite(+p?.size) ? Math.max(0, Math.min(MAX_PHOTO_BYTES, +p.size)) : null,
      at: new Date().toISOString(),
    });
    if (existing.length + out.length >= MAX_REPORT_PHOTOS) break;
  }
  return out;
}

// Every route that touches a job's photos needs the same three answers: does
// the job exist on this account, may this caller see it, and what is on it
// now. A tenant or owner only ever reaches their own report; everybody else
// on the account is staff and sees the account's work.
async function jobForPhotos(c, auth, jobId) {
  if (auth.role === "tenant" || auth.role === "owner") return ownReport(c, auth, jobId);
  const job = await c.env.DB.prepare(
    `SELECT * FROM jobs WHERE id = ? AND account_id = ?`).bind(jobId, auth.accountId).first();
  if (!job) return { error: "not_found", status: 404 };
  if (auth.propertyIds && !maySeeProperty(auth, job.property_id)) return { error: "forbidden", status: 403 };
  return { job };
}

async function ownReport(c, auth, jobId) {
  if (auth.role !== "tenant" && auth.role !== "owner") return { error: "forbidden", status: 403 };
  const job = await c.env.DB.prepare(
    `SELECT * FROM jobs WHERE id = ? AND account_id = ?`).bind(jobId, auth.accountId).first();
  if (!job) return { error: "not_found", status: 404 };
  if (job.requested_by !== auth.userId) return { error: "forbidden", status: 403 };
  return { job };
}

// It fixed itself, or it was never really a problem. Anything live on it
// comes down: the work orders are voided so nobody turns up, the open visit
// is superseded so nobody is asked to confirm it.
app.post("/api/jobs/:id/withdraw", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const { job, error, status } = await ownReport(c, auth, id);
  if (error) return c.json({ error }, status);
  if (job.status === "completed") return c.json({ error: "already_completed" }, 409);
  if (job.withdrawn_at) return c.json({ ok: true, alreadyWithdrawn: true });
  // Once a contractor is on it, taking it back is not the tenant's call any
  // more. Somebody has been booked, may have turned work away for the slot,
  // and may already be on the way. The tenant asks the manager, who can
  // still void the work order -- this refuses the silent version of that,
  // where the contractor finds out by arriving.
  //
  // Checked here and not only in the browser: the route is reachable with a
  // job id and nothing else.
  const live = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM work_orders
      WHERE job_id = ? AND voided_at IS NULL AND status != 'declined'`).bind(id).first();
  if ((live?.n || 0) > 0 && auth.role === "tenant") {
    return c.json({ error: "contractor_assigned" }, 409);
  }
  const b = await c.req.json().catch(() => ({}));
  const note = String(b.note || "").trim().slice(0, 500) || null;
  try {
    await c.env.DB.prepare(`UPDATE jobs SET withdrawn_at = ?, withdrawn_note = ? WHERE id = ?`)
      .bind(new Date().toISOString(), note, id).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }
  const voided = await c.env.DB.prepare(
    `UPDATE work_orders SET voided_at = CURRENT_TIMESTAMP WHERE job_id = ? AND voided_at IS NULL`).bind(id).run();
  try {
    await c.env.DB.prepare(`UPDATE visits SET status = 'superseded' WHERE job_id = ? AND status IN ('proposed', 'declined')`).bind(id).run();
  } catch { /* no visits table yet is not a reason to refuse the withdrawal */ }
  await touchJob(c.env, id);
  await logEvent(c.env, auth.accountId, auth.userId, "job.withdrawn", id, { title: job.title, note });
  await logActivity(c.env, auth.accountId, auth.userId, "job_withdrawn",
    `Withdrew the report "${job.title}"${note ? `: ${note}` : ""}${voided?.meta?.changes ? ` (${voided.meta.changes} work order${voided.meta.changes === 1 ? "" : "s"} voided)` : ""}`);
  return c.json({ ok: true, voided: voided?.meta?.changes ?? 0 });
});

// ---- Photos on a report --------------------------------------------------
//
// The file itself goes to R2 through /api/uploads/report-photo/... first;
// this attaches what came back to the report. Two steps rather than one
// multipart POST because the Worker is already the data path for the upload
// and streaming a file straight into R2 costs it nothing to hold.
app.post("/api/jobs/:id/photos", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const { job, error, status } = await jobForPhotos(c, auth, id);
  if (error) return c.json({ error }, status);
  if (job.withdrawn_at || job.declined_at || job.status === "completed") {
    return c.json({ error: "closed" }, 409);
  }
  let existing;
  try { existing = parseJson(job.photos, []); }
  catch { existing = []; }
  if (existing.length >= MAX_REPORT_PHOTOS) return c.json({ error: "too_many", max: MAX_REPORT_PHOTOS }, 409);
  const b = await c.req.json().catch(() => ({}));
  const added = cleanPhotos(b.photos, auth.accountId, existing);
  if (!added.length) return c.json({ error: "nothing_to_add" }, 400);
  const next = [...existing, ...added];
  try {
    await c.env.DB.prepare(`UPDATE jobs SET photos = ? WHERE id = ?`).bind(JSON.stringify(next), id).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }
  await touchJob(c.env, id);
  await logActivity(c.env, auth.accountId, auth.userId, "job_photos",
    `Added ${added.length} photo${added.length === 1 ? "" : "s"} to "${job.title}"`);
  return c.json({ ok: true, photos: next.map((x) => ({ id: x.id, name: x.name, type: x.type, size: x.size, at: x.at })) });
});

// Taking one off does not delete the object in R2. A withdrawn photo is
// still evidence of what was reported, and an accidental removal a minute
// after uploading is the likelier event by far. Nothing points at it any
// more, which is what the tenant asked for.
app.delete("/api/jobs/:id/photos/:photoId", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const { job, error, status } = await jobForPhotos(c, auth, id);
  if (error) return c.json({ error }, status);
  const existing = parseJson(job.photos, []);
  const next = existing.filter((p) => p.id !== c.req.param("photoId"));
  if (next.length === existing.length) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`UPDATE jobs SET photos = ? WHERE id = ?`)
    .bind(next.length ? JSON.stringify(next) : null, id).run();
  return c.json({ ok: true, photos: next.map((x) => ({ id: x.id, name: x.name, type: x.type, size: x.size, at: x.at })) });
});

// Serving one back. The caller names a job and a photo on it, never a key:
// the key is read from the row after the same permission check every other
// route on that job makes. An <img src> cannot carry an Authorization
// header, so the browser fetches this like any other call and renders the
// blob -- which keeps one way in rather than inventing a second, weaker one
// on a query string.
app.get("/api/jobs/:id/photos/:photoId", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const { job, error, status } = await jobForPhotos(c, auth, id);
  if (error) return c.json({ error }, status);
  const photo = parseJson(job.photos, []).find((p) => p.id === c.req.param("photoId"));
  if (!photo) return c.notFound();
  const obj = await c.env.FILES.get(photo.key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": photo.type || "image/jpeg",
      // The key carries a uid, so a given photo id never changes content.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${photo.name.replace(/[^\w.\- ]/g, "_")}"`,
    },
  });
});

// Ten minutes to fix a typo or add the thing you forgot, and only until the
// manager has acted on it -- once approved, it is being worked from, and a
// change underneath that is a new report.
const REPORT_EDIT_WINDOW_MS = 10 * 60 * 1000;
app.patch("/api/jobs/:id/report", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const { job, error, status } = await ownReport(c, auth, id);
  if (error) return c.json({ error }, status);
  if (job.withdrawn_at) return c.json({ error: "withdrawn" }, 409);
  if (job.approved_at || job.status === "completed") return c.json({ error: "already_actioned" }, 409);
  // SQLite's CURRENT_TIMESTAMP is UTC without a zone marker.
  const created = new Date(String(job.created_at).replace(" ", "T") + (String(job.created_at).endsWith("Z") ? "" : "Z"));
  if (Date.now() - created.getTime() > REPORT_EDIT_WINDOW_MS) return c.json({ error: "edit_window_closed" }, 409);
  const b = await c.req.json().catch(() => ({}));
  const sets = [], vals = [];
  if (b.title !== undefined) {
    const title = String(b.title || "").trim().slice(0, 140);
    if (!title) return c.json({ error: "title_required" }, 400);
    sets.push("title = ?"); vals.push(title);
  }
  // The tenant's own answers. Sending these rewrites the scope sentence from
  // them, so the prose a contractor reads and the parts the tenant sees can
  // never drift apart -- which they would if the browser sent both.
  if (b.reportDetail !== undefined) {
    const was = parseJson(job.report_detail, {}) || {};
    const detail = cleanDetail({ ...was, ...b.reportDetail });
    const title = b.title !== undefined ? String(b.title || "").trim() : job.title;
    sets.push("report_detail = ?"); vals.push(JSON.stringify(detail));
    sets.push("scope = ?"); vals.push(composeScope({ ...detail, title }) || null);
  } else if (b.scope !== undefined) {
    sets.push("scope = ?"); vals.push(String(b.scope || "").trim().slice(0, 4000) || null);
  }
  if (Array.isArray(b.trades)) {
    const trades = b.trades.filter((t) => TRADE_IDS.has(t));
    sets.push("trades = ?"); vals.push(JSON.stringify(trades));
  }
  if (!sets.length) return c.json({ error: "nothing_to_change" }, 400);
  vals.push(id);
  try {
    await c.env.DB.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    return c.json({ error: "migration_needed", migration }, 503);
  }
  await touchJob(c.env, id);
  await logActivity(c.env, auth.accountId, auth.userId, "job_edited", `Corrected the report "${b.title || job.title}"`);
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
  return c.json(jobRowToJs(row, []));
});

app.post("/api/jobs/:id/reopen", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'active', completed_at = NULL WHERE id = ? AND account_id = ?`
  ).bind(c.req.param("id"), accountId).run();
  await touchJob(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// Everything about a job that ISN'T a work order — notes, measurement docs.
app.patch("/api/jobs/:id", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const id = c.req.param("id");
  const b = await c.req.json(); // { notes?, measurementDocs?, propertyId? }
  const sets = [], vals = [];
  if (b.notes !== undefined) { sets.push("notes = ?"); vals.push(b.notes); }
  if (b.measurementDocs !== undefined) { sets.push("measurement_docs = ?"); vals.push(JSON.stringify(b.measurementDocs)); }
  if (b.propertyId !== undefined) {
    const pid = b.propertyId || null;
    if (pid) {
      const owned = await c.env.DB.prepare(
        `SELECT id FROM properties WHERE id = ? AND account_id = ?`).bind(pid, accountId).first();
      if (!owned) return c.json({ error: "property_not_found" }, 404);
    }
    sets.push("property_id = ?"); vals.push(pid);
  }
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
  const { trade, companyId, crewName, tradeScope, value, responseWindow,
    payKind, rate, capHours } = await c.req.json();

  const job = await c.env.DB.prepare(
    `SELECT id, requested_by, approved_at FROM jobs WHERE id = ? AND account_id = ?`
  ).bind(jobId, accountId).first();
  if (!job) return c.json({ error: "job_not_found" }, 404);
  // A request an owner raised is not work anybody has agreed to yet. Issuing a
  // work order against one would commit the account to a price it never set.
  if (job.requested_by && !job.approved_at) return c.json({ error: "not_approved" }, 409);

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
  const cents = (v) => (v || v === 0) && String(v).trim() !== ""
    ? Math.round(Number(String(v).replace(/[^0-9.]/g, "")) * 100) : null;

  // Hourly needs both halves or it is not an offer: a rate with no ceiling
  // is an open cheque, and a ceiling with no rate is nothing. Refused here
  // rather than stored half-formed, because the contractor is about to be
  // sent whatever this says.
  const hourly = payKind === "hourly";
  const rateCents = hourly ? cents(rate) : null;
  const cap = hourly ? Number(capHours) : null;
  if (hourly) {
    if (!rateCents || rateCents <= 0) return c.json({ error: "rate_required" }, 400);
    if (!Number.isFinite(cap) || cap <= 0) return c.json({ error: "cap_required" }, 400);
  }
  // value_cents goes on meaning the most this can cost, whichever way it is
  // priced, so every total and spend figure written against it still adds up.
  const valueCents = hourly ? Math.round(rateCents * cap) : cents(value);
  const respondBy = autoScheduled ? null
    : new Date(Date.now() + windowMins(responseWindow) * 60000).toISOString();

  // Three of these columns arrive with migration 024. Without it this INSERT
  // threw an unhandled error, which reached the browser as a plain 500 and
  // read on screen as the assignment simply not working -- with nothing to
  // say why. Name the file instead: it is the one thing that turns this into
  // a two-minute fix.
  try {
    await c.env.DB.prepare(
      `INSERT INTO work_orders
        (id, wo_number, job_id, trade, company_id, engagement_id, crew_name, trade_scope, value_cents,
         status, auto_scheduled, response_window, respond_by, pay_kind, rate_cents, cap_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, woNumber, jobId, trade, companyId, engagement.id, crewName || null, tradeScope || "",
      valueCents, autoScheduled ? "accepted" : "pending", autoScheduled ? 1 : 0,
      autoScheduled ? null : (responseWindow || "24h"), respondBy,
      hourly ? "hourly" : "fixed", rateCents, cap).run();
  } catch (err) {
    const migration = missingSchema(err);
    if (!migration) throw err;
    console.error("[assign] schema not migrated:", err?.message || err);
    return c.json({ error: "migration_needed", migration }, 503);
  }

  await logEvent(c.env, accountId, userId, "wo.issued", id, { jobId, trade, companyId, woNumber });

  // Tell them. A work order nobody knows about is why response deadlines get
  // missed. Failure is logged and does not undo the issue.
  {
    const co = await c.env.DB.prepare(
      `SELECT id, company, contact, email FROM companies WHERE id = ?`).bind(companyId).first();
    if (co?.email) {
      const [account, job] = await Promise.all([
        c.env.DB.prepare(`SELECT id, name, subdomain FROM accounts WHERE id = ?`).bind(accountId).first(),
        c.env.DB.prepare(`SELECT title, address, area, zip, date FROM jobs WHERE id = ?`).bind(jobId).first(),
      ]);
      const mail = workOrderIssuedEmail({ company: co, contact: co.contact, job, trade,
        woNumber, account, respondBy });
      const result = await sendEmail(c.env, { to: co.email, subject: mail.subject,
        text: mail.text, html: mail.html });
      await logMail(c.env, { accountId, companyId, to: co.email, kind: "wo_issued",
        subject: mail.subject, result, sentBy: userId });
    }
  }
  await logActivity(c.env, accountId, userId, "wo_issued",
    `Issued ${woNumber} to ${await companyName(c.env.DB, companyId)} · ${trade}`);
  await touchJob(c.env, jobId);
  await notifyTenant(c, jobId, autoScheduled ? "booked" : "arranging");
  return c.json({ id, woNumber, status: autoScheduled ? "accepted" : "pending" }, 201);
});

// Sending somebody out, without waiting for a manager to wake up.
//
// A burst pipe at two in the morning is the case this exists for: the
// difference between a plumber in an hour and a plumber at nine is a
// ceiling. So an urgent report approves itself and issues a work order to
// the one subcontractor the account has named for this.
//
// Everything about it is deliberately conservative, because it spends
// somebody's money without asking:
//
//   * It only fires when the account has named a contractor. Nothing
//     dispatches itself out of the box.
//   * It only fires for "urgent". A fire is not a subcontractor's problem
//     and never dispatches -- emergency services are not something this
//     system can route to.
//   * The usual document rule still applies. Sending an uninsured
//     contractor into an emergency is how an emergency becomes a lawsuit,
//     so a company whose paperwork is not verified is not dispatched and
//     the manager is told why rather than left to assume somebody is on
//     the way.
//
// Never throws. A report that cannot be dispatched is still a report, and
// losing it because the call-out failed would be the worse outcome by far.
async function dispatchEmergency(c, jobId, accountId) {
  const say = (reason, extra = {}) => ({ dispatched: false, reason, ...extra });
  try {
    const account = await c.env.DB.prepare(
      `SELECT id, name, subdomain, emergency_company_id FROM accounts WHERE id = ?`).bind(accountId).first();
    const companyId = account?.emergency_company_id;
    if (!companyId) return say("no_emergency_contractor");

    const engagement = await c.env.DB.prepare(
      `SELECT * FROM engagements WHERE account_id = ? AND company_id = ?`).bind(accountId, companyId).first();
    if (!engagement || engagement.status === "ended") return say("not_engaged");

    const docReview = parseJson(engagement.doc_review, {});
    const verified = (k) => docReview[k]?.status === "verified";
    if (!verified("insurance") || !verified("bond") || !verified("contract")) {
      return say("documents_incomplete", { companyId });
    }

    const job = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first();
    if (!job) return say("job_not_found");

    // Approving is part of dispatching: a work order cannot be issued
    // against a request nobody has agreed to, and for this one the agreeing
    // is what the account did when it named an emergency contractor.
    await c.env.DB.prepare(`UPDATE jobs SET approved_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(jobId).run();

    const trade = parseJson(job.trades, [])[0] || "general";
    const autoScheduled = !!engagement.auto_schedule;
    const woNumber = "WO-" + Math.floor(1000 + Math.random() * 9000);
    const id = uid();
    // Two hours, not the usual day. If they cannot take it the manager needs
    // to know while it still matters.
    const respondBy = autoScheduled ? null : new Date(Date.now() + windowMins("2h") * 60000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO work_orders
        (id, wo_number, job_id, trade, company_id, engagement_id, crew_name, trade_scope, value_cents,
         status, auto_scheduled, response_window, respond_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, woNumber, jobId, trade, companyId, engagement.id, null, job.scope || "", null,
      autoScheduled ? "accepted" : "pending", autoScheduled ? 1 : 0,
      autoScheduled ? null : "2h", respondBy).run();

    const co = await c.env.DB.prepare(
      `SELECT id, company, contact, email, phone, notify FROM companies WHERE id = ?`).bind(companyId).first();
    const where = [job.address, job.zip].filter(Boolean).join(", ");
    const line = `EMERGENCY call-out from ${account.name}: ${job.title}${where ? ` at ${where}` : ""}. ${woNumber}.`;
    // Email and text, both, regardless of what they normally chose. Somebody
    // who opted out of texts did so about job offers, not about this.
    if (co?.email) {
      const result = await sendEmail(c.env, { to: co.email,
        subject: `Emergency call-out — ${job.title}`,
        text: `${line}\n\n${job.scope || ""}\n\nThis was sent automatically because ${account.name} named you their emergency contractor. Please respond within two hours.` });
      await logMail(c.env, { accountId, companyId, to: co.email, kind: "emergency_dispatch",
        subject: `Emergency call-out — ${job.title}`, result, sentBy: null });
    }
    if (co?.phone) {
      await sendSms(c.env, { to: co.phone, body: line.slice(0, 300) }).catch(() => {});
    }

    await logEvent(c.env, accountId, null, "wo.emergency_dispatched", id, { jobId, companyId, woNumber });
    await logActivity(c.env, accountId, job.requested_by, "emergency_dispatched",
      `Emergency: ${woNumber} went straight to ${co?.company || "the emergency contractor"} for "${job.title}"`);
    await notifyTenant(c, jobId, autoScheduled ? "booked" : "arranging");
    return { dispatched: true, companyId, woNumber, company: co?.company || null,
      status: autoScheduled ? "accepted" : "pending" };
  } catch (err) {
    // A failed dispatch must never cost the report.
    console.error("[emergency] dispatch failed:", err);
    return say("dispatch_failed");
  }
}

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

  await touchJob(c.env, wo.job_id);
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
  await touchJob(c.env, wo.job_id);
  if (status === "accepted") await notifyTenant(c, wo.job_id, "booked");
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
  await logActivity(c.env, accountId, userId,
    body.status === "verified" ? "doc_verified" : "doc_rejected",
    `${body.status === "verified" ? "Verified" : "Rejected"} ${kind} for ${await companyName(c.env.DB, companyId)}`);
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

  const col = { insurance: "insurance", bond: "bond", contract: "contract", w9: "w9" }[kind];
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

  const col = { insurance: "insurance", bond: "bond", contract: "contract", w9: "w9" }[kind];
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
  const type = (c.req.header("Content-Type") || "application/octet-stream").split(";")[0].trim().toLowerCase();

  // Report photos come from people outside the company -- every tenant in
  // every building -- so this one kind is checked rather than trusted. The
  // declared length is refused early so a large body is never streamed at
  // all; the real length is checked after, because Content-Length can lie
  // and a chunked upload does not send one.
  if (kind === "report-photo") {
    if (!PHOTO_TYPES.has(type)) return c.json({ error: "not_an_image", type }, 415);
    const declared = Number(c.req.header("Content-Length") || 0);
    if (declared > MAX_PHOTO_BYTES) return c.json({ error: "too_big", max: MAX_PHOTO_BYTES }, 413);
    const body = await c.req.arrayBuffer();
    if (body.byteLength > MAX_PHOTO_BYTES) return c.json({ error: "too_big", max: MAX_PHOTO_BYTES }, 413);
    if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
    const key = `${accountId}/report-photo/${uid()}-${safeFileName(fileName)}`;
    await c.env.FILES.put(key, body, { httpMetadata: { contentType: type } });
    return c.json({ key, size: body.byteLength, type });
  }

  const key = `${accountId}/${kind}/${uid()}-${decodeURIComponent(fileName)}`;
  await c.env.FILES.put(key, c.req.raw.body, { httpMetadata: { contentType: type } });
  return c.json({ key });
});

// ---------------------------------------------------------------------------
// Nightly sweep target — re-checks every company with a license on file and
// flags any status change. Wire this up as a Cron Trigger (see wrangler.toml).
// ---------------------------------------------------------------------------
async function licenseSweep(env) {
  const { results: companies } = await env.DB.prepare(
    `SELECT id, license, state, license_check FROM companies WHERE license IS NOT NULL AND license != ''`
  ).all();

  const flagged = [];
  for (const co of companies) {
    const prevStatus = parseJson(co.license_check)?.status;
    const state = (co.state || "WA").trim().toUpperCase();
    const result = await verifyLicenseForState(state, co.license);
    if (result.status && result.status !== prevStatus) flagged.push({ companyId: co.id, from: prevStatus, to: result.status });
    await storeLicenseCheck(env.DB, co.id, state, result);
  }
  return { checked: companies.length, flagged };
}

// Every Scale account whose address is not live yet. Two different problems
// look the same from a customer's side -- a certificate still being issued,
// and a provisioning call that failed hours ago and nobody saw -- so this
// retries both. Provisioning is idempotent, which is what makes a blind
// retry the right shape here.
//
// Also catches the reverse: an account that dropped to Basic while the
// Worker was mid-deploy and kept an address it is no longer paying for.
async function hostnameSweep(env) {
  if (!hostnameConfig(env)) return { skipped: "cloudflare_not_configured" };

  const { results } = await env.DB.prepare(
    `SELECT id, subdomain, plan, hostname_status FROM accounts
      WHERE (plan = 'scale' AND (hostname_status IS NULL OR hostname_status IN ('pending','failed')))
         OR (plan != 'scale' AND hostname_status IN ('active','pending','failed'))`
  ).all();

  const changed = [];
  for (const a of results) {
    let res;
    if (a.plan === "scale" && a.hostname_status === "pending") {
      // Already registered and merely waiting on a certificate: ask, do not
      // re-register. Re-posting a pending hostname every few minutes is how
      // you find Cloudflare's rate limit.
      res = await checkHostname(env, a.subdomain);
      await env.DB.prepare(
        `UPDATE accounts SET hostname_status = ?, hostname_error = ?, hostname_checked_at = ? WHERE id = ?`
      ).bind(res.status, res.error || null, new Date().toISOString(), a.id).run();
    } else {
      // Never attempted, failed, or on the wrong side of a plan change.
      // syncHostname records its own outcome.
      res = await syncHostname(env, a, { reason: "sweep" });
    }
    if (res && res.status !== a.hostname_status) {
      changed.push({ subdomain: a.subdomain, from: a.hostname_status, to: res.status });
    }
  }
  return { checked: results.length, changed };
}

app.get("/api/cron/license-sweep", async (c) => {
  if (c.req.header("Authorization") !== `Bearer ${c.env.CRON_SECRET}`) return c.json({ error: "forbidden" }, 403);
  return c.json(await licenseSweep(c.env));
});

app.get("/api/cron/hostname-sweep", async (c) => {
  if (c.req.header("Authorization") !== `Bearer ${c.env.CRON_SECRET}`) return c.json({ error: "forbidden" }, 403);
  return c.json(await hostnameSweep(c.env));
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
  const auth = c.get("auth");
  const { accountId } = auth;
  const scope = auth.propertyIds ? `
      AND sc.job_id IN (SELECT id FROM jobs WHERE account_id = ?
            AND property_id IN (${auth.propertyIds.map(() => "?").join(",") || "NULL"}))` : "";
  const { results } = await c.env.DB.prepare(
    `SELECT sc.*, co.company as company_name FROM service_calls sc
     JOIN companies co ON co.id = sc.company_id
     WHERE sc.account_id = ? ${scope} ORDER BY sc.raised_at DESC`
  ).bind(accountId, ...(auth.propertyIds ? [accountId, ...auth.propertyIds] : [])).all();
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
  await logActivity(c.env, accountId, userId, "service_call",
    `Raised a ${b.kind === "warranty" ? "warranty claim" : "callback"} on ${await companyName(c.env.DB, b.subId)}`);
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


// ---------------------------------------------------------------------------
// Properties (portfolio / property managers)
// ---------------------------------------------------------------------------
// Every query is scoped by account_id, so one account can never read or write
// another's buildings even with a guessed id.

const propertyRowToJs = (r) => ({
  id: r.id, accountId: r.account_id, name: r.name, address: r.address,
  city: r.city, state: r.state, zip: r.zip,
  units: r.units == null ? "" : r.units, notes: r.notes || "",
});

app.get("/api/properties", async (c) => {
  const auth = c.get("auth");
  // A building owner is scoped to their own buildings. The filter is here and
  // not only in the browser, because the browser is not the thing being
  // trusted -- this endpoint answers a request, not a page.
  const scope = scopeClause(auth, "id");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM properties WHERE account_id = ? ${scope.sql} ORDER BY name`
  ).bind(auth.accountId, ...scope.vals).all();
  return c.json(results.map(propertyRowToJs));
});

app.post("/api/properties", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json();
  const name = (b.name || "").trim();
  if (!name) return c.json({ error: "name_required" }, 400);
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO properties (id, account_id, name, address, city, state, zip, units, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, accountId, name, b.address || null, b.city || null, b.state || null,
    b.zip || null, b.units === "" || b.units == null ? null : Number(b.units), b.notes || null).run();
  await logEvent(c.env, accountId, c.get("auth").userId, "property.created", id, { name });
  await logActivity(c.env, accountId, c.get("auth").userId, "property_added", `Added property ${name}`);
  return c.json({ id }, 201);
});

app.patch("/api/properties/:id", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json();
  const cols = { name: "name", address: "address", city: "city", state: "state",
                 zip: "zip", units: "units", notes: "notes" };
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(cols)) {
    if (b[k] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(k === "units" ? (b[k] === "" || b[k] == null ? null : Number(b[k])) : b[k]);
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(c.req.param("id"), accountId);
  await c.env.DB.prepare(
    `UPDATE properties SET ${sets.join(", ")} WHERE id = ? AND account_id = ?`
  ).bind(...vals).run();
  return c.json({ ok: true });
});

app.delete("/api/properties/:id", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const id = c.req.param("id");
  // engagement_properties cascades; jobs keep their history, so only the
  // forward pointer is cleared.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM engagement_properties WHERE property_id = ?
        AND engagement_id IN (SELECT id FROM engagements WHERE account_id = ?)`
    ).bind(id, accountId),
    c.env.DB.prepare(
      `UPDATE jobs SET property_id = NULL WHERE property_id = ? AND account_id = ?`
    ).bind(id, accountId),
    c.env.DB.prepare(`DELETE FROM properties WHERE id = ? AND account_id = ?`).bind(id, accountId),
  ]);
  await logEvent(c.env, accountId, c.get("auth").userId, "property.deleted", id, null);
  return c.json({ ok: true });
});

// Which properties a vendor is scoped to, for THIS account's engagement only.
app.put("/api/subs/:companyId/properties", requireRole("admin", "pm"), async (c) => {
  const { accountId } = c.get("auth");
  const companyId = c.req.param("companyId");
  const b = await c.req.json(); // { propertyIds: [...] }
  const en = await c.env.DB.prepare(
    `SELECT id FROM engagements WHERE account_id = ? AND company_id = ?`
  ).bind(accountId, companyId).first();
  if (!en) return c.json({ error: "not_engaged" }, 404);

  const ids = Array.isArray(b.propertyIds) ? b.propertyIds : [];
  // Only properties this account actually owns — a foreign id is dropped
  // rather than trusted.
  const stmts = [c.env.DB.prepare(`DELETE FROM engagement_properties WHERE engagement_id = ?`).bind(en.id)];
  for (const pid of ids) {
    stmts.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO engagement_properties (engagement_id, property_id)
       SELECT ?, id FROM properties WHERE id = ? AND account_id = ?`
    ).bind(en.id, pid, accountId));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Change orders
// ---------------------------------------------------------------------------
// A work order is never edited once accepted. Each change is a numbered change
// order the other side accepts or declines, and the revised value is derived
// from the accepted ones (see the work_order_revised view).

const changeOrderRowToJs = (r) => ({
  id: r.id, workOrderId: r.work_order_id, seq: r.seq, kind: r.kind, origin: r.origin,
  scope: r.scope, valueDelta: r.value_delta_cents, status: r.status,
  raisedBy: r.raised_by, raisedAt: r.raised_at, respondBy: r.respond_by,
  respondedAt: r.responded_at, note: r.note || "",
  jobId: r.job_id, trade: r.trade, companyId: r.company_id,
});

app.get("/api/change-orders", async (c) => {
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, w.job_id, w.trade, w.company_id
       FROM change_orders co
       JOIN work_orders w ON w.id = co.work_order_id
       JOIN jobs j ON j.id = w.job_id
      WHERE j.account_id = ?
      ORDER BY co.raised_at DESC`
  ).bind(accountId).all();
  return c.json(results.map(changeOrderRowToJs));
});

// Either side can raise one: the GC, or the sub who finds hidden conditions.
app.post("/api/change-orders", async (c) => {
  const { accountId, userId, role, companyId } = c.get("auth");
  const b = await c.req.json(); // { workOrderId, kind, scope, valueDelta, respondBy, note }
  const wo = await c.env.DB.prepare(
    `SELECT w.id, w.status, w.company_id FROM work_orders w JOIN jobs j ON j.id = w.job_id
      WHERE w.id = ? AND j.account_id = ?`
  ).bind(b.workOrderId, accountId).first();
  if (!wo) return c.json({ error: "work_order_not_found" }, 404);
  // Account scope alone is not enough for a contractor: every sub in the
  // account shares it. They may only touch their own company's work order.
  if (role === "contractor" && wo.company_id !== companyId) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Guardrail from the deployment doc: no change order against a work order
  // that was never accepted — reissue it instead.
  if (wo.status !== "accepted") return c.json({ error: "work_order_not_accepted" }, 409);

  const origin = role === "contractor" ? "sub" : "gc";
  const next = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM change_orders WHERE work_order_id = ?`
  ).bind(wo.id).first();
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO change_orders (id, work_order_id, seq, kind, origin, scope, value_delta_cents, raised_by, respond_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, wo.id, next.n, b.kind || "added", origin, b.scope || "",
    Number(b.valueDelta) || 0, userId, b.respondBy || null, b.note || null).run();
  await logEvent(c.env, accountId, userId, "change_order.raised", id, { workOrderId: wo.id, seq: next.n, origin });
  await logActivity(c.env, accountId, userId, "change_order",
    `Change order #${next.n} raised by the ${origin === "sub" ? "subcontractor" : "general contractor"}`);
  return c.json({ id, seq: next.n }, 201);
});

// The other side responds. Whoever raised it cannot also accept it.
app.post("/api/change-orders/:id/respond", async (c) => {
  const { accountId, role, companyId } = c.get("auth");
  const b = await c.req.json(); // { status: "accepted" | "declined" }
  if (!["accepted", "declined"].includes(b.status)) return c.json({ error: "bad_status" }, 400);
  const co = await c.env.DB.prepare(
    `SELECT co.*, w.company_id AS wo_company_id FROM change_orders co
       JOIN work_orders w ON w.id = co.work_order_id
       JOIN jobs j ON j.id = w.job_id
      WHERE co.id = ? AND j.account_id = ?`
  ).bind(c.req.param("id"), accountId).first();
  if (!co) return c.json({ error: "not_found" }, 404);
  if (role === "contractor" && co.wo_company_id !== companyId) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (co.status !== "pending") return c.json({ error: "already_resolved" }, 409);
  const responderSide = role === "contractor" ? "sub" : "gc";
  if (responderSide === co.origin) return c.json({ error: "cannot_answer_own" }, 403);

  await c.env.DB.prepare(
    `UPDATE change_orders SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(b.status, co.id).run();
  await logEvent(c.env, accountId, c.get("auth").userId, "change_order." + b.status, co.id, { workOrderId: co.work_order_id, seq: co.seq });
  await logActivity(c.env, accountId, c.get("auth").userId, "change_order",
    `Change order #${co.seq} ${b.status}`);
  return c.json({ ok: true });
});

// Original, revised and pending count for one work order — derived, never stored.
app.get("/api/work-orders/:id/revised", async (c) => {
  const { accountId } = c.get("auth");
  const row = await c.env.DB.prepare(
    `SELECT r.* FROM work_order_revised r
       JOIN work_orders w ON w.id = r.id
       JOIN jobs j ON j.id = w.job_id
      WHERE r.id = ? AND j.account_id = ?`
  ).bind(c.req.param("id"), accountId).first();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ id: row.id, originalCents: row.original_cents,
    revisedCents: row.revised_cents, pendingCount: row.pending_count });
});

// ---------------------------------------------------------------------------
// Platform console — SubSub's own staff
// ---------------------------------------------------------------------------
// Staff are deliberately not a role in the app's own role table: they get a
// separate surface on a separate hostname, checked here on every route.
//
// This gate is the whole reason the console can be deployed at all. It refuses
// outright unless real auth is configured, so a console built without Supabase
// cannot be signed into by anyone, and it re-reads the superadmins table on
// every request rather than trusting anything the browser sends.
//
// Still missing before admin.subsub.work should exist: SSO or hardware keys in
// front of this, since it is the one login that can reach every account.
// The access token has already been proven valid by Supabase before this is
// called, so reading its claims without re-verifying the signature is safe.
function decodeJwtClaims(authHeader) {
  try {
    const token = String(authHeader || "").replace(/^Bearer /, "");
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(b64));
  } catch { return null; }
}

// Did THIS session authenticate through the identity provider, or is it just an
// account that happens to have a Google identity linked?
//
// The distinction matters for offboarding. If a password on the Supabase user
// is also accepted, suspending someone in Google Workspace does not actually
// revoke their access to the console. `amr` is session-scoped and is the right
// answer; `app_metadata.providers` is account-scoped and only a fallback for
// tokens issued without it.
function sessionUsedFederatedLogin(claims, supaUser) {
  const amr = Array.isArray(claims?.amr) ? claims.amr : [];
  if (amr.length) {
    return amr.some((entry) => {
      const m = String(entry?.method || "").toLowerCase();
      if (m.includes("google") || m.startsWith("sso/") || m === "sso") return true;
      // A bare "oauth" only counts if Google is the linked provider, so another
      // enabled provider cannot stand in for the Workspace login.
      return m === "oauth" && linkedProviders(supaUser).includes("google");
    });
  }
  return linkedProviders(supaUser).includes("google");
}

function linkedProviders(supaUser) {
  const meta = supaUser?.app_metadata || {};
  return Array.isArray(meta.providers) ? meta.providers
    : [meta.provider].filter(Boolean);
}

// Who is asking, for the platform console. Two ways in, and the first is the
// one that should be used:
//
//   1. Cloudflare Access. It sits in front of the console's hostname and
//      will not pass a request through until Google Workspace has vouched
//      for the person, then signs a JWT saying who they are. Nothing
//      unauthenticated reaches this Worker, and the console needs no login
//      screen of its own.
//
//   2. A Supabase session. The original route, kept for a console reached at
//      a hostname Access does not cover -- local development, mainly. It
//      demands a federated login unless STAFF_ALLOW_PASSWORD is set.
//
// Either way, identity is not membership: the superadmins table decides, and
// a customer's perfectly valid login gets nothing here.
async function staffIdentity(c) {
  const accessClaims = await verifyAccessJwt(c.env, c.req.header("Cf-Access-Jwt-Assertion"));
  if (accessClaims) return { email: accessClaims.email, authId: null, via: "access" };

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_ANON_KEY) return { error: "auth_not_configured" };
  const authHeader = c.req.header("Authorization");
  const supaUser = await verifySupabaseToken(c.env, authHeader);
  if (!supaUser) return { error: "unauthorized" };

  // A password on a staff address is refused, so disabling someone in
  // Workspace actually locks them out. STAFF_ALLOW_PASSWORD is break-glass
  // and should not be set in normal operation — see app/README.md.
  const breakGlass = String(c.env.STAFF_ALLOW_PASSWORD || "") === "1";
  if (!breakGlass && !sessionUsedFederatedLogin(decodeJwtClaims(authHeader), supaUser)) {
    return { error: "sso_required" };
  }
  return { email: supaUser.email || "", authId: supaUser.id, via: "supabase" };
}

async function requireStaff(c) {
  const who = await staffIdentity(c);
  if (who.error) {
    const status = who.error === "auth_not_configured" ? 501
      : who.error === "unauthorized" ? 401 : 403;
    return { error: c.json({ error: who.error }, status) };
  }

  // Anyone with any Google account can complete a Google sign-in, and an
  // Access policy can be widened by mistake, so the staff domain is checked
  // here too — the one place it cannot be skipped.
  const domain = String(c.env.STAFF_EMAIL_DOMAIN || "").trim().toLowerCase();
  const email = String(who.email || "").toLowerCase();
  if (domain && !email.endsWith("@" + domain)) {
    return { error: c.json({ error: "wrong_domain" }, 403) };
  }

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, s.role, s.finance, s.impersonate
       FROM users u JOIN superadmins s ON s.user_id = u.id
      WHERE (? IS NOT NULL AND u.auth_id = ?) OR lower(u.email) = lower(?)`
  ).bind(who.authId, who.authId, email).first();
  // Being signed in is not being staff. Someone with a customer login, or a
  // Workspace account nobody has granted anything to, must get nothing here.
  if (!row) return { error: c.json({ error: "forbidden" }, 403) };

  return { staff: {
    userId: row.id, name: row.name, email: row.email, role: row.role,
    finance: !!row.finance && row.role === "superadmin",
    impersonate: !!row.impersonate && row.role === "superadmin",
    via: who.via,
  } };
}

// Who am I, and what may I see? The console calls this before rendering.
app.get("/api/platform/me", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  return c.json(staff);
});

// Financial figures are superadmin-only, and the check is here rather than in
// the interface: a standard user calling this directly gets 403, not numbers.
app.get("/api/platform/revenue", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  if (!staff.finance) return c.json({ error: "forbidden" }, 403);

  const [subEvents, invoices, accounts] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM subscription_events ORDER BY at`).all(),
    c.env.DB.prepare(`SELECT * FROM invoices ORDER BY period_start DESC LIMIT 200`).all(),
    c.env.DB.prepare(`SELECT id, name, plan, billing FROM accounts`).all(),
  ]);
  // Normalized: an annual plan counts as its monthly twelfth, or the number
  // means nothing once the mix moves.
  const mrrCents = accounts.results.reduce((n, a) =>
    n + (a.plan === "scale" ? (a.billing === "annual" ? Math.round(99000 / 12) : 9900) : 0), 0);
  return c.json({
    mrrCents, arrCents: mrrCents * 12,
    subscriptionEvents: subEvents.results,
    invoices: invoices.results,
  });
});

app.get("/api/platform/health", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  if (!staff.finance) return c.json({ error: "forbidden" }, 403);
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM accounts)   AS accounts,
       (SELECT COUNT(*) FROM users)      AS users,
       (SELECT COUNT(*) FROM companies)  AS companies,
       (SELECT COUNT(*) FROM jobs WHERE status = 'active')   AS active_jobs,
       (SELECT COUNT(*) FROM work_orders WHERE status = 'pending') AS pending_wos,
       (SELECT COUNT(*) FROM change_orders WHERE status = 'pending') AS pending_cos`
  ).first();
  return c.json(row);
});

// The account list. A standard user may see it, without the money columns.
app.get("/api/platform/accounts", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.subdomain, a.kind, a.plan, a.billing, a.created_at,
            (SELECT COUNT(*) FROM memberships m WHERE m.account_id = a.id AND m.role <> 'contractor') AS users,
            (SELECT COUNT(*) FROM engagements e WHERE e.account_id = a.id) AS subs,
            (SELECT COUNT(*) FROM jobs j WHERE j.account_id = a.id) AS jobs
       FROM accounts a ORDER BY a.created_at DESC`
  ).all();
  const rows = results.map((a) => {
    const base = { id: a.id, name: a.name, subdomain: a.subdomain, kind: a.kind,
      plan: a.plan, billing: a.billing, createdAt: a.created_at,
      users: a.users, subs: a.subs, jobs: a.jobs };
    if (!staff.finance) return base;   // omitted, not hidden in the interface
    return { ...base, mrrCents: a.plan === "scale"
      ? (a.billing === "annual" ? Math.round(99000 / 12) : 9900) : 0 };
  });
  return c.json(rows);
});

// The global company registry — the one place a lapsed license is visible
// across every account engaging that company.
app.get("/api/platform/companies", async (c) => {
  const { error } = await requireStaff(c);
  if (error) return error;
  const { results } = await c.env.DB.prepare(
    `SELECT co.id, co.company, co.license, co.state, co.city,
            (SELECT COUNT(*) FROM engagements e WHERE e.company_id = co.id) AS accounts,
            (SELECT lc.status FROM license_checks lc WHERE lc.company_id = co.id
              ORDER BY lc.checked_at DESC LIMIT 1) AS license_status
       FROM companies co ORDER BY co.company`
  ).all();
  return c.json(results);
});

// One account's activity stream. This is the first place support looks when a
// customer says somebody changed something.
app.get("/api/platform/activity/:accountId", async (c) => {
  const { error } = await requireStaff(c);
  if (error) return error;
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.name AS user_name FROM activity a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.account_id = ? ORDER BY a.at DESC LIMIT 200`
  ).bind(c.req.param("accountId")).all();
  return c.json(results.map((r) => ({
    id: r.id, accountId: r.account_id, at: r.at, userId: r.user_id,
    userName: r.user_name, kind: r.kind, text: r.text, meta: parseJson(r.meta),
  })));
});

// Everything the console renders, in the shapes its screens already derive
// from. One call rather than six, because every screen cross-references the
// others (an account row counts its own users, subs and jobs).
//
// This returns the whole platform. That is fine at this size and will not be:
// once there are thousands of accounts this needs pagination, and the per-
// account rollups belong in platform_daily_stats rather than being recomputed
// in the browser on every load.
app.get("/api/platform/bootstrap", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;

  const [accounts, users, memberships, companies, engagements, jobs, subEvents, activity] =
    await Promise.all([
      c.env.DB.prepare(`SELECT * FROM accounts`).all(),
      c.env.DB.prepare(`SELECT id, name, email, phone FROM users`).all(),
      c.env.DB.prepare(`SELECT user_id, account_id, role, company_id FROM memberships`).all(),
      c.env.DB.prepare(`SELECT id, company, license, ubi, city, state, zip, warranty FROM companies`).all(),
      c.env.DB.prepare(`SELECT id, account_id, company_id, status, categories, rating, rated_jobs FROM engagements`).all(),
      c.env.DB.prepare(`SELECT id, account_id, title, status, date, completed_at, created_at FROM jobs`).all(),
      c.env.DB.prepare(`SELECT * FROM subscription_events ORDER BY at`).all(),
      c.env.DB.prepare(
        `SELECT a.*, u.name AS user_name FROM activity a
           LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.at DESC LIMIT 500`).all(),
    ]);

  // SMS, rolled up by day rather than row by row. The console only ever
  // reports totals over a window, and a year of individual messages is a
  // payload nobody reads. The table may not exist on a database that has not
  // run migration 011, which must not take the whole console down.
  let smsDaily = [];
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT substr(at, 1, 10) AS day, COUNT(*) AS sent, SUM(segments) AS segments,
              SUM(cost_cents) AS cost, SUM(billed_cents) AS billed
         FROM sms_log WHERE status = 'sent' GROUP BY day ORDER BY day`
    ).all();
    smsDaily = results;
  } catch (err) {
    console.warn("[platform] sms_log unavailable:", err?.message || err);
  }

  // The last work order per job is what the console's "expired response"
  // count walks, so hand back enough of it to compute that.
  const { results: wos } = await c.env.DB.prepare(
    `SELECT id, job_id, trade, company_id, status, respond_by, value_cents FROM work_orders WHERE voided_at IS NULL`
  ).all();
  const byJob = {};
  wos.forEach((w) => {
    (byJob[w.job_id] ||= {})[w.trade] = {
      subId: w.company_id, status: w.status, respondBy: w.respond_by, value: w.value_cents,
    };
  });

  return c.json({
    // Financial figures are omitted for a standard user here too, not just on
    // the dedicated revenue route — otherwise the omission is cosmetic.
    accounts: accounts.results.map((a) => ({
      id: a.id, name: a.name, subdomain: a.subdomain, kind: a.kind,
      plan: a.plan, billing: a.billing, comped: !!a.comped, compNote: a.comp_note,
      // What this account hires out. The console ranks these into "top trades",
      // which is the only demand signal that exists before anyone engages a sub.
      trades: parseJson(a.trades, []),
      hostnameStatus: a.hostname_status, hostnameError: a.hostname_error,
      hostnameCheckedAt: a.hostname_checked_at,
      subscriptionStatus: a.subscription_status, currentPeriodEnd: a.current_period_end,
      createdAt: (a.created_at || "").slice(0, 10),
      status: "active",
    })),
    users: users.results,
    memberships: memberships.results.map((m) => ({
      userId: m.user_id, accountId: m.account_id, role: m.role, companyId: m.company_id,
    })),
    companies: companies.results,
    engagements: engagements.results.map((e) => ({
      id: e.id, accountId: e.account_id, companyId: e.company_id, status: e.status,
      categories: parseJson(e.categories, []), rating: e.rating, ratedJobs: e.rated_jobs,
    })),
    jobs: jobs.results.map((j) => ({
      id: j.id, accountId: j.account_id, title: j.title, status: j.status,
      date: j.date, completedAt: j.completed_at,
      createdAt: (j.created_at || "").slice(0, 10),
      assignments: byJob[j.id] || {},
    })),
    subEvents: staff.finance ? subEvents.results.map((e) => ({
      id: e.id, accountId: e.account_id, at: e.at, kind: e.kind,
      fromPlan: e.from_plan, toPlan: e.to_plan, cycle: e.cycle, mrrDelta: e.mrr_delta_cents,
    })) : [],
    activity: activity.results.map((r) => ({
      id: r.id, accountId: r.account_id, at: r.at, userId: r.user_id,
      userName: r.user_name, kind: r.kind, text: r.text,
    })),
    // Usage is operational, cost and revenue are not: a standard console user
    // sees how much is being sent and not what it earns.
    smsDaily: smsDaily.map((r) => ({
      day: r.day, sent: r.sent || 0, segments: r.segments || 0,
      ...(staff.finance ? { cost: r.cost || 0, billed: r.billed || 0 } : {}),
    })),
  });
});

// Signing in as a customer is audited before the session is handed over, not
// after. The banner in the interface is not the audit trail.
app.post("/api/platform/impersonate/:accountId", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  if (!staff.impersonate) return c.json({ error: "forbidden" }, 403);
  const accountId = c.req.param("accountId");
  const b = await c.req.json().catch(() => ({}));

  const account = await c.env.DB.prepare(`SELECT id, name FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!account) return c.json({ error: "not_found" }, 404);
  const target = await c.env.DB.prepare(
    `SELECT user_id FROM memberships WHERE account_id = ? AND role = 'admin' LIMIT 1`
  ).bind(accountId).first();
  if (!target) return c.json({ error: "no_admin_on_account" }, 409);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO activity (id, account_id, at, user_id, kind, text, meta)
       VALUES (?, ?, datetime('now'), NULL, 'impersonation', ?, ?)`
    ).bind(uid(), accountId, `${staff.name} signed in as this account`,
      JSON.stringify({ staffUserId: staff.userId, reason: b.reason || null })),
    c.env.DB.prepare(
      `INSERT INTO events (account_id, actor_id, kind, subject_id, payload)
       VALUES (?, ?, 'impersonation_started', ?, ?)`
    ).bind(accountId, staff.userId, accountId,
      JSON.stringify({ reason: b.reason || null, staffEmail: staff.email })),
  ]);
  // The session itself. Thirty minutes is long enough to look at a problem
  // and short enough that a forgotten tab is not a standing key to somebody
  // else's business.
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const expires = new Date(Date.now() + 30 * 60000).toISOString().replace("T", " ").slice(0, 19);
  await c.env.DB.prepare(
    `INSERT INTO impersonation_sessions (token, account_id, act_as_user_id, staff_user_id, reason, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(token, accountId, target.user_id, staff.userId, b.reason || null, expires).run();

  return c.json({
    ok: true, accountId, accountName: account.name,
    actAsUserId: target.user_id, token, expiresAt: expires,
  });
});

// Handing the seat back. Deliberately needs no session of its own: revoking
// is not a privileged act, and a staff member closing a tab should never be
// the reason a session outlives its use.
app.post("/api/impersonation/end", async (c) => {
  const token = c.req.header("X-Impersonation-Token")
    || (await c.req.json().catch(() => ({})))?.token;
  if (!token) return c.json({ ok: true });

  const sess = await c.env.DB.prepare(
    `SELECT account_id, staff_user_id FROM impersonation_sessions
      WHERE token = ? AND ended_at IS NULL`).bind(token).first();
  await c.env.DB.prepare(
    `UPDATE impersonation_sessions SET ended_at = datetime('now') WHERE token = ?`
  ).bind(token).run();

  if (sess) {
    await c.env.DB.prepare(
      `INSERT INTO activity (id, account_id, at, user_id, kind, text, meta)
       VALUES (?, ?, datetime('now'), NULL, 'impersonation', ?, ?)`
    ).bind(uid(), sess.account_id, "Staff session ended",
      JSON.stringify({ staffUserId: sess.staff_user_id })).run();
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Platform writes
// ---------------------------------------------------------------------------
// Everything above this point reads. These change or remove other people's
// data, so each one is gated on top of requireStaff and each one is audited:
// a support action nobody can reconstruct afterwards is indistinguishable
// from an intrusion.
//
// The split is deliberate. `standard` staff run support -- fix a typo, add a
// user, send a reset -- while anything that creates, deletes or touches
// money is `superadmin`. Support work should not require the account that
// can delete a customer.
function requireSuperadmin(c, staff) {
  return staff.role === "superadmin" ? null : c.json({ error: "forbidden" }, 403);
}

// One place, so every one of these writes leaves the same trail.
async function auditPlatform(env, staff, accountId, kind, text, meta) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO activity (id, account_id, at, user_id, kind, text, meta)
       VALUES (?, ?, datetime('now'), NULL, ?, ?, ?)`
    ).bind(uid(), accountId, kind, text, JSON.stringify({ ...(meta || {}), staffUserId: staff.userId, staffEmail: staff.email })),
    env.DB.prepare(
      `INSERT INTO events (account_id, actor_id, kind, subject_id, payload)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(accountId, staff.userId, kind, accountId, JSON.stringify({ ...(meta || {}), staffEmail: staff.email })),
  ]);
}

app.post("/api/platform/accounts", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;

  const b = await c.req.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  const subdomain = validSubdomain(b.subdomain);
  const kind = ACCOUNT_KINDS.includes(b.kind) ? b.kind : "general_contractor";
  const plan = b.plan === "scale" ? "scale" : "basic";
  const billing = b.billing === "annual" ? "annual" : "monthly";
  if (!name) return c.json({ error: "name_required" }, 400);
  if (!subdomain) return c.json({ error: "invalid_subdomain" }, 400);

  const taken = await c.env.DB.prepare(`SELECT id FROM accounts WHERE subdomain = ?`).bind(subdomain).first();
  if (taken) return c.json({ error: "subdomain_taken" }, 409);

  // The console asks for an owner, because an account with nobody on it is a
  // row, not a customer -- there would be no way in and nothing to reset.
  const ownerName = String(b.ownerName || "").trim();
  const ownerEmail = String(b.ownerEmail || "").trim().toLowerCase();
  const ownerPhoneRaw = String(b.ownerPhone || "").trim();
  const ownerPhone = normalizePhone(ownerPhoneRaw);
  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) return c.json({ error: "invalid_email" }, 400);
  if (ownerEmail && !ownerName) return c.json({ error: "name_required" }, 400);
  if (ownerPhoneRaw && !ownerPhone) return c.json({ error: "invalid_phone" }, 400);

  // Same rule the public signup uses: absent means "never chosen", which the
  // app treats differently from "hires nobody" -- it is what decides whether
  // to ask. An empty list from the console therefore stays null.
  const trades = b.trades === undefined ? null : validTrades(b.trades);
  if (trades === null && b.trades !== undefined) return c.json({ error: "invalid_trades" }, 400);

  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO accounts (id, name, subdomain, kind, plan, billing, trades, use_default_mark)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, name, subdomain, kind, plan, billing,
    trades && trades.length ? JSON.stringify(trades) : null).run();

  let ownerId = null;
  if (ownerEmail) {
    // Reuse the person if this address is already known. Somebody running two
    // companies is one person with two memberships, not two rows.
    const existing = await c.env.DB.prepare(
      `SELECT id FROM users WHERE lower(email) = lower(?)`).bind(ownerEmail).first();
    ownerId = existing?.id || uid();
    if (!existing) {
      await c.env.DB.prepare(`INSERT INTO users (id, name, email, phone) VALUES (?, ?, ?, ?)`)
        .bind(ownerId, ownerName, ownerEmail, ownerPhone).run();
    }
    await c.env.DB.prepare(
      `INSERT INTO memberships (id, user_id, account_id, role) VALUES (?, ?, ?, 'admin')`
    ).bind(uid(), ownerId, id).run();
  }

  if (plan === "scale") {
    syncHostnameAfter(c, { id, subdomain, plan }, { reason: "platform_create" });
  }

  await auditPlatform(c.env, staff, id, "account_created",
    `${staff.name} created this account`, { name, subdomain, plan, ownerEmail: ownerEmail || null });

  return c.json({ id, name, subdomain, kind, plan, billing, trades, ownerId }, 201);
});

// Plan and account type, from the console. Deliberately does NOT touch
// Stripe: moving somebody to Scale here grants the features without charging
// for them, which is what "comped" means and is sometimes exactly right --
// but it must be a decision somebody made, and the subscription_events row
// says so in those words.
app.patch("/api/platform/accounts/:id", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;

  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const account = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first();
  if (!account) return c.json({ error: "not_found" }, 404);

  const sets = [], vals = [];
  if (b.name != null) { sets.push("name = ?"); vals.push(String(b.name).trim()); }
  if (b.kind != null) {
    if (!ACCOUNT_KINDS.includes(b.kind)) return c.json({ error: "invalid_kind" }, 400);
    sets.push("kind = ?"); vals.push(b.kind);
  }
  if (b.plan != null) {
    if (!["basic", "scale"].includes(b.plan)) return c.json({ error: "invalid_plan" }, 400);
    sets.push("plan = ?"); vals.push(b.plan);
  }
  // Comping is the one plan change that is a decision rather than a
  // consequence, so it carries a note: a comp nobody can explain becomes
  // permanent, because nobody can tell whether it still applies.
  if (b.comped !== undefined) {
    const on = !!b.comped;
    const note = String(b.compNote || "").trim().slice(0, 300);
    if (on && !note) return c.json({ error: "reason_required" }, 400);
    sets.push("comped = ?"); vals.push(on ? 1 : 0);
    sets.push("comp_note = ?"); vals.push(on ? note : null);
    // Granting one sets the plan; withdrawing one hands the account back to
    // whatever Stripe thinks, which is Basic unless they are actually paying.
    if (on) { sets.push("plan = ?"); vals.push("scale"); }
    else if (b.plan == null) {
      sets.push("plan = ?");
      vals.push(ENTITLED.has(account.subscription_status || "") ? "scale" : "basic");
    }
  }
  if (b.billing != null) {
    if (!["monthly", "annual"].includes(b.billing)) return c.json({ error: "invalid_billing" }, 400);
    sets.push("billing = ?"); vals.push(b.billing);
  }
  if (!sets.length) return c.json({ error: "nothing_to_change" }, 400);

  vals.push(id);
  await c.env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();

  // A comp earns no revenue, so its delta is zero -- counting one as MRR
  // would inflate the number that decides whether this business works.
  const nextPlan = b.comped ? "scale" : b.plan;
  if (nextPlan && nextPlan !== account.plan) {
    const monthly = (b.billing || account.billing) === "annual" ? 8250 : 9900;
    const comping = b.comped !== undefined;
    await c.env.DB.prepare(
      `INSERT INTO subscription_events (id, account_id, at, kind, from_plan, to_plan, cycle, mrr_delta_cents, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'platform_admin')`
    ).bind(uid(), id, new Date().toISOString(),
      comping ? "comped" : (nextPlan === "scale" ? "upgraded" : "downgraded"),
      account.plan, nextPlan, b.billing || account.billing,
      comping ? 0 : (nextPlan === "scale" ? monthly : -monthly)).run();
  }

  // Comping an account is an upgrade as far as its address is concerned:
  // somebody was given Scale, and Scale includes their own hostname.
  if (nextPlan && nextPlan !== account.plan) {
    syncHostnameAfter(c, { id, subdomain: account.subdomain, plan: nextPlan }, { reason: "platform_patch" });
  }

  const changed = Object.entries(b).map(([k, v]) => `${k} → ${v}`).join(", ");
  await auditPlatform(c.env, staff, id, "plan_changed", `${staff.name} changed ${changed}`, b);
  return c.json({ ok: true });
});

// Irreversible, so the caller has to name the thing it is deleting. That is
// not ceremony: it is what stops a stale id, a mis-tapped row or a copied
// curl from removing a customer nobody meant to touch.
app.delete("/api/platform/accounts/:id", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;

  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const account = await c.env.DB.prepare(`SELECT id, name, subdomain FROM accounts WHERE id = ?`).bind(id).first();
  if (!account) return c.json({ error: "not_found" }, 404);
  if (String(b.confirmName || "").trim() !== account.name) {
    return c.json({ error: "confirm_name_mismatch" }, 400);
  }

  // Audited before the row goes, because the audit references it.
  await auditPlatform(c.env, staff, id, "account_deleted",
    `${staff.name} deleted account ${account.name}`, { name: account.name });

  // Before the row goes too: once it is gone there is nothing left to say
  // which hostname belonged to it, and an orphaned CNAME pointing at the app
  // is how a deleted customer's address keeps answering.
  if (account.subdomain && hostnameConfig(c.env)) {
    try { await deprovisionHostname(c.env, account.subdomain); }
    catch (err) { console.error("[hostname] delete:", account.subdomain, err?.message || err); }
  }

  // Rows that point at the account but carry no cascade of their own. The
  // rest (memberships, engagements, jobs, properties, invites) cascade.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE activity SET account_id = NULL WHERE account_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE events SET account_id = NULL WHERE account_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM accounts WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/platform/companies", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;

  const b = await c.req.json().catch(() => ({}));
  const company = String(b.company || "").trim();
  if (!company) return c.json({ error: "company_required" }, 400);
  if (b.email && !EMAIL_RE.test(String(b.email).trim())) return c.json({ error: "invalid_email" }, 400);
  const phone = String(b.phone || "").trim() ? normalizePhone(b.phone) : null;
  if (b.phone && String(b.phone).trim() && !phone) return c.json({ error: "invalid_phone" }, 400);

  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO companies (id, company, contact, phone, email, license, ubi, city, state, zip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, company, b.contact || null, phone, b.email || null, b.license || null,
    b.ubi || null, b.city || null, b.state || null, b.zip || null).run();
  await auditPlatform(c.env, staff, null, "company_created",
    `${staff.name} created company ${company}`, { companyId: id });

  return c.json({ id, company }, 201);
});

// Support work, so standard staff can do it: a wrong phone number on a
// contractor is the sort of thing that should not need a superadmin.
app.patch("/api/platform/companies/:id", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;

  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const co = await c.env.DB.prepare(`SELECT id, company FROM companies WHERE id = ?`).bind(id).first();
  if (!co) return c.json({ error: "not_found" }, 404);

  const allowed = { company: "company", contact: "contact", email: "email", license: "license",
    ubi: "ubi", city: "city", state: "state", zip: "zip" };
  const sets = [], vals = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (b[key] === undefined) continue;
    if (key === "email" && b.email && !EMAIL_RE.test(String(b.email).trim())) {
      return c.json({ error: "invalid_email" }, 400);
    }
    sets.push(`${column} = ?`); vals.push(b[key] === "" ? null : b[key]);
  }
  if (b.phone !== undefined) {
    const phone = String(b.phone || "").trim() ? normalizePhone(b.phone) : null;
    if (String(b.phone || "").trim() && !phone) return c.json({ error: "invalid_phone" }, 400);
    sets.push("phone = ?"); vals.push(phone);
  }
  if (!sets.length) return c.json({ error: "nothing_to_change" }, 400);

  vals.push(id);
  await c.env.DB.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  await auditPlatform(c.env, staff, null, "company_edited",
    `${staff.name} edited ${co.company}`, { companyId: id, fields: Object.keys(b) });
  return c.json({ ok: true });
});

app.delete("/api/platform/companies/:id", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;

  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const co = await c.env.DB.prepare(`SELECT id, company FROM companies WHERE id = ?`).bind(id).first();
  if (!co) return c.json({ error: "not_found" }, 404);
  if (String(b.confirmName || "").trim() !== co.company) {
    return c.json({ error: "confirm_name_mismatch" }, 400);
  }

  await auditPlatform(c.env, staff, null, "company_deleted",
    `${staff.name} deleted company ${co.company}`, { companyId: id, name: co.company });
  await c.env.DB.prepare(`DELETE FROM companies WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// Which settings this Worker actually has. Names only, never values: the
// question is "is it set", and a console that prints secrets is a console
// that leaks them into the next screenshot somebody sends for help.
app.get("/api/platform/setup-check", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;
  return c.json(setupCheck(c.env));
});

// Every mail this account has been sent, and whether it went. The schema
// has recorded this from the start and nothing ever showed it, so "did they
// get the email?" was answered by guessing.
app.get("/api/platform/accounts/:id/mail", async (c) => {
  const { error } = await requireStaff(c);
  if (error) return error;
  const { results } = await c.env.DB.prepare(
    `SELECT id, to_email, kind, subject, status, error, at FROM email_log
      WHERE account_id = ? ORDER BY at DESC LIMIT 25`
  ).bind(c.req.param("id")).all();
  return c.json(results.map((r) => ({
    id: r.id, to: r.to_email, kind: r.kind, subject: r.subject,
    status: r.status, error: r.error, at: r.at,
  })));
});

// Which of the four Cloudflare settings is wrong, when one of them is.
// Read-only: every probe is a GET, so this is safe to hit repeatedly while
// somebody is fixing a value in the dashboard.
app.get("/api/platform/hostname-check", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;
  return c.json(await diagnose(c.env));
});

// Re-run provisioning for one account, now. The sweep gets there on its own
// within ten minutes; this is for the support call where that is ten minutes
// too long, and for reading back exactly what Cloudflare said.
app.post("/api/platform/accounts/:id/hostname", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  const denied = requireSuperadmin(c, staff);
  if (denied) return denied;
  if (!hostnameConfig(c.env)) return c.json({ error: "cloudflare_not_configured" }, 501);

  const account = await c.env.DB.prepare(
    `SELECT id, name, subdomain, plan FROM accounts WHERE id = ?`).bind(c.req.param("id")).first();
  if (!account) return c.json({ error: "not_found" }, 404);

  const res = await syncHostname(c.env, account, { reason: "platform_retry" });
  await auditPlatform(c.env, staff, account.id, "hostname_sync",
    `${staff.name} re-ran hostname setup for ${account.subdomain} — ${res?.status || "no change"}`,
    { subdomain: account.subdomain, status: res?.status || null, error: res?.error || null });

  return c.json({
    status: res?.status || null,
    error: res?.error || null,
    host: res?.host || null,
    checkedAt: new Date().toISOString(),
  });
});

app.post("/api/platform/accounts/:id/users", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;

  const accountId = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const role = ["admin", "pm", "contractor"].includes(b.role) ? b.role : "pm";
  if (!name) return c.json({ error: "name_required" }, 400);
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 400);

  const account = await c.env.DB.prepare(`SELECT id FROM accounts WHERE id = ?`).bind(accountId).first();
  if (!account) return c.json({ error: "not_found" }, 404);

  // Somebody may already exist here from an application or another account;
  // reuse the person rather than creating a second row for the same address.
  let user = await c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).bind(email).first();
  if (!user) {
    const userId = uid();
    await c.env.DB.prepare(`INSERT INTO users (id, name, email) VALUES (?, ?, ?)`)
      .bind(userId, name, email).run();
    user = { id: userId };
  }
  const existing = await c.env.DB.prepare(
    `SELECT id FROM memberships WHERE user_id = ? AND account_id = ?`).bind(user.id, accountId).first();
  if (existing) return c.json({ error: "already_a_member" }, 409);

  await c.env.DB.prepare(
    `INSERT INTO memberships (id, user_id, account_id, role) VALUES (?, ?, ?, ?)`
  ).bind(uid(), user.id, accountId, role).run();
  await auditPlatform(c.env, staff, accountId, "user_added",
    `${staff.name} added ${name} as ${role}`, { userId: user.id, email, role });

  return c.json({ id: user.id, name, email, role }, 201);
});

// Staff never see or set a password. This starts the same reset the person
// could start themselves, on their behalf -- Supabase sends the mail and owns
// the token, so there is nothing here to leak and nothing to expire ourselves.
app.post("/api/platform/users/:id/reset-password", async (c) => {
  const { error, staff } = await requireStaff(c);
  if (error) return error;
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_ANON_KEY) {
    return c.json({ error: "auth_not_configured" }, 501);
  }

  const b = await c.req.json().catch(() => ({}));
  const accountId = b.accountId || null;
  const user = await c.env.DB.prepare(`SELECT id, email, name, auth_id FROM users WHERE id = ?`)
    .bind(c.req.param("id")).first();
  if (!user?.email) return c.json({ error: "not_found" }, 404);

  // Somebody added from the console has no Supabase account yet, and recover
  // on an unknown address succeeds without sending anything -- so one has to
  // be created first or the mail has nowhere to go.
  //
  // Only when there is no evidence of one, though. An auth_id means they have
  // signed in before, and signing them up again would send a confirmation
  // mail nobody asked for and spend a send against the project's hourly
  // limit -- the limit the reset itself needs.
  let created = false, authNote = null;
  if (!user.auth_id) {
    const auth = await ensureAuthUser(c.env, user.email);
    if (auth.ok) {
      created = auth.created;
      if (auth.authId) {
        await c.env.DB.prepare(`UPDATE users SET auth_id = ? WHERE id = ?`)
          .bind(auth.authId, user.id).run();
      }
    } else {
      // Not fatal. The account may well exist already and this may have
      // failed for an unrelated reason -- a send limit, most likely -- in
      // which case recover below still works. Let the recover decide, and
      // keep the reason in case it does not.
      authNote = [auth.error, auth.detail].filter(Boolean).join(": ");
      console.warn("[reset] could not ensure auth user:", user.email, authNote);
    }
  }

  // Send them back to their own company's address when it is live, and to
  // the shared one otherwise. A reset that lands on a generic sign-in page is
  // a worse first impression than the problem that caused it, and landing on
  // a branded hostname that is not serving yet is worse still.
  const acct = accountId
    ? await c.env.DB.prepare(`SELECT subdomain, hostname_status FROM accounts WHERE id = ?`)
        .bind(accountId).first().catch(() => null)
    : null;
  const redirectTo = acct?.hostname_status === "active"
    ? `https://${acct.subdomain}.${(c.env.APP_DOMAIN || "subsub.work")}`
    : `https://app.${(c.env.APP_DOMAIN || "subsub.work")}`;

  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: c.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: user.email, redirect_to: redirectTo }),
  }).catch(() => null);

  if (!res || !res.ok) {
    // Supabase's own words. "supabase_429" is not something anyone can act
    // on; "email rate limit exceeded" tells you to wait rather than to go
    // looking for a bug.
    let said = null;
    if (res) {
      const body = await res.json().catch(() => null);
      said = body?.msg || body?.error_description || body?.error || null;
    }
    const why = [said || (res ? `HTTP ${res.status}` : "Supabase was unreachable"), authNote]
      .filter(Boolean).join(" · ");
    // A durable record, because "did they get it?" is the first thing anyone
    // asks and a message in a panel is gone the moment the page is closed.
    await logMail(c.env, {
      accountId, companyId: null, to: user.email, kind: "password_reset",
      subject: "Password reset", sentBy: staff.userId,
      result: { ok: false, error: "supabase", detail: why },
    });
    return c.json({
      error: "reset_failed",
      detail: why,
      // A send limit is worth naming as itself: it is the one failure here
      // that fixes itself, and the answer is to wait rather than to retry.
      rateLimited: !!(res && (res.status === 429 || /rate limit/i.test(said || ""))),
    }, 502);
  }

  await logMail(c.env, {
    accountId, companyId: null, to: user.email,
    kind: "password_reset", subject: "Password reset", sentBy: staff.userId,
    // Supabase accepted it. That is not the same as it arriving, which is
    // why the row says who, when and what was handed over rather than
    // claiming delivery.
    result: { ok: true },
  });
  await auditPlatform(c.env, staff, accountId, "password_reset",
    `${staff.name} sent a password reset to ${user.email}`, { userId: user.id, email: user.email });

  // No link comes back: the token is in the email and nowhere else, which is
  // the property that makes this safe to do on somebody's behalf. `created`
  // says a Supabase account had to be made first, which is worth telling the
  // operator: with confirmation on, that sends a second mail of its own.
  return c.json({ ok: true, email: user.email, created });
});

// ---------------------------------------------------------------------------
// Outbound email
// ---------------------------------------------------------------------------

// Record every attempt, including the failures — "did they get it?" is the
// first thing support asks, and a send that quietly failed is worse than one
// that visibly did.
async function logMail(env, { accountId, companyId, to, kind, subject, result, sentBy }) {
  try {
    await env.DB.prepare(
      `INSERT INTO email_log (id, account_id, company_id, to_email, kind, subject, status, provider_id, error, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), accountId ?? null, companyId ?? null, to, kind, subject,
      result.ok ? "sent" : "failed", result.id ?? null,
      result.ok ? null : [result.error, result.detail].filter(Boolean).join(": "), sentBy ?? null).run();
  } catch (err) {
    console.error("[email_log] write failed:", err?.message || err);
  }
}

// The same for text messages. Segments matter: carriers bill per 160
// characters, not per message, so a long one is several and counting messages
// would understate the bill the console reports.
async function logSms(env, { accountId, companyId, to, kind, result }) {
  try {
    const segments = Math.max(1, Math.ceil(String(result.body || "").length / 160)) || 1;
    await env.DB.prepare(
      `INSERT INTO sms_log (id, account_id, company_id, to_phone, kind, segments, status, provider_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), accountId ?? null, companyId ?? null, to, kind, segments,
      result.ok ? "sent" : "failed", result.id ?? null,
      result.ok ? null : [result.error, result.detail].filter(Boolean).join(": ")).run();
  } catch (err) {
    console.error("[sms_log] write failed:", err?.message || err);
  }
}

// Everything the document-request template needs, fetched once and shared by
// the preview and the send so the two cannot drift.
async function docRequestContext(c, companyId, jobId, trade) {
  const { accountId } = c.get("auth");
  const row = await c.env.DB.prepare(
    `SELECT co.*, en.doc_review FROM companies co
       JOIN engagements en ON en.company_id = co.id AND en.account_id = ?
      WHERE co.id = ?`
  ).bind(accountId, companyId).first();
  if (!row) return null;
  const account = await c.env.DB.prepare(
    `SELECT id, name, subdomain FROM accounts WHERE id = ?`).bind(accountId).first();
  const job = jobId
    ? await c.env.DB.prepare(
        `SELECT id, title, address, area, zip, date FROM jobs WHERE id = ? AND account_id = ?`
      ).bind(jobId, accountId).first()
    : null;
  return {
    company: row, contact: row.contact, docReview: parseJson(row.doc_review, {}),
    job, trade: trade || null, account,
  };
}

// What will be sent, built by the same function that sends it. The admin
// reviews this before pressing send.
app.get("/api/notify/documents/preview", requireRole("admin", "pm"), async (c) => {
  const ctx = await docRequestContext(c, c.req.query("companyId"), c.req.query("jobId"), c.req.query("trade"));
  if (!ctx) return c.json({ error: "not_engaged" }, 404);
  const mail = docRequestEmail(ctx);
  return c.json({
    to: ctx.company.email || null, subject: mail.subject, text: mail.text,
    missing: mail.missing, configured: !!(c.env.RESEND_API_KEY && c.env.MAIL_FROM),
  });
});

app.post("/api/notify/documents", requireRole("admin", "pm"), async (c) => {
  const { accountId, userId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  const ctx = await docRequestContext(c, b.companyId, b.jobId, b.trade);
  if (!ctx) return c.json({ error: "not_engaged" }, 404);

  const to = ctx.company.email;
  if (!to) return c.json({ error: "no_email_on_file" }, 400);

  const mail = docRequestEmail(ctx);
  const result = await sendEmail(c.env, { to, subject: mail.subject, text: mail.text, html: mail.html });
  await logMail(c.env, { accountId, companyId: ctx.company.id, to, kind: "doc_request",
    subject: mail.subject, result, sentBy: userId });

  if (!result.ok) return c.json({ error: result.error, detail: result.detail }, 502);
  await logActivity(c.env, accountId, userId, "email_sent",
    `Requested documents from ${ctx.company.company}`);
  return c.json({ ok: true, to, id: result.id });
});

// What has been sent to this subcontractor, for the account that asks.
app.get("/api/notify/log", async (c) => {
  const { accountId } = c.get("auth");
  const companyId = c.req.query("companyId");
  const { results } = await c.env.DB.prepare(
    `SELECT id, company_id, to_email, kind, subject, status, error, at
       FROM email_log
      WHERE account_id = ?${companyId ? " AND company_id = ?" : ""}
      ORDER BY at DESC LIMIT 100`
  ).bind(...(companyId ? [accountId, companyId] : [accountId])).all();
  return c.json(results.map((r) => ({
    id: r.id, companyId: r.company_id, to: r.to_email, kind: r.kind,
    subject: r.subject, status: r.status, error: r.error, at: r.at,
  })));
});

export default {
  fetch: app.fetch,

  // wrangler.toml declares a nightly Cron Trigger, and until this existed
  // there was no `scheduled` handler for it to call -- the schedule fired
  // and the sweeps never ran. The HTTP routes above stay, because being able
  // to run either one by hand is worth keeping.
  async scheduled(event, env, ctx) {
    // Two schedules, two jobs. A certificate is issued in a couple of
    // minutes, so a customer waiting on their address should not wait until
    // 3am to find out it is live; a state licensing register changes at
    // most daily and there is no reason to hammer it.
    const nightly = event.cron === "0 3 * * *";
    const jobs = nightly
      ? [["hostnames", hostnameSweep], ["licenses", licenseSweep]]
      : [["hostnames", hostnameSweep]];

    ctx.waitUntil((async () => {
      for (const [name, run] of jobs) {
        try {
          console.log(`[cron] ${name}`, JSON.stringify(await run(env)));
        } catch (err) {
          // One sweep failing must not take the other down with it.
          console.error(`[cron] ${name} failed:`, err?.stack || err?.message || err);
        }
      }
    })());
  },
};
