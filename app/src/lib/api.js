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

async function authHeaders() {
  const auth = getAuth();
  const headers = {};
  if (auth?.accountId) headers["X-Account-Id"] = auth.accountId;

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

  const res = await fetch(`/api${path}`, { ...options, headers });
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

  const res = await fetch(`/api/uploads/${encodeURIComponent(kind)}/${encodeURIComponent(file.name)}`, {
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
  // Self-serve contractor application — joins the account behind `subdomain`.
  // Requires a real Supabase session (authHeaders() supplies the bearer
  // token); call before getMe() so the membership exists by then.
  selfSignup: (subdomain, name) => request("/self-signup", { method: "POST", body: JSON.stringify({ subdomain, name }) }),

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
  getAccount: () => request("/account"),
  // Public — no auth required, used to brand a login screen before signin.
  getAccountBySubdomain: (subdomain) => request(`/account-by-subdomain/${encodeURIComponent(subdomain)}`),
  patchAccount: (patch) => request("/account", { method: "PATCH", body: JSON.stringify(patch) }),

  uploadFile,

  listUniformOrders: () => request("/uniform-orders"),
  createUniformOrder: (order) => request("/uniform-orders", { method: "POST", body: JSON.stringify(order) }),
  decideUniformOrder: (id, status) => request(`/uniform-orders/${id}/decide`, { method: "POST", body: JSON.stringify({ status }) }),

  listServiceCalls: () => request("/service-calls"),
  raiseServiceCall: (call) => request("/service-calls", { method: "POST", body: JSON.stringify(call) }),
  confirmServiceCall: (id, patch) => request(`/service-calls/${id}/confirm`, { method: "POST", body: JSON.stringify(patch || {}) }),
  resolveServiceCall: (id) => request(`/service-calls/${id}/resolve`, { method: "POST" }),
};
