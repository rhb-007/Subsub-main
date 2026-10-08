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
import { shrinkPhoto } from "./photoshrink.js";
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
// The only localStorage write in the app that was not wrapped, and the one
// that matters most: it runs in the middle of enterAccount(), so a throw here
// took the rest of signing in with it -- the seat, the tab and setLoggedIn.
// Private browsing and blocked site data both throw on write. Losing the
// seat means the next visit starts at the sign-in screen; losing the sign-in
// means this one does.
export function setAuth(auth) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
  catch { /* nothing to remember it with; this session still works */ }
}
// Whether a seat was left behind here, answered synchronously so the first
// render can wait rather than guess. See hasStoredSession().
export function hasStoredAuth() {
  const a = getAuth();
  return !!(a?.userId && a?.accountId);
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

// How close to expiry a token stops being worth sending.
//
// Supabase access tokens last an hour. The library refreshes them on a timer
// while the tab is in front; a backgrounded tab gets its timers throttled,
// so the one that matters -- the tab you come back to after lunch -- is
// exactly the one whose token has quietly aged out.
const REFRESH_MARGIN_SECONDS = 120;

// One refresh at a time, shared by everybody waiting.
//
// Signing in fires eight calls at once to hydrate an account. Eight
// simultaneous refreshes against a rotating refresh token is not a slow way
// to refresh -- it is how a perfectly good session gets revoked, because
// seven of them present a token that the first one has already spent.
let refreshInFlight = null;
function refreshOnce() {
  refreshInFlight = refreshInFlight || supabase.auth.refreshSession()
    .then(({ data }) => data?.session || null)
    .catch((err) => { console.warn("[auth] refresh failed:", err?.message || err); return null; })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

// The session to send, refreshed first if it is about to stop working.
async function usableSession() {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: null }));
  const session = data?.session || null;
  if (!session) return null;
  const secondsLeft = (session.expires_at || 0) - Date.now() / 1000;
  if (secondsLeft > REFRESH_MARGIN_SECONDS) return session;
  // Falling back to the old token rather than to nothing: an expired token
  // gets a 401 that request() can retry, where sending none at all gets a
  // 401 that looks exactly like being signed out.
  return (await refreshOnce()) || session;
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
    const session = await usableSession();
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  } else if (auth?.userId) {
    headers["X-User-Id"] = auth.userId;
  }
  return headers;
}

