// WHO HAS TO BE THERE TO LET SOMEBODY IN, which decides whether the tenant is
// part of scheduling at all.
//
// Asked for as: *"a tenant does not always need to be available and in the
// unit [for a] job. Sometimes you need to be there. Allow the property manager
// to adjust that when scheduling the job, because that's one process that does
// not need to happen."*
//
// THE RULE ALREADY EXISTED AND NOBODY COULD OVERRIDE IT. `POST
// /api/jobs/:id/visits` has read `seat?.role === "tenant"` since 019: a repair
// a TENANT reported waits on that tenant to confirm the window; anything else
// is confirmed the moment it is proposed. That is a good default and it is
// derived entirely from who happened to raise the job -- so a tenant's report
// of a leaking roof, which is fixed from outside and needs nobody in, still
// sat waiting on them to agree a morning they did not need to be home for. And
// the reverse: a manager raising work inside an occupied flat got no
// confirmation step at all.
//
// So this is the answer said out loud, the same shape as `open_to_hire` and
// `owner_declared_at`: a column somebody sets, NULL meaning not answered, and
// one function deciding the EFFECTIVE value so the screens never derive a
// second one.

export const ACCESS_KINDS = {
  // The default for a tenant's own report, and the only one that costs a
  // round trip. Somebody lives there and has to be in.
  tenant: { id: "tenant", label: "The tenant needs to be in",
    short: "Tenant lets them in",
    // 061. BOTH of them, now that the party who drives to the address is asked
    // as well. The first version of this line said only "they", which was
    // true the day it shipped and became the half-truth the next change made.
    note: "The tenant and the contractor both confirm the time before it is booked.",
    // What the person turning up needs to know, which is a different sentence
    // from what the manager needs to decide.
    forContractor: "The tenant will let you in. The time is agreed with them." },
  manager: { id: "manager", label: "We'll let them in",
    short: "We let them in",
    // NOT "nobody is asked to confirm" any more. 061 asks the contractor on
    // every job, because a time the crew cannot make is not a time whoever
    // opens the door. Saying otherwise here would be the screen promising an
    // outcome the route no longer produces.
    note: "The contractor confirms the time. The tenant is not asked.",
    forContractor: "The managing agent will let you in — not the tenant." },
  none: { id: "none", label: "No access needed",
    short: "No access needed",
    note: "Outside, a common area, or an empty unit. Only the contractor confirms the time.",
    forContractor: "No access needed — nobody has to be there to let you in." },
};
export const ACCESS_IDS = Object.keys(ACCESS_KINDS);
export const isAccess = (v) => Object.prototype.hasOwnProperty.call(ACCESS_KINDS, String(v || ""));

// THE EFFECTIVE ANSWER. An explicit value always wins; NULL falls back to the
// rule that has been in force since 019, so this migration changes nothing
// about any job that already exists -- the same asymmetry `jobScopeFrom` and
// `engagedAs` use, and what makes it safe to ship against a live database.
//
// `tenantReported` is the server's answer, never the browser's guess: it is a
// membership role lookup, and a job's `requested_by` can be an OWNER, who is
// not somebody who has to be in.
export function accessFor(job, { tenantReported = false } = {}) {
  if (isAccess(job?.access)) return String(job.access);
  return tenantReported ? "tenant" : "none";
}

// The one thing it changes mechanically, and the reason the column exists.
// Everything else here is words.
export const needsTenantConfirm = (access) => access === "tenant";

// IS THERE ANYBODY TO ASK. Separate from whether to ask, and it is a fact
// rather than a choice.
//
// `notifyTenant` writes to `jobs.requested_by`, so the tenant who can confirm
// a window is the tenant who reported the repair. A job a MANAGER raised has
// no requester at all -- so marking one "the tenant needs to be in" would
// leave a visit proposed for ever with nobody able to answer it, which is the
// waiting-on-somebody-who-cannot-reply failure this project records about a
// handshake sitting behind a capability its answering role lacks.
//
// So the answer is offered only where it means something, and the override
// decides whether to ask rather than whether there is anybody there.
// 062. WHICH tenant, and it is two columns rather than one. `requested_by` is
// who asked for the work; `access_user_id` is who has to be let in. A job
// raised from a move-in inspection has the second and not the first -- nobody
// asked for it, and the person who will be standing in the unit is the tenant
// of that unit. Writing them into `requested_by` to make them answerable would
// put a sentence on the manager's Work requests panel saying they asked for
// something they never asked for, and invite somebody to approve or decline a
// job their own account raised.
//
// Both spellings, because the browser holds one and a raw row holds the other
// -- and a missed conversion here reads as "nobody to ask", which is the
// direction that silently drops the confirmation step.
export const accessTenant = (job) =>
  job?.accessUserId || job?.access_user_id || job?.requestedBy || job?.requested_by || null;

export const canAskTenant = (job) => !!accessTenant(job);

// What a screen may actually offer for this job, which is not always all
// three. The picker reads this rather than ACCESS_KINDS, because a control
// whose answer the server quietly ignores is the screen-that-lies rule
// pointed at a radio button.
export const accessChoices = (job) =>
  Object.values(ACCESS_KINDS).filter((k) => k.id !== "tenant" || canAskTenant(job));

// WHAT KIND OF ACCOUNT MAY CHOOSE, and it is not every kind.
//
// "We'll let them in" and "no access needed" are both answers about a
// building, so they belong to the kinds that have buildings. A general
// contractor's job is on a site they control and has no tenant to ask in the
// first place -- offering a picker there would be a control whose two other
// answers mean the same thing, which is a screen asking a question it already
// knows the answer to.
//
// The list is named here rather than imported, because the Worker's
// ACCOUNT_KINDS_WITH_PROPERTIES cannot cross into shared code and the
// browser's lives on ACCOUNT_KINDS -- the same three-way split
// `HANDYMAN_ACCOUNT_KINDS` already carries. A test pins all three equal, which
// is this project's standard answer to a list that cannot be imported.
export const ACCESS_ACCOUNT_KINDS = ["property_manager", "building_owner", "portfolio_manager"];
export const mayChooseAccess = (accountKind) =>
  ACCESS_ACCOUNT_KINDS.includes(String(accountKind || ""));

// AND WHICH SEAT, which is the other half and shipped as a crash.
//
// The picker's gate read a bare `canManage`, which is a PROP NAME on half a
// dozen components in `App.tsx` and is not a variable in the scope that line
// sits in. So opening an approved, tenant-requested job threw
// `Can't find variable: canManage` and white-screened the Jobs view -- live,
// for every account, on the one screen this product exists for.
//
// It is `requireRole("admin", "pm")` on `PATCH /api/jobs/:id`, so it is those
// two and no more. Named here beside `mayChooseAccess` rather than written at
// the call site, because the account-kind half already lives here and the two
// together are one question: may this screen offer the picker. A role list
// written at a call site is a role list that drifts from its route -- which
// this project calls the same lie in both directions.
//
// The capability vocabulary is deliberately not used. `can("jobs")` includes
// an OWNER, who is a guest on somebody else's account and whom that route
// refuses, so gating on it would be looser than the server.
export const ACCESS_WRITE_ROLES = ["admin", "pm"];
export const maySetAccess = (role) => ACCESS_WRITE_ROLES.includes(String(role || ""));
