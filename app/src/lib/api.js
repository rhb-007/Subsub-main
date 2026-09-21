// Thin fetch client for the Worker API.
//
// Two auth modes, chosen automatically by whether Supabase is configured
// (see lib/supabaseClient.js):
//   - Real auth (Supabase configured): identity comes from a verified
//     Supabase session JWT, sent as `Authorization: Bearer <token>`. The
//     worker verifies it against Supabase itself — see worker/index.js.
//   - Dev stub (Supabase NOT configured, e.g. local development without
//     .env set): identity is just a trusted `X-User-Id` header. Fine for
//     local testing, never for anything reachable from the internet.
// Either way, `X-Account-Id` is still sent — it's not an identity claim,
// just which of the signed-in person's accounts they're currently acting
// in; the server always re-checks that a real membership backs it up.
import { supabase, supabaseEnabled } from "./supabaseClient";

// Where the API lives.
//
// Locally this stays relative and Vite proxies /api to the worker (see
// vite.config.js). In production the app is served by Pages and the API is a
// Worker on its own hostname, so a relative path would hit the static site and
// 404 — every deployed build must set VITE_API_BASE. The worker sends CORS
// headers for /api/*, and identity travels in an Authorization header rather
// than a cookie, so a cross-origin base is fine.
//
//   VITE_API_BASE=https://api.subsub.work/api
export const API_BASE = (import.meta.env.VITE_API_BASE || "/api").replace(/\/+$/, "");
// A logo is an <img src>, so it needs the same base as every other call.
export const logoUrl = (accountId) => `${API_BASE}/logo/${accountId}`;

// encodeURIComponent(undefined) is the string "undefined", so a missing id
// becomes a perfectly well-formed request for a record that cannot exist --
// and the server answers "no such thing", which reads like the record was
// deleted rather than like the caller forgot to pass one. Fail here instead,
// where the stack still says who called.
const needId = (v, what) => {
  if (v === undefined || v === null || v === "") throw new Error(`missing_${what}`);
  return encodeURIComponent(v);
};

const AUTH_KEY = "subsub.auth";

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
export function setAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}
export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  if (supabaseEnabled) supabase.auth.signOut();
}
// Drop a stored session WITHOUT signing anyone out of Supabase. Ending an
// impersonation must not take the staff member's own login with it -- on the
// console that login is how they got there.
export function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

