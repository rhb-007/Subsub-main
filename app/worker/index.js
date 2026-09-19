// SubSub API — Cloudflare Worker (Hono) over D1 + R2.
//
// Auth note: `authMiddleware` below is a DEV STUB. It trusts an
// `X-User-Id`/`X-Account-Id` header pair with no verification at all. This
// is fine for local development and for wiring up the frontend, but it is
// not real authentication — swap it for Clerk/Supabase session verification
// before this API is reachable from the public internet. See DEPLOYMENT.pdf.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { sendEmail, docRequestEmail, workOrderIssuedEmail, applicationReceivedEmail } from "./mail.js";

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
    || c.req.path.startsWith("/api/logo/") || c.req.path.startsWith("/api/cron/") || c.req.path.startsWith("/api/account-by-subdomain/")) return next();

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
async function loginResponse(db, user) {
  const { results: memberships } = await db.prepare(
    `SELECT m.*, a.name as account_name, a.subdomain, a.kind, a.plan, a.billing, a.logo_key,
            a.use_default_mark, a.theme, a.trades
     FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.user_id = ?`
  ).bind(user.id).all();
  return {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    memberships: memberships.map((m) => ({
      accountId: m.account_id, accountName: m.account_name, subdomain: m.subdomain,
      role: m.role, companyId: m.company_id,
      kind: m.kind, plan: m.plan, billing: m.billing, logoKey: m.logo_key, useDefaultMark: !!m.use_default_mark,
      theme: parseJson(m.theme), trades: parseJson(m.trades),
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
    signInUrl: plan === "scale"
      ? `https://${subdomain}.subsub.work`
      : "https://app.subsub.work",
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
  let user = await c.env.DB.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).bind(b.email).first();
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
    id: a.id, name: a.name, subdomain: a.subdomain, kind: a.kind, plan: a.plan, billing: a.billing,
    logoKey: a.logo_key, useDefaultMark: !!a.use_default_mark, theme: parseJson(a.theme),
    // null when nobody has chosen yet -- which is the cue to ask, and is not
    // the same answer as an empty list.
    trades: parseJson(a.trades),
    user: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone } : null,
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
    `SELECT id, name, subdomain, plan, billing, logo_key, use_default_mark, theme FROM accounts WHERE subdomain = ?`
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
async function supabaseSignUp(env, email, password) {
  let res, body;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
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
  return { ok: true, authId: body?.user?.id || body?.id || null, session: !!body?.access_token };
}

const ACCOUNT_KINDS = ["general_contractor", "property_manager", "building_owner", "portfolio_manager"];

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

// Branding/plan/billing for the current account.
app.patch("/api/account", requireRole("admin"), async (c) => {
  const { accountId } = c.get("auth");
  const b = await c.req.json(); // { name, kind, plan, billing, logoKey, useDefaultMark, theme, trades }
  const sets = [], vals = [];
  if (b.name != null) { sets.push("name = ?"); vals.push(b.name); }
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
            en.auto_schedule as en_auto_schedule, en.notes as en_notes,
            (SELECT group_concat(ep.property_id) FROM engagement_properties ep
              WHERE ep.engagement_id = en.id) as en_property_ids
     FROM engagements en JOIN companies co ON co.id = en.company_id
     WHERE en.account_id = ?`
  ).bind(accountId).all();

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
  await logActivity(c.env, accountId, userId, "job_created", `Created job ${b.title}`);
  return c.json({ id }, 201);
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
    `SELECT id, license, state, license_check FROM companies WHERE license IS NOT NULL AND license != ''`
  ).all();

  const flagged = [];
  for (const co of companies) {
    const prevStatus = parseJson(co.license_check)?.status;
    const state = (co.state || "WA").trim().toUpperCase();
    const result = await verifyLicenseForState(state, co.license);
    if (result.status && result.status !== prevStatus) flagged.push({ companyId: co.id, from: prevStatus, to: result.status });
    await storeLicenseCheck(c.env.DB, co.id, state, result);
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
  const { accountId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM properties WHERE account_id = ? ORDER BY name`
  ).bind(accountId).all();
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

async function requireStaff(c) {
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_ANON_KEY) {
    return { error: c.json({ error: "auth_not_configured" }, 501) };
  }
  const authHeader = c.req.header("Authorization");
  const supaUser = await verifySupabaseToken(c.env, authHeader);
  if (!supaUser) return { error: c.json({ error: "unauthorized" }, 401) };

  // Staff sign in through Google Workspace. A password on the same address is
  // refused, so disabling someone in Workspace actually locks them out here.
  // STAFF_ALLOW_PASSWORD exists for break-glass and should not be set in
  // normal operation — see app/README.md.
  const breakGlass = String(c.env.STAFF_ALLOW_PASSWORD || "") === "1";
  if (!breakGlass && !sessionUsedFederatedLogin(decodeJwtClaims(authHeader), supaUser)) {
    return { error: c.json({ error: "sso_required" }, 403) };
  }

  // Anyone with any Google account can complete a Google sign-in, so the
  // Workspace domain is checked here rather than trusted from the `hd` hint
  // sent to Google, which is advisory only.
  const domain = String(c.env.STAFF_EMAIL_DOMAIN || "").trim().toLowerCase();
  const email = String(supaUser.email || "").toLowerCase();
  if (domain && !email.endsWith("@" + domain)) {
    return { error: c.json({ error: "wrong_domain" }, 403) };
  }

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, s.role, s.finance, s.impersonate
       FROM users u JOIN superadmins s ON s.user_id = u.id
      WHERE u.auth_id = ? OR lower(u.email) = lower(?)`
  ).bind(supaUser.id, supaUser.email || "").first();
  // A valid Supabase session is not staff membership. Someone with a customer
  // login must get nothing here.
  if (!row) return { error: c.json({ error: "forbidden" }, 403) };

  return { staff: {
    userId: row.id, name: row.name, email: row.email, role: row.role,
    finance: !!row.finance && row.role === "superadmin",
    impersonate: !!row.impersonate && row.role === "superadmin",
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
      plan: a.plan, billing: a.billing, createdAt: (a.created_at || "").slice(0, 10),
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
  return c.json({ ok: true, accountId, accountName: account.name, actAsUserId: target.user_id });
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

export default app;
