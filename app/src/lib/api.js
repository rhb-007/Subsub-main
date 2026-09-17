// Thin fetch client for the Worker API. Auth is a dev stub for now (see
// worker/index.js header) — the frontend just remembers which user/account
// it logged in as and sends them as headers on every request.

const AUTH_KEY = "subsub.auth";

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
export function setAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}
export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

async function request(path, options = {}) {
  const auth = getAuth();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (auth?.userId) headers["X-User-Id"] = auth.userId;
  if (auth?.accountId) headers["X-Account-Id"] = auth.accountId;

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
  const auth = getAuth();
  const headers = { "Content-Type": file.type || "application/octet-stream" };
  if (auth?.userId) headers["X-User-Id"] = auth.userId;
  if (auth?.accountId) headers["X-Account-Id"] = auth.accountId;

  const res = await fetch(`/api/uploads/${encodeURIComponent(kind)}/${encodeURIComponent(file.name)}`, {
    method: "PUT", headers, body: file,
  });
  if (!res.ok) throw new Error(`upload_failed_${res.status}`);
  return res.json(); // { key }
}

export const api = {
  devLogin: (email) => request("/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),

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