async function authHeaders() {
  const auth = getAuth();
  const headers = {};
  if (auth?.accountId) headers["X-Account-Id"] = auth.accountId;

  // Staff sitting in a customer's seat. This replaces the identity entirely
  // rather than adding to it: the server takes the account and the person
  // from its own row, so nothing else in this header set can widen what the
  // session reaches. It is sent alongside the rest so a call made before the
  // switch finishes cannot be attributed to the wrong session.
  if (auth?.impersonation) headers["X-Impersonation-Token"] = auth.impersonation;

  if (supabaseEnabled) {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) headers["Authorization"] = `Bearer ${data.session.access_token}`;
  } else if (auth?.userId) {
    headers["X-User-Id"] = auth.userId;
  }
  return headers;
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(await authHeaders()), ...(options.headers || {}) };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `request_failed_${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// File uploads go straight through, not via request() — the body is the
// raw file, not JSON, and Content-Type should be the file's own type.
async function uploadFile(kind, file) {
  const headers = { "Content-Type": file.type || "application/octet-stream", ...(await authHeaders()) };

  const res = await fetch(`${API_BASE}/uploads/${encodeURIComponent(kind)}/${encodeURIComponent(file.name)}`, {
    method: "PUT", headers, body: file,
  });
  if (!res.ok) throw new Error(`upload_failed_${res.status}`);
  return res.json(); // { key }
}

export const api = {
  devLogin: (email) => request("/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),
  // Real-auth equivalent of devLogin: identity comes from the verified
  // bearer token, not a request body — returns the same {user, memberships} shape.
  getMe: () => request("/auth/me"),
  // Public subcontractor application — no session required, since the
  // applicant doesn't have one yet. Creates a bare company + 'invited'
  // engagement + an internal users row on the account behind `subdomain`,
  // so "Already invited? Create your password" on the login page links up
  // by email once they do sign up for real.
  applyToAccount: (subdomain, data) =>
    request(`/apply/${encodeURIComponent(subdomain)}`, { method: "POST", body: JSON.stringify(data) }),

  listSubs: () => request("/subs"),
  addSub: (sub) => request("/subs", { method: "POST", body: JSON.stringify(sub) }),
  patchSub: (companyId, patch) => request(`/subs/${companyId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  verifyLicense: (companyId) => request(`/subs/${companyId}/verify-license`, { method: "POST" }),
  reviewDocument: (companyId, kind, review) =>
    request(`/subs/${companyId}/documents/${kind}/review`, { method: "POST", body: JSON.stringify(review) }),
  uploadDocument: (companyId, kind, fileKey, fileName) =>
    request(`/subs/${companyId}/documents/${kind}`, { method: "POST", body: JSON.stringify({ fileKey, fileName }) }),
  deleteDocument: (companyId, kind) =>
    request(`/subs/${companyId}/documents/${kind}`, { method: "DELETE" }),

  listJobs: () => request("/jobs"),
  listAllBookings: () => request("/jobs/all-bookings"),
  createJob: (job) => request("/jobs", { method: "POST", body: JSON.stringify(job) }),
  patchJob: (jobId, patch) => request(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  // Turns a building owner's or tenant's request into a job that can be assigned.
  approveJob: (jobId) => request(`/jobs/${jobId}/approve`, { method: "POST" }),

  // Tenants. The first two need a signed-in manager; the last two are how
  // somebody holding a link becomes a tenant, before they have any account.
  listTenants: () => request("/tenants"),
  addTenant: (body) => request("/tenants", { method: "POST", body: JSON.stringify(body) }),
  // Up to 25 rows per call; the import screen sends a spreadsheet in batches
  // so a long list cannot time out a single request.
  addTenantsBulk: (rows) => request("/tenants/bulk", { method: "POST", body: JSON.stringify({ rows }) }),
  resendTenantInvite: (userId, channels) =>
    request(`/tenants/${userId}/resend`, { method: "POST", body: JSON.stringify({ channels }) }),
  removeTenant: (userId) => request(`/tenants/${userId}`, { method: "DELETE" }),
  // No auth header to add when signed out; authHeaders() simply returns none,
  // which is how the subcontractor invite lookup above works too.
  lookupTenantInvite: (token) => request(`/tenant-invite/${encodeURIComponent(token)}`),
  acceptTenantInvite: (token, body) =>
    request(`/tenant-invite/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify(body) }),
  completeJob: (jobId) => request(`/jobs/${jobId}/complete`, { method: "POST" }),
  reopenJob: (jobId) => request(`/jobs/${jobId}/reopen`, { method: "POST" }),
  assign: (jobId, details) => request(`/jobs/${jobId}/assign`, { method: "POST", body: JSON.stringify(details) }),
  unassignTrade: (jobId, trade) => request(`/jobs/${jobId}/unassign/${trade}`, { method: "POST" }),
  reissueWorkOrder: (woId, changes) => request(`/work-orders/${woId}/reissue`, { method: "POST", body: JSON.stringify(changes) }),
  respondToWorkOrder: (woId, status) => request(`/work-orders/${woId}/respond`, { method: "POST", body: JSON.stringify({ status }) }),
  setWorkOrderCrew: (woId, crewName) => request(`/work-orders/${woId}/crew`, { method: "POST", body: JSON.stringify({ crewName }) }),
  setWorkOrderSigned: (woId, fileKey) => request(`/work-orders/${woId}/signed`, { method: "POST", body: JSON.stringify({ fileKey }) }),
  rateWorkOrder: (woId, rating) => request(`/work-orders/${woId}/rate`, { method: "POST", body: JSON.stringify({ rating }) }),

  listAccountUsers: () => request("/account-users"),
  addAccountUser: (u) => request("/account-users", { method: "POST", body: JSON.stringify(u) }),
  updateAccountUser: (userId, patch) => request(`/account-users/${userId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeAccountUser: (userId) => request(`/account-users/${userId}`, { method: "DELETE" }),
  // Cancelling happens here rather than in Stripe's hosted portal, which has
  // no embedded form. Always at period end -- they paid for the period.
  cancelSubscription: () => request("/billing/cancel", { method: "POST" }),
  resumeSubscription: () => request("/billing/resume", { method: "POST" }),

  getAccount: () => request("/account"),
  // Public — no auth required, used to brand a login screen before signin.
  getAccountBySubdomain: (subdomain) => request(`/account-by-subdomain/${encodeURIComponent(subdomain)}`),
  patchAccount: (patch) => request("/account", { method: "PATCH", body: JSON.stringify(patch) }),

  // Billing. Checkout and portal both answer with a Stripe URL for the
  // browser to follow — card details never touch this app.
  getBilling: () => request("/billing"),
  // mode "embedded" asks for a session we can mount inside our own page;
  // anything else gets a hosted one to redirect to.
  startCheckout: (cycle, mode) =>
    request("/billing/checkout", { method: "POST", body: JSON.stringify({ cycle, mode }) }),
  billingPortal: () => request("/billing/portal", { method: "POST" }),

  // One-time subcontractor invite links. The first three need a session; the
  // last two are how somebody holding a link uses it, before they have one.
  listInvites: () => request("/invites"),
  createInvite: (label) => request("/invites", { method: "POST", body: JSON.stringify({ label }) }),
  revokeInvite: (id) => request(`/invites/${id}`, { method: "DELETE" }),
  lookupInvite: (token) => request(`/invite/${encodeURIComponent(token)}`),
  acceptInvite: (token, data) =>
    request(`/invite/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify(data) }),

  uploadFile,

  listUniformOrders: () => request("/uniform-orders"),
  createUniformOrder: (order) => request("/uniform-orders", { method: "POST", body: JSON.stringify(order) }),
  decideUniformOrder: (id, status) => request(`/uniform-orders/${id}/decide`, { method: "POST", body: JSON.stringify({ status }) }),

  listServiceCalls: () => request("/service-calls"),
  raiseServiceCall: (call) => request("/service-calls", { method: "POST", body: JSON.stringify(call) }),
  confirmServiceCall: (id, patch) => request(`/service-calls/${id}/confirm`, { method: "POST", body: JSON.stringify(patch || {}) }),
  resolveServiceCall: (id) => request(`/service-calls/${id}/resolve`, { method: "POST" }),

  listProperties: () => request("/properties"),
  createProperty: (p) => request("/properties", { method: "POST", body: JSON.stringify(p) }),
  patchProperty: (id, patch) => request(`/properties/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeProperty: (id) => request(`/properties/${id}`, { method: "DELETE" }),
  // Which properties a vendor is scoped to, for this account only.
  setSubProperties: (companyId, propertyIds) =>
    request(`/subs/${companyId}/properties`, { method: "PUT", body: JSON.stringify({ propertyIds }) }),

  // Email. The body is composed by the server, so the preview and the send are
  // the same text; the client never supplies message content.
  previewDocRequest: ({ companyId, jobId, trade }) => request(
    `/notify/documents/preview?companyId=${encodeURIComponent(companyId)}`
    + (jobId ? `&jobId=${encodeURIComponent(jobId)}` : "")
    + (trade ? `&trade=${encodeURIComponent(trade)}` : "")),
  sendDocRequest: (payload) => request("/notify/documents",
    { method: "POST", body: JSON.stringify(payload) }),
  notifyLog: (companyId) => request("/notify/log"
    + (companyId ? `?companyId=${encodeURIComponent(companyId)}` : "")),

  listChangeOrders: () => request("/change-orders"),
  raiseChangeOrder: (co) => request("/change-orders", { method: "POST", body: JSON.stringify(co) }),
  respondToChangeOrder: (id, status) =>
    request(`/change-orders/${id}/respond`, { method: "POST", body: JSON.stringify({ status }) }),
  getWorkOrderRevised: (woId) => request(`/work-orders/${woId}/revised`),

  // Platform console. Every one of these is refused server-side unless the
  // caller holds a real session AND has a row in `superadmins`; the financial
  // ones additionally require the finance flag.
  platform: {
    me: () => request("/platform/me"),
    bootstrap: () => request("/platform/bootstrap"),
    accounts: () => request("/platform/accounts"),
    companies: () => request("/platform/companies"),
    revenue: () => request("/platform/revenue"),
    health: () => request("/platform/health"),
    activity: (accountId) => request(`/platform/activity/${encodeURIComponent(accountId)}`),
    impersonate: (accountId, reason) =>
      request(`/platform/impersonate/${encodeURIComponent(accountId)}`,
        { method: "POST", body: JSON.stringify({ reason: reason || null }) }),
    // Hand the seat back. Best effort: a session nobody ended still expires
    // on its own, so a failure here is not worth stopping anything for.
    endImpersonation: (token) =>
      request("/impersonation/end", {
        method: "POST", body: JSON.stringify({ token }),
        headers: { "X-Impersonation-Token": token },
      }).catch(() => null),

    // Writes. Deleting takes the name back as confirmation -- the server
    // checks it, so a stale id cannot remove the wrong customer.
    createAccount: (data) => request("/platform/accounts", { method: "POST", body: JSON.stringify(data) }),
    patchAccount: (id, patch) =>
      request(`/platform/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    deleteAccount: (id, confirmName) =>
      request(`/platform/accounts/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ confirmName }) }),

    createCompany: (data) => request("/platform/companies", { method: "POST", body: JSON.stringify(data) }),
    patchCompany: (id, patch) =>
      request(`/platform/companies/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    deleteCompany: (id, confirmName) =>
      request(`/platform/companies/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ confirmName }) }),

    // Which settings the Worker actually has. Names only, never values.
    setupCheck: () => request("/platform/setup-check"),

    // What this account has been sent, and whether it went out.
    mailLog: (accountId) => request(`/platform/accounts/${needId(accountId, "account_id")}/mail`),

    // Read-only: probes each Cloudflare setting and says which one is wrong.
    hostnameCheck: () => request("/platform/hostname-check"),

    // Re-run branded-hostname setup now. The Worker's sweep does this on its
    // own every ten minutes; this is the "don't make me wait" button.
    syncHostname: (accountId) =>
      request(`/platform/accounts/${needId(accountId, "account_id")}/hostname`, { method: "POST" }),

    addUser: (accountId, user) =>
      request(`/platform/accounts/${needId(accountId, "account_id")}/users`,
        { method: "POST", body: JSON.stringify(user) }),
    // Returns only the address it went to. The token lives in the email and
    // nowhere else, which is what makes this safe to do on someone's behalf.
    resetPassword: (userId, accountId) =>
      request(`/platform/users/${needId(userId, "user_id")}/reset-password`,
        { method: "POST", body: JSON.stringify({ accountId: accountId || null }) }),
  },
};