async function request(path, options = {}, retried = false) {
  const headers = { "Content-Type": "application/json", ...(await authHeaders()), ...(options.headers || {}) };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // A single 401 is not proof that a session is over. Far more often it is a
  // token that aged out while the tab sat in the background: the browser
  // throttles the refresh timer, the first call back carries a dead token,
  // and the answer is 401. Treating that as "you are signed out" is what has
  // been ejecting people who never signed out.
  //
  // So: force a refresh and send it again, once. If the second one is also
  // 401, the session really is gone and the caller can act on it.
  //
  // Only request() bodies get replayed, and those are always JSON strings.
  // uploadFile() sends a stream and does not come through here, which is
  // just as well -- a stream cannot be sent twice.
  if (res.status === 401 && supabaseEnabled && !retried) {
    const session = await refreshOnce();
    if (session?.access_token) return request(path, options, true);
  }

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

// A file PUT straight at a route that consumes it -- a signed lien waiver is
// hashed from its bytes on the way in, so it is never staged under a key the
// client then names. Errors carry the body, like request(), so a screen can
// say "that is not a PDF" rather than "upload failed".
async function putFile(path, file) {
  const headers = { "Content-Type": file.type || "application/octet-stream", ...(await authHeaders()) };
  const res = await fetch(`${API_BASE}${path}`, { method: "PUT", headers, body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `upload_failed_${res.status}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
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

  // "I cannot get in." Public, because nobody calling it has a session, and it
  // replaces calling Supabase's recover straight from the browser: that
  // endpoint can only send a password reset, and two of the three reasons
  // somebody is stuck here are not a forgotten password at all -- a users row
  // with no Supabase login behind it, and an invited subcontractor who never
  // opened their link and so has no login to reset. The Worker knows which,
  // does the right one, and answers the same either way.
  //
  // `origin` so a branded sign-in page gets the link back to itself; the
  // Worker refuses anything that is not a subsub.work address.
  passwordHelp: (email) =>
    request("/password-help", { method: "POST",
      body: JSON.stringify({ email, origin: window.location.origin }) }),

  listSubs: () => request("/subs"),
  addSub: (sub) => request("/subs", { method: "POST", body: JSON.stringify(sub) }),
  patchSub: (companyId, patch) => request(`/subs/${companyId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  verifyLicense: (companyId) => request(`/subs/${companyId}/verify-license`, { method: "POST" }),
  reviewDocument: (companyId, kind, review) =>
    request(`/subs/${companyId}/documents/${kind}/review`, { method: "POST", body: JSON.stringify(review) }),
  // A review somebody had to stop halfway through. `draft: null` discards it.
  // It never carries a status -- see the route.
  saveDocDraft: (companyId, kind, draft) =>
    request(`/subs/${companyId}/documents/${kind}/draft`, { method: "PUT", body: JSON.stringify({ draft }) }),
  uploadDocument: (companyId, kind, fileKey, fileName) =>
    request(`/subs/${companyId}/documents/${kind}`, { method: "POST", body: JSON.stringify({ fileKey, fileName }) }),
  deleteDocument: (companyId, kind) =>
    request(`/subs/${companyId}/documents/${kind}`, { method: "DELETE" }),

  // Removing somebody ENDS the engagement and deletes nothing: `companies` is
  // a shared row, and the job history has to survive the question "were they
  // insured on the day of that job". The check runs first so the modal can
  // name what is still booked -- it never blocks.
  engagementEndCheck: (companyId) => request(`/subs/${companyId}/end-check`),
  endEngagement: (companyId, status = "ended") =>
    request(`/subs/${companyId}/end`, { method: "POST", body: JSON.stringify({ status }) }),

  // Subcontractor agreements. An agreement is between TWO PARTIES, so it is
  // keyed on the pair and not on the company -- see shared/agreement.js.
  agreementTerms: () => request("/agreement-terms"),
  saveAgreementTerms: (patch) =>
    request("/agreement-terms", { method: "PATCH", body: JSON.stringify(patch) }),
  subAgreement: (companyId) => request(`/subs/${companyId}/agreement`),
  issueAgreement: (companyId, body = {}) =>
    request(`/subs/${companyId}/agreement`, { method: "POST", body: JSON.stringify(body) }),
  countersignAgreement: (id, typedName) =>
    request(`/agreements/${id}/countersign`, { method: "POST", body: JSON.stringify({ typedName }) }),
  voidAgreement: (id) => request(`/agreements/${id}/void`, { method: "POST" }),
  // The subcontractor's own, across every client -- the /api/my-work shape,
  // for the same reason: one waiting to be signed on one roster of twenty-five
  // is not something anybody finds by switching account twenty-five times.
  myAgreements: () => request("/my-agreements"),
  signAgreement: (id, typedName) =>
    request(`/my-agreements/${id}/sign`, { method: "POST", body: JSON.stringify({ typedName }) }),
  declineAgreement: (id, note) =>
    request(`/my-agreements/${id}/decline`, { method: "POST", body: JSON.stringify({ note }) }),
  // The document itself. Same shape as reportPhotoBlob and for the same
  // reason: the route needs an Authorization header, and neither an <img
  // src>, an <iframe src> nor an <a href> can carry one. So the bytes come
  // back through the same client as every other call and go on the page as a
  // blob URL, which a link, a frame and a download button can all use.
  //
  // The content type is handed back with it. A certificate is as often a
  // photograph of one as it is a PDF, and the viewer has to know which it is
  // holding before it can draw it.
  documentBlob: async (companyId, kind) => {
    const res = await fetch(`${API_BASE}/subs/${companyId}/documents/${kind}/file`,
      { headers: await authHeaders() });
    if (!res.ok) {
      let code = `doc_${res.status}`;
      try { code = (await res.json())?.error || code; } catch { /* not json */ }
      throw new Error(code);
    }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), type: blob.type || "", size: blob.size };
  },

  listJobs: () => request("/jobs"),
  listAllBookings: () => request("/jobs/all-bookings"),
  createJob: (job) => request("/jobs", { method: "POST", body: JSON.stringify(job) }),
  patchJob: (jobId, patch) => request(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  // Turns a building owner's or tenant's request into a job that can be assigned.
  approveJob: (jobId) => request(`/jobs/${jobId}/approve`, { method: "POST" }),
  // Saying no to a request, with the reason the person who asked will see.
  declineJob: (jobId, note) => request(`/jobs/${jobId}/decline`, { method: "POST", body: JSON.stringify({ note }) }),
  // A tenant's own report: taken back, or corrected within ten minutes.
  withdrawReport: (jobId, note) => request(`/jobs/${jobId}/withdraw`, { method: "POST", body: JSON.stringify({ note }) }),
  editReport: (jobId, body) => request(`/jobs/${jobId}/report`, { method: "PATCH", body: JSON.stringify(body) }),

  // Photos on a report. Uploading is two steps on purpose: the bytes go to
  // R2 first and the report is told about them after, so a failed upload
  // leaves a report with one fewer photo rather than a row pointing at
  // something that is not there.
  // Shrunk on the way up -- see lib/photoshrink.js. Both doors that take a
  // photograph (a tenant's report and an inspection room) come through here,
  // so neither can be the one that still sends twelve megabytes.
  uploadReportPhoto: async (file) => uploadFile("report-photo", await shrinkPhoto(file)),
  addReportPhotos: (jobId, photos) =>
    request(`/jobs/${jobId}/photos`, { method: "POST", body: JSON.stringify({ photos }) }),
  removeReportPhoto: (jobId, photoId) =>
    request(`/jobs/${jobId}/photos/${photoId}`, { method: "DELETE" }),
  // An <img> tag cannot send an Authorization header, so the bytes are
  // fetched like any other call and handed to the page as a blob URL. The
  // caller owns revoking it -- see ReportPhoto in App.tsx.
  reportPhotoBlob: async (jobId, photoId) => {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/photos/${photoId}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`photo_${res.status}`);
    return URL.createObjectURL(await res.blob());
  },

  // Move-in and move-out unit inspections. Every one of these resolves the
  // inspection through one check on the server -- the account AND the seat's
  // property scope -- so there is nothing to narrow here.
  listInspections: () => request("/inspections"),
  createInspection: (body) => request("/inspections", { method: "POST", body: JSON.stringify(body) }),
  getInspection: (id) => request(`/inspections/${id}`),
  patchInspection: (id, body) => request(`/inspections/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  reopenInspection: (id, reason) => request(`/inspections/${id}/reopen`, { method: "POST", body: JSON.stringify({ reason }) }),
  removeInspection: (id) => request(`/inspections/${id}`, { method: "DELETE" }),
  addInspectionRoom: (id, name) =>
    request(`/inspections/${id}/rooms`, { method: "POST", body: JSON.stringify({ name }) }),
  patchInspectionRoom: (id, roomId, body) =>
    request(`/inspections/${id}/rooms/${roomId}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeInspectionRoom: (id, roomId) =>
    request(`/inspections/${id}/rooms/${roomId}`, { method: "DELETE" }),
  // The bytes go up through the same checked upload kind a tenant's report
  // photo uses -- one set of type and size limits, not two.
  addInspectionPhotos: (id, roomId, photos) =>
    request(`/inspections/${id}/rooms/${roomId}/photos`, { method: "POST", body: JSON.stringify({ photos }) }),
  removeInspectionPhoto: (id, roomId, photoId) =>
    request(`/inspections/${id}/rooms/${roomId}/photos/${photoId}`, { method: "DELETE" }),
  inspectionPhotoBlob: async (id, photoId) => {
    const res = await fetch(`${API_BASE}/inspections/${id}/photos/${photoId}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`photo_${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  // One caption, saved on blur like the room's own note. This is the only
  // route that turns a draft into the record -- nothing promotes one by
  // itself.
  captionInspectionPhoto: (id, roomId, photoId, caption) =>
    request(`/inspections/${id}/rooms/${roomId}/photos/${photoId}`,
      { method: "PATCH", body: JSON.stringify({ caption }) }),
  // Drafting the notes for a room. The pictures travel downscaled -- see
  // `jpegForDraft` in App.tsx and `DRAFT_LONG_EDGE` in shared/photodraft.js
  // -- because Claude bills a photograph by area and a full-size phone
  // picture costs four times as much for detail nobody needs.
  draftInspectionPhotos: (id, roomId, photos) =>
    request(`/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: JSON.stringify({ photos }) }),
  raiseInspectionJob: (id, body) =>
    request(`/inspections/${id}/job`, { method: "POST", body: JSON.stringify(body) }),
  // REWRITING THE WORK ORDER'S SUMMARY. There is no call to write the first
  // one: raising the job does that, because the ask was for it to happen
  // automatically. This is the way out of the two states that leaves behind --
  // a call that failed, and notes that have changed since.
  summariseInspection: (id) =>
    request(`/inspections/${id}/summary`, { method: "POST" }),
  // WHAT THE PERSON TURNING UP IS SHOWN. Keyed by the WORK ORDER, never by the
  // inspection: there is no route that takes an inspection id and describes it
  // to a contractor, so nothing here can be walked. The server answers the
  // flagged rooms, their notes, the kept captions and the photo ids, and
  // refuses a work order this company does not hold.
  woInspection: (woId) => request(`/work-orders/${woId}/inspection`),
  // What each trade on this job is being asked to price, composed from the
  // inspection behind it. An empty map is the ordinary answer for a job
  // nobody walked, so callers never branch on an error for it.
  jobTradeScope: (jobId) => request(`/jobs/${jobId}/trade-scope`),
  woInspectionPhotoBlob: async (woId, photoId) => {
    const res = await fetch(`${API_BASE}/work-orders/${woId}/inspection/photo/${photoId}`,
      { headers: await authHeaders() });
    if (!res.ok) throw new Error(`photo_${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  // To the building's owners, by seat id. The server intersects them with the
  // owners of that building, so an id here is a request rather than a
  // recipient.
  sendInspection: (id, userIds) =>
    request(`/inspections/${id}/send`, { method: "POST", body: JSON.stringify({ userIds }) }),

  // Tenants. The first two need a signed-in manager; the last two are how
  // somebody holding a link becomes a tenant, before they have any account.
  listTenants: () => request("/tenants"),
  // 072. A tenant's own contact details on this account, and the notices
  // posted to buildings. The contact route takes no id: it is always the
  // caller's own row.
  myContact: () => request("/me/contact"),
  saveMyContact: (body) => request("/me/contact", { method: "PUT", body: JSON.stringify(body) }),
  listNotices: () => request("/notices"),
  postNotice: (body) => request("/notices", { method: "POST", body: JSON.stringify(body) }),
  removeNotice: (id) => request(`/notices/${id}`, { method: "DELETE" }),
  addTenant: (body) => request("/tenants", { method: "POST", body: JSON.stringify(body) }),
  // Up to 25 rows per call; the import screen sends a spreadsheet in batches
  // so a long list cannot time out a single request.
  addTenantsBulk: (rows) => request("/tenants/bulk", { method: "POST", body: JSON.stringify({ rows }) }),
  // What is about to be sent, before it is sent: the wording, and whether
  // there is still an invite outstanding.
  getTenantInvite: (userId) => request(`/tenants/${userId}/invite`),
  patchTenant: (userId, body) =>
    request(`/tenants/${userId}`, { method: "PATCH", body: JSON.stringify(body) }),
  revokeTenantInvite: (userId) => request(`/tenants/${userId}/revoke`, { method: "POST" }),
  // `body` carries the channels and, when the manager has changed it, the
  // subject, the email and the text message.
  resendTenantInvite: (userId, body = {}) =>
    request(`/tenants/${userId}/resend`, { method: "POST", body: JSON.stringify(body) }),
  removeTenant: (userId) => request(`/tenants/${userId}`, { method: "DELETE" }),
  // No auth header to add when signed out; authHeaders() simply returns none,
  // which is how the subcontractor invite lookup above works too.
  lookupTenantInvite: (token) => request(`/tenant-invite/${encodeURIComponent(token)}`),
  acceptTenantInvite: (token, body) =>
    request(`/tenant-invite/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify(body) }),
  completeJob: (jobId) => request(`/jobs/${jobId}/complete`, { method: "POST" }),
  // 066. Cancel, put on hold, or close out with nothing done. One route for
  // the three, because they share the money boundary, the standing-down and
  // the append-only row.
  // What ending it would stand down, asked before the modal opens -- the same
  // shape and reason as the roster's own end-check.
  jobEndCheck: (jobId) => request(`/jobs/${jobId}/end-check`),
  endJob: (jobId, body) => request(`/jobs/${jobId}/end`,
    { method: "POST", body: JSON.stringify(body) }),
  resumeJob: (jobId, note) => request(`/jobs/${jobId}/resume`,
    { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
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
  // A face. Behind auth and scoped to a shared account, so it arrives the
  // same way a report photo does -- fetched like any other call and handed
  // to the page as a blob URL, because an <img> cannot send a bearer token.
  // The caller owns revoking it; see avatarUrl() in App.tsx, which keeps one
  // per person rather than one per row that draws them.
  userAvatarBlob: async (userId) => {
    // no-store: the route answers with a five-minute private max-age, so a
    // re-fetch after REPLACING a picture was served the old one from the
    // browser's own cache.
    const res = await fetch(`${API_BASE}/account-users/${encodeURIComponent(userId)}/avatar`,
      { headers: await authHeaders(), cache: "no-store" });
    if (!res.ok) throw new Error(`avatar_${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  // Your own, which any seat may change. Needing to ask an administrator to
  // change your profile picture is not a permission model, it is an errand.
  // Shrunk on the way up like a report photo: a picture straight off an
  // iPad can be a HEIC the server would otherwise store as-is, and a face in
  // a 36px circle does not need twelve megapixels.
  uploadAvatar: async (file) => uploadFile("avatar", await shrinkPhoto(file)),
  setMyAvatar: (avatarKey) => request("/me/avatar", { method: "PATCH", body: JSON.stringify({ avatarKey }) }),
  // Cancelling happens here rather than in Stripe's hosted portal, which has
  // no embedded form. Always at period end -- they paid for the period.
  cancelSubscription: () => request("/billing/cancel", { method: "POST" }),
  resumeSubscription: () => request("/billing/resume", { method: "POST" }),

  getAccount: () => request("/account"),
  // One's own notification choices.
  patchMe: (body) => request("/me", { method: "PATCH", body: JSON.stringify(body) }),
  // Public — no auth required, used to brand a login screen before signin.
  getAccountBySubdomain: (subdomain) => request(`/account-by-subdomain/${encodeURIComponent(subdomain)}`),
  patchAccount: (patch) => request("/account", { method: "PATCH", body: JSON.stringify(patch) }),

  // Billing. Checkout and portal both answer with a Stripe URL for the
  // browser to follow — card details never touch this app.
  getBilling: () => request("/billing"),
  // Turn the account's text messages off, or back on (admin).
  setSmsOff: (off) => request("/billing/sms", { method: "PUT", body: JSON.stringify({ off }) }),
  // mode "embedded" asks for a session we can mount inside our own page;
  // anything else gets a hosted one to redirect to.
  startCheckout: (cycle, mode) =>
    request("/billing/checkout", { method: "POST", body: JSON.stringify({ cycle, mode }) }),
  billingPortal: () => request("/billing/portal", { method: "POST" }),

  // One-time subcontractor invite links. The first three need a session; the
  // last two are how somebody holding a link uses it, before they have one.
  // Somebody added to the account itself, setting their password. Public,
  // like the other two invite lookups: they hold a link and no session.
  lookupUserInvite: (token) => request(`/user-invite/${token}`),
  acceptUserInvite: (token, body) =>
    request(`/user-invite/${token}`, { method: "POST", body: JSON.stringify(body) }),
  resendUserInvite: (userId) =>
    request(`/account-users/${userId}/invite`, { method: "POST" }),

  listInvites: () => request("/invites"),
  // Takes an object now: an address means SubSub sends it, a label alone
  // still makes a link for the account to hand over itself.
  createInvite: (body) => request("/invites", { method: "POST",
    body: JSON.stringify(typeof body === "string" || body == null ? { label: body } : body) }),
  // Sends the SAME token again, to the address it was addressed to -- not a
  // new invite. Reissuing would break the link already sitting in somebody's
  // inbox, which is the opposite of what pressing "Send again" means.
  resendInvite: (id) => request(`/invites/${id}/resend`, { method: "POST" }),
  // Correct an invite that has not been accepted yet. Only the keys sent are
  // written, so a form that knows four fields cannot blank a fifth. Replacing
  // an address reissues the token -- the reply says so, because the old link
  // is a live credential and whoever is holding it stops being able to use
  // it.
  updateInvite: (id, body) => request(`/invites/${id}`,
    { method: "PATCH", body: JSON.stringify(body) }),
  // Invite a contractor who is already on the roster to get a login. Started
  // from their record rather than a blank form, so nothing is retyped -- and
  // the invite carries their company id, so redeeming it attaches the seat to
  // that record instead of deduping its way back to it.
  inviteSubToPortal: (companyId, body = {}) =>
    request(`/subs/${encodeURIComponent(companyId)}/invite`,
      { method: "POST", body: JSON.stringify(body) }),
  revokeInvite: (id) => request(`/invites/${id}`, { method: "DELETE" }),
  lookupInvite: (token) => request(`/invite/${encodeURIComponent(token)}`),

  // Connecting to a contractor who is already on SubSub. The first two ask
  // "is this them?" -- by an address somebody typed, or by a code somebody
  // scanned -- and answer with a name and a town, never with an address or
  // a document. The rest are the request itself.
  connectLookup: (q) => request(`/connect/lookup?${new URLSearchParams(q)}`),
  connectByCode: (code) => request(`/connect/code/${encodeURIComponent(code)}`),
  requestConnect: (body) => request("/connect-requests", { method: "POST", body: JSON.stringify(body) }),
  listConnectRequests: () => request("/connect-requests"),
  cancelConnectRequest: (id) => request(`/connect-requests/${id}`, { method: "DELETE" }),
  // The contractor's own side: their code, and who has asked for them.
  // Scoped by their company rather than by the account header, because a
  // request comes from an account they are not in yet.
  // The company this ACCOUNT is: what another general contractor sees when
  // they look you up, and the details that make you findable at all.
  // Decoration for the dashboard greeting. Answers {} for anything that goes
  // wrong, including an account with no city on it, so callers never branch.
  weather: () => request("/weather"),
  myCompany: () => request("/my-company"),
  saveMyCompany: (patch) => request("/my-company", { method: "PATCH", body: JSON.stringify(patch) }),

  // Getting paid. `payoutConnect` returns a one-time Stripe URL to follow --
  // single-use and short-lived, so it is never held in state; and
  // `payoutRefresh` is what the return from Stripe calls, because coming
  // back proves nothing about whether they finished.
  // Managing the subscription without leaving. Stripe's billing portal is a
  // hosted page with no embedded equivalent, so what it did -- the card, the
  // invoices -- is done here instead. `billingPortal` remains only as the
  // way through when these cannot be reached.
  billingCard: () => request("/billing/card"),
  billingCardSetup: () => request("/billing/card-setup", { method: "POST" }),
  billingCardConfirm: (setupIntentId) =>
    request("/billing/card-confirm", { method: "POST", body: JSON.stringify({ setupIntentId }) }),
  billingInvoices: () => request("/billing/invoices"),

  payoutStatus: () => request("/payouts/status"),
  // The embedded door. Mints the connected account on first call, so the
  // panel asks for this on mount rather than offering a button that means
  // "start using plumbing".
  payoutSession: () => request("/payouts/session", { method: "POST" }),
  // And the way through when the embedded component cannot load at all.
  payoutConnect: () => request("/payouts/connect", { method: "POST" }),
  payoutRefresh: () => request("/payouts/refresh", { method: "POST" }),
  // The keys an account's CRM authenticates with. `create` is the only call
  // that ever returns a token, because nothing stored could answer a read --
  // what is in the database is a SHA-256 of it.
  apiTokens: () => request("/api-tokens"),
  createApiToken: (name) => request("/api-tokens", { method: "POST", body: JSON.stringify({ name }) }),
  revokeApiToken: (id) => request(`/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // What a CRM's own words mean in SubSub trades, and the words that have
  // arrived meaning nothing yet. One call, because the screen shows both and
  // two fetches would let the queue and the rules disagree for a frame.
  crmRules: () => request("/crm-rules"),
  saveCrmRule: (rule) => request("/crm-rules", { method: "POST", body: JSON.stringify(rule) }),
  removeCrmRule: (id) => request(`/crm-rules/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // The condition dictionary for inspections posted in from an inspection app.
  // A separate list from the trade rules above: a trade rule says what work a
  // job is, this says what a room's condition word means.
  inspectionRules: () => request("/inspection-rules"),
  saveInspectionRule: (rule) =>
    request("/inspection-rules", { method: "POST", body: JSON.stringify(rule) }),
  removeInspectionRule: (id) =>
    request(`/inspection-rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Milestones, verification and release. The plan call returns the parts,
  // the event log and the releases together: a screen that fetches three
  // renders three different moments.
  woPlan: (woId) => request(`/work-orders/${needId(woId, "work_order")}/plan`),
  setWoPlan: (woId, milestones) =>
    request(`/work-orders/${needId(woId, "work_order")}/plan`,
      { method: "PUT", body: JSON.stringify({ milestones }) }),
  setWoScope: (woId, patch) =>
    request(`/work-orders/${needId(woId, "work_order")}/scope`,
      { method: "PATCH", body: JSON.stringify(patch) }),
  reachMilestone: (id, body) =>
    request(`/milestones/${needId(id, "milestone")}/reach`, { method: "POST", body: JSON.stringify(body || {}) }),
  verifyMilestone: (id) =>
    request(`/milestones/${needId(id, "milestone")}/verify`, { method: "POST", body: "{}" }),
  rejectMilestone: (id, reason) =>
    request(`/milestones/${needId(id, "milestone")}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  releaseWaiverState: (id) => request(`/releases/${needId(id, "release")}/waiver-state`),
  releaseCoverState: (id) => request(`/releases/${needId(id, "release")}/cover-state`),
  // Lien waivers. The paying side asks against a release; the side being
  // paid signs in the app, by link, or by uploading the signed form. See
  // shared/waiverform.js for which states allow which.
  releaseWaivers: (id) => request(`/releases/${needId(id, "release")}/waivers`),
  requestWaiver: (id, body) =>
    request(`/releases/${needId(id, "release")}/waiver`, { method: "POST", body: JSON.stringify(body || {}) }),
  resendWaiver: (id) => request(`/waivers/${needId(id, "waiver")}/resend`, { method: "POST", body: "{}" }),
  voidWaiver: (id) => request(`/waivers/${needId(id, "waiver")}/void`, { method: "POST", body: "{}" }),
  recordWaiverCopy: (id, file) =>
    putFile(`/waivers/${needId(id, "waiver")}/file/${encodeURIComponent(file.name)}`, file),
  waiverFileBlob: async (id) => {
    const res = await fetch(`${API_BASE}/waivers/${needId(id, "waiver")}/file`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`waiver_file_${res.status}`);
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), type: blob.type };
  },
  myWaivers: () => request("/my-waivers"),
  signMyWaiver: (id, body) =>
    request(`/my-waivers/${needId(id, "waiver")}/sign`, { method: "POST", body: JSON.stringify(body) }),
  declineMyWaiver: (id, note) =>
    request(`/my-waivers/${needId(id, "waiver")}/decline`, { method: "POST", body: JSON.stringify({ note }) }),
  uploadMyWaiver: (id, file, declaration) =>
    putFile(`/my-waivers/${needId(id, "waiver")}/file/${encodeURIComponent(file.name)}?declaration=${encodeURIComponent(JSON.stringify(declaration || {}))}`, file),
  // By link, for somebody with no account. The token is the whole of the auth.
  waiverByToken: (token) => request(`/waiver/${encodeURIComponent(token)}`),
  signWaiverByToken: (token, body) =>
    request(`/waiver/${encodeURIComponent(token)}/sign`, { method: "POST", body: JSON.stringify(body) }),
  declineWaiverByToken: (token, note) =>
    request(`/waiver/${encodeURIComponent(token)}/decline`, { method: "POST", body: JSON.stringify({ note }) }),
  uploadWaiverByToken: (token, file, name, declaration) =>
    putFile(`/waiver/${encodeURIComponent(token)}/file/${encodeURIComponent(file.name)}?name=${encodeURIComponent(name)}&declaration=${encodeURIComponent(JSON.stringify(declaration || {}))}`, file),
  settleRelease: (id, body) =>
    request(`/releases/${needId(id, "release")}/settle`, { method: "POST", body: JSON.stringify(body || {}) }),

  // 051. The funded side. `settle` records money that moved elsewhere; `pay`
  // moves it, and they are two routes for the reason the Worker gives.
  woFunding: (id) => request(`/work-orders/${needId(id, "work order")}/funding`),
  woFund: (id, amountCents) =>
    request(`/work-orders/${needId(id, "work order")}/fund`,
      { method: "POST", body: JSON.stringify({ amountCents }) }),
  woFundConfirm: (id, fundingId) =>
    request(`/work-orders/${needId(id, "work order")}/fund/confirm`,
      { method: "POST", body: JSON.stringify({ fundingId }) }),
  woRefund: (id, amountCents) =>
    request(`/work-orders/${needId(id, "work order")}/refund`,
      { method: "POST", body: JSON.stringify(amountCents ? { amountCents } : {}) }),
  payRelease: (id, body) =>
    request(`/releases/${needId(id, "release")}/pay`, { method: "POST", body: JSON.stringify(body || {}) }),

  myConnectCode: () => request("/connect/code"),
  rotateConnectCode: () => request("/connect/code/rotate", { method: "POST" }),
  myConnectRequests: () => request("/my-connect-requests"),
  // Sending your own paperwork to somebody who asked for it.
  // The other end of a connection: accounts that hire us.
  // `GET /api/clients` is still the correct other half of a connection and the
  // route stays; nothing in the app reads it since the "You work for" strip
  // came off, because the account switcher already names every account that
  // hires you and says what you are to each.
  // Every slot assigned to us, at every client. The portal's job list and its
  // badge both used to read /api/jobs, which is one account at a time.
  myWork: () => request("/my-work"),
  // Asking your own roster to price a trade before you commit to anybody.
  jobQuoteRequests: (jobId) => request(`/jobs/${encodeURIComponent(jobId)}/quote-requests`),
  askForQuotes: (jobId, body) => request(`/jobs/${encodeURIComponent(jobId)}/quote-requests`,
    { method: "POST", body: JSON.stringify(body) }),
  awardQuote: (requestId, companyId) =>
    request(`/quote-requests/${encodeURIComponent(requestId)}/award`,
      { method: "POST", body: JSON.stringify({ companyId }) }),
  cancelQuoteRequest: (requestId) =>
    request(`/quote-requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", body: "{}" }),
  // The other side: what we have been asked to price.
  myQuotes: () => request("/my-quotes"),
  // WHAT WE ARE BEING ASKED TO PRICE, WITH THE PICTURES. Keyed by the INVITE,
  // never by the inspection or the job, so there is nothing here to walk -- and
  // narrowed to the one trade we were asked about, which is the same narrowing
  // the scope text already gets. A 404 is the ordinary answer: most jobs have
  // no walk behind them.
  quoteInspection: (inviteId) =>
    request(`/quotes/${encodeURIComponent(inviteId)}/inspection`),
  quoteInspectionPhotoBlob: async (inviteId, photoId) => {
    const res = await fetch(
      `${API_BASE}/quotes/${encodeURIComponent(inviteId)}/inspection/photo/${encodeURIComponent(photoId)}`,
      { headers: await authHeaders() });
    if (!res.ok) throw new Error(`photo_${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  answerQuote: (inviteId, body) => request(`/quotes/${encodeURIComponent(inviteId)}`,
    { method: "POST", body: JSON.stringify(body) }),
  docShares: () => request("/doc-shares"),
  sendDocPack: (body) => request("/doc-shares", { method: "POST", body: JSON.stringify(body) }),
  revokeDocShare: (id) => request(`/doc-shares/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
  // The public page. No session -- the token is the whole of the auth.
  docPack: (token) => request(`/pack/${encodeURIComponent(token)}`),
  // Keyed by the token they already hold, so there is no second secret and
  // nobody can unsubscribe anybody else.
  stopPackUpdates: (token, all) => request(`/pack/${encodeURIComponent(token)}/stop`,
    { method: "POST", body: JSON.stringify({ all: !!all }) }),
  // Everything sent to one address. Asked for from a pack page and answered by
  // email -- the request names no address, so this takes none.
  askForInbox: (token) => request(`/pack/${encodeURIComponent(token)}/inbox`,
    { method: "POST", body: "{}" }),
  docInbox: (token) => request(`/inbox/${encodeURIComponent(token)}`),
  claimInbox: (token) => request(`/inbox/${encodeURIComponent(token)}/claim`,
    { method: "POST", body: "{}" }),
  // Who is asking, for the account deciding whether to say yes. Keyed by the
  // request, never by the account -- see the note on the route.
  connectAsker: (id) => request(`/my-connect-requests/${encodeURIComponent(id)}/asker`),
  respondConnect: (id, accept) =>
    request(`/my-connect-requests/${id}/respond`, { method: "POST", body: JSON.stringify({ accept }) }),
  acceptInvite: (token, data) =>
    request(`/invite/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify(data) }),

  uploadFile,

  listUniformOrders: () => request("/uniform-orders"),
  createUniformOrder: (order) => request("/uniform-orders", { method: "POST", body: JSON.stringify(order) }),
  decideUniformOrder: (id, status) => request(`/uniform-orders/${id}/decide`, { method: "POST", body: JSON.stringify({ status }) }),

  // Visits: the proposed time for a repair, and the tenant's answer to it.
  listVisits: () => request("/visits"),
  proposeVisit: (jobId, body) => request(`/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify(body) }),
  respondVisit: (id, body) => request(`/visits/${id}/respond`, { method: "POST", body: JSON.stringify(body) }),
  // And, once the window has passed, whether anybody actually turned up.
  visitOutcome: (id, body) => request(`/visits/${id}/outcome`, { method: "POST", body: JSON.stringify(body) }),
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
  previewDocRequest: ({ companyId, jobId, trade, kind }) => request(
    `/notify/documents/preview?companyId=${encodeURIComponent(companyId)}`
    + (jobId ? `&jobId=${encodeURIComponent(jobId)}` : "")
    + (trade ? `&trade=${encodeURIComponent(trade)}` : "")
    // Which document is being talked about. The server picks between the two
    // mails from the findings on this kind, so leaving it off sends the generic
    // "upload your documents" notice about one already on file.
    + (kind ? `&kind=${encodeURIComponent(kind)}` : "")),
  sendDocRequest: (payload) => request("/notify/documents",
    { method: "POST", body: JSON.stringify(payload) }),

  // Asking a contractor to turn auto-schedule on. The account cannot set it
  // for them, so this is the hiring side's only move -- see
  // shared/autoschedule.js.
  previewAutoScheduleRequest: ({ companyId, note }) => request(
    `/notify/auto-schedule/preview?companyId=${encodeURIComponent(companyId)}`
    + (note ? `&note=${encodeURIComponent(note)}` : "")),
  sendAutoScheduleRequest: (payload) => request("/notify/auto-schedule",
    { method: "POST", body: JSON.stringify(payload) }),

  // Overflow. There is deliberately no call here that takes a trade and gives
  // back companies -- see shared/overflow.js. The server decides who a
  // broadcast reaches and never says.
  // Handing a building over. Two-party at every step -- shared/handover.js.
  propertyTransfers: () => request("/property-transfers"),
  requestTransfer: (propertyId, note) => request(
    `/properties/${encodeURIComponent(propertyId)}/transfer`,
    { method: "POST", body: JSON.stringify({ note: note || null }) }),
  // Declaring that this account owns a building of its own. Per building, with
  // a name and a date recorded against it -- see shared/handover.js.
  declareOwnership: (propertyId, own) => request(
    `/properties/${encodeURIComponent(propertyId)}/declare-ownership`,
    { method: "POST", body: JSON.stringify({ own }) }),
  appointManager: (propertyId, subdomain, note) => request(
    `/properties/${encodeURIComponent(propertyId)}/appoint`,
    { method: "POST", body: JSON.stringify({ subdomain, note: note || null }) }),
  decideTransfer: (id, accept) => request(
    `/property-transfers/${encodeURIComponent(id)}/decide`,
    { method: "POST", body: JSON.stringify({ accept }) }),
  cancelTransfer: (id) => request(
    `/property-transfers/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  propertyHistory: (propertyId) => request(
    `/properties/${encodeURIComponent(propertyId)}/history`),
  leaveAccount: (userId) => request(
    `/account-users/${encodeURIComponent(userId)}`, { method: "DELETE" }),

  overflowStanding: () => request("/overflow/standing"),
  setOverflowOptIn: (optIn, trades) => request("/overflow/opt-in",
    { method: "PUT", body: JSON.stringify({ optIn, trades }) }),
  overflowEligibility: (jobId, trade) => request(
    `/jobs/${encodeURIComponent(jobId)}/overflow/eligibility?trade=${encodeURIComponent(trade)}`),
  postOverflow: (jobId, body) => request(`/jobs/${encodeURIComponent(jobId)}/overflow`,
    { method: "POST", body: JSON.stringify(body) }),
  overflowPosts: () => request("/overflow/posts"),
  overflowOffers: () => request("/overflow/offers"),
  respondOverflow: (postId, body) => request(`/overflow/${encodeURIComponent(postId)}/respond`,
    { method: "POST", body: JSON.stringify(body) }),
  pickOverflow: (postId, companyId) => request(`/overflow/${encodeURIComponent(postId)}/pick`,
    { method: "POST", body: JSON.stringify({ companyId }) }),
  cancelOverflow: (postId) => request(`/overflow/${encodeURIComponent(postId)}/cancel`,
    { method: "POST" }),
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
    // Subcontractors who were asked to join and never arrived. A roster row
    // and a login are different records -- a company can sit on a roster with
    // nobody able to sign in as them, and nothing said so from any screen.
    stuckSubs: () => request("/platform/stuck-subs"),
    // `userId` picks which seat. Left out, the server takes an admin, which
    // is what it always did. Named, it takes that person -- so support can
    // see what a SUBCONTRACTOR sees, which is a different app from an
    // admin's and was unreachable before.
    impersonate: (accountId, reason, userId) =>
      request(`/platform/impersonate/${encodeURIComponent(accountId)}`,
        { method: "POST", body: JSON.stringify({ reason: reason || null, userId: userId || null }) }),
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
    // An account's own fee terms. Reading is any staff member; setting is a
    // superadmin, with a reason, and `{ reset: true }` puts the defaults back.
    feeTerms: (id) => request(`/platform/accounts/${encodeURIComponent(id)}/fee-terms`),
    setFeeTerms: (id, body) =>
      request(`/platform/accounts/${encodeURIComponent(id)}/fee-terms`, { method: "PUT", body: JSON.stringify(body) }),
    deleteAccount: (id, confirmName) =>
      request(`/platform/accounts/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ confirmName }) }),

    createCompany: (data) => request("/platform/companies", { method: "POST", body: JSON.stringify(data) }),
    patchCompany: (id, patch) =>
      request(`/platform/companies/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    deleteCompany: (id, confirmName) =>
      request(`/platform/companies/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ confirmName }) }),

    // What a company is to ONE account -- subcontractor or handyman. Keyed by
    // the ENGAGEMENT, never the company: the company row is shared, so a
    // company-keyed write would say the word for every account that hires
    // them, which is exactly what putting it on `engagements` prevents.
    setEngagedAs: (engagementId, engagedAs) =>
      request(`/platform/engagements/${encodeURIComponent(engagementId)}`,
        { method: "PATCH", body: JSON.stringify({ engagedAs }) }),

    // Which settings the Worker actually has. Names only, never values.
    setupCheck: () => request("/platform/setup-check"),
    systemHealth: () => request("/platform/system-health"),
    integrationHealth: () => request("/platform/integration-health"),

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
    // Admin or pm. The only way to grant the admin role to an account that has
    // nobody holding it -- every other door is `requireRole("admin")`, which
    // such an account cannot get through.
    setUserRole: (accountId, userId, role) =>
      request(`/platform/accounts/${needId(accountId, "account_id")}/users/${needId(userId, "user_id")}`,
        { method: "PATCH", body: JSON.stringify({ role }) }),
    // Returns only the address it went to. The token lives in the email and
    // nowhere else, which is what makes this safe to do on someone's behalf.
    resetPassword: (userId, accountId) =>
      request(`/platform/users/${needId(userId, "user_id")}/reset-password`,
        { method: "POST", body: JSON.stringify({ accountId: accountId || null }) }),
  },
};
