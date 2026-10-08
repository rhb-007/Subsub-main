// HOW THE CREW GETS IN, said to the two people who have to meet.
//
// Asked for as *"on the pm side it shows tenant lets service provider in, but
// in both of their accounts (tenant and service provider) it's not clear who
// lets who in. There needs to be an access section that shows explicitly how
// service provider will gain access to the job ie. tenant will open garage
// door or meet at front door at meeting time with both of their contact
// numbers (mobile numbers and first name)."*
//
// 060 records WHO lets them in as one of three words, and every screen drew
// that word as a sentence about the manager's decision. What the two people
// standing either side of a door need is different and more concrete: who is
// meeting whom, where, when, and how to reach them when the van is outside.
//
// Three facts, and this module decides which of them each viewer is given:
//
//   WHO lets them in -- 060's effective answer, never re-derived here.
//   HOW: a sentence somebody types (073, job_access.how) -- "meet at the front
//        door", "the garage door will be open". Free text with suggestions,
//        because every building has an entrance nobody has heard of.
//   PEOPLE: a first name and a mobile per side.
//
// A PHONE NUMBER IS THE PART THAT NEEDS A RULE, and the rule is narrow on
// purpose. A tenant's number reaches a crew only when that tenant is the one
// letting them in and that crew has ACCEPTED work on the job; a crew's number
// reaches a tenant only on the same two conditions. Nobody gets a number for a
// door they are not standing at -- a crew on a job the managing agent opens
// gets the agent's number, not the tenant's, and a tenant whose repair is fixed
// from outside is handed nobody's.

export const ACCESS_HOW_MAX = 200;

// Suggestions, per who lets them in. A tap fills the box; nothing is chosen for
// anybody -- a pre-filled entrance is a crew at the wrong door.
export const ACCESS_HOW_PRESETS = {
  tenant: [
    "Meet at the front door",
    "The tenant will open the garage door",
    "Buzz the unit from the gate",
    "Knock at the unit door",
  ],
  manager: [
    "Meet the manager at the front door",
    "Key in the lockbox — the manager will text the code",
    "Pick up the key at the office",
  ],
  none: [
    "The work is outside — no need to go in",
    "Common area — the door is unlocked",
  ],
};

export const normalizeHow = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, ACCESS_HOW_MAX);
  return s || null;
};

export const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || null;

// WHO MAY WRITE THE "HOW". The team, always. The tenant, only on a job they are
// the one letting the crew in for -- they know which door they will open, and
// asking them to ring the office to say so is a round trip for a sentence.
export const ACCESS_HOW_TEAM = ["admin", "pm"];
export const mayEditHow = (role, { kind, isAccessTenant = false } = {}) =>
  ACCESS_HOW_TEAM.includes(String(role || ""))
  || (role === "tenant" && kind === "tenant" && !!isAccessTenant);

// WHOSE NUMBER THIS VIEWER IS GIVEN. Pure, so the privacy rule is pinned by a
// test rather than spread across three queries.
//
// `viewer` is "team" (admin or pm on the account), "crew" (a company holding
// accepted work on the job -- the caller passes only that company's own row),
// or "tenant" (the person who has to be let in). `tenant`, `manager` and each
// crew are {firstName, phone, ...} or null.
export function visiblePeople({ kind, viewer, tenant = null, manager = null, crews = [] }) {
  const letIn = kind === "tenant" ? tenant : kind === "manager" ? manager : null;
  const out = [];
  const add = (p, side) => { if (p && (p.firstName || p.phone)) out.push({ ...p, side }); };
  if (viewer === "team") {
    add(letIn, kind);
    for (const c of crews) add(c, "crew");
  } else if (viewer === "crew") {
    add(letIn, kind);
    for (const c of crews) add({ ...c, you: true }, "crew");
  } else if (viewer === "tenant") {
    if (kind === "tenant") {
      add({ ...tenant, you: true }, "tenant");
      for (const c of crews) add(c, "crew");
    } else if (kind === "manager") {
      // The agent is opening the door, so the agent is who they call. The
      // crew's number is not theirs to hold for a visit they are not at.
      add(manager, "manager");
    }
  }
  return out;
}

// The one sentence at the top of the panel, from the reader's side. "The
// tenant lets them in" is the manager's sentence; the two people at the door
// need "you let Pacific in" and "John lets you in".
export function accessHeadline(plan, viewer) {
  const kind = plan?.kind;
  const t = (plan?.people || []).find((p) => p.side === "tenant");
  const m = (plan?.people || []).find((p) => p.side === "manager");
  const crew = (plan?.people || []).find((p) => p.side === "crew");
  const crewName = crew?.company || "the crew";
  if (kind === "tenant") {
    if (viewer === "tenant") return `You let ${crewName} in.`;
    if (viewer === "crew") return `${t?.firstName || "The tenant"} (the tenant) lets you in.`;
    return `${t?.firstName || "The tenant"} (the tenant) lets ${crewName} in.`;
  }
  if (kind === "manager") {
    if (viewer === "tenant") return `${m?.firstName || "The managing agent"} from the office lets the crew in. You do not need to be home.`;
    if (viewer === "crew") return `${m?.firstName || "The managing agent"} from the office lets you in — not the tenant.`;
    return `${m?.firstName || "We"} let${m?.firstName ? "s" : ""} ${crewName} in.`;
  }
  if (kind === "none") {
    if (viewer === "tenant") return "Nobody needs to let the crew in. You do not need to be home.";
    if (viewer === "crew") return "No access needed — nobody has to be there to let you in.";
    return "No access needed — nobody has to be there.";
  }
  return null;
}
