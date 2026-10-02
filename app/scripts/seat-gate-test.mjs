// Who may change somebody else's seat, and who may wire the account's CRM.
//
// THE BUG THIS EXISTS FOR IS A TYPO THAT FAILED CLOSED AND SILENTLY. The edit
// user form asked `can("users")`. There is no "users" capability in `ROLES` --
// "users" is a PANE name in AccountView, gated there on `canManage` -- and an
// unknown view falls through `ROLES[role].can.includes(view)` and answers
// false. So it answered false for an admin, for a project manager and for
// everybody else, on every account kind.
//
// What that cost is the whole of the form below the email box. `roleLocked`
// hides the role picker, the buildings picker, the jobs picker and the
// contractor link, so:
//
//   - a general contractor could not attach a project manager to named jobs,
//     which is the only scope that seat has (they have no buildings), and
//   - a managing agent could not attach one to named buildings, which is the
//     scope that has existed since membership_properties shipped.
//
// The two controls the gate exists to protect, unreachable by the one person
// allowed to use them. `PATCH /api/account-users/:userId` is
// `requireRole("admin")` throughout, so the screen was STRICTER than the route
// -- the same lie as looser, and this repo has now paid for it in both
// directions.
//
// So the fix is a named predicate, and the guard is the class rather than the
// instance: EVERY `can("...")` string in App.tsx has to be a capability some
// role actually has. A misspelt one is indistinguishable from a refused one at
// runtime, forever.
//
// The second half is a product decision rather than a bug. A project manager
// reached the CRM trade rules and not the token beside them, because the
// routes were written `requireRole("admin", "pm")` on the argument that
// answering "Roof Replacement means roofing" is trade knowledge. A rule is the
// dictionary every arriving job is read through, from then on, for everybody
// -- the same account-level decision as the key that creates those jobs. Both
// halves are admin now, route and screen in one change.
//
//   node --no-warnings scripts/seat-gate-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

// Comments stripped before any substring check. A comment naming the thing it
// describes reads to a substring check exactly like the code -- five times in
// this repo now, and this file's own header names `can("users")` twice.
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*(\/\/|\{?\s*\/\*)/.test(l)).join("\n")
  .replace(/\/\/[^\n"'`]*$/gm, "");

const APPC = code(APP);
const WC = code(WORKER);

console.log("-- every capability asked for is a capability that exists --");
{
  // Read the vocabulary out of ROLES itself rather than keeping a list here.
  // A list written by whoever adds a capability is the same record twice, and
  // the record that goes stale is the one in the test.
  const block = APPC.match(/const ROLES = \{[\s\S]*?\n\};/);
  ck("ROLES is where the vocabulary lives", !!block);
  const known = new Set();
  for (const m of (block?.[0] || "").matchAll(/can:\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) known.add(s[1]);
  }
  ck("and it names some capabilities", known.size >= 5, [...known].join(","));

  const asked = [...new Set([...APPC.matchAll(/\bcan\("([^"]+)"\)/g)].map((m) => m[1]))];
  ck("something asks for one", asked.length > 0, asked.join(","));
  const unknown = asked.filter((v) => !known.has(v));
  // THE ASSERTION THE WHOLE FILE IS FOR. `can("users")` sat here for as long
  // as the users pane has existed, answering false for everybody, and nothing
  // anywhere could report it: a capability nobody has and a capability
  // somebody is refused look identical from the screen.
  ck("and every one of them is real", unknown.length === 0,
    unknown.length ? `not a capability: ${unknown.join(", ")}` : "");
  // "users" specifically, because that is the one that was wrong and the one
  // a later pass would reintroduce by reading the pane list.
  ck("\"users\" in particular is a pane name, not a capability", !known.has("users"));
}

console.log("\n-- the edit user form is gated on the role the route requires --");
{
  ck("PATCH /api/account-users/:userId is admin-only",
    /app\.patch\("\/api\/account-users\/:userId", requireRole\("admin"\)/.test(WC));
  ck("so the screen names the role rather than looking a capability up",
    /const canManageUsers = role === "admin";/.test(APPC));
  ck("the role picker unlocks for an admin editing somebody else",
    /canChangeRole=\{canManageUsers && editUser\.id !== currentUserId\}/.test(APPC));
  ck("and never for yourself, whatever the role",
    !/canChangeRole=\{canManageUsers\}/.test(APPC));
  ck("the avatar follows the same gate, or your own face",
    /onSetAvatar=\{canManageUsers \|\| editUser\.id === currentUserId \?/.test(APPC));
  // The two scope pickers are inside `!roleLocked`, so this predicate is what
  // decides whether either can be reached at all.
  ck("both scope pickers sit behind roleLocked, which is what made this total",
    /\{showBuildings && !roleLocked &&/.test(APPC) && /\{scopeByJob && !roleLocked &&/.test(APPC));
  ck("and nothing asks the old question any more", !/can\("users"\)/.test(APPC));
}

console.log("\n-- a scope survives the trip through state --");
{
  // The list is read off `/api/account-users`, written into `memberships`,
  // read back out through `accountUsers`, and handed to the form. A field
  // dropped at any of the three opens the picker with nothing ticked -- which
  // reads as "runs every job" and writes exactly that on the next save. Same
  // drop-a-field-you-did-not-list shape that deleted a W-9 through SubForm,
  // pointed at the field that decides what somebody can see.
  ck("the route returns it", /jobIds: jobsByUser\[r\.id\] \|\| \[\]/.test(WC));
  ck("hydrate writes it onto the membership",
    /accountId, role: m\.role, companyId: m\.subId,\s*\n\s*propertyIds: m\.propertyIds \|\| \[\], jobIds: m\.jobIds \|\| \[\]/.test(APPC));
  // ANCHORED ON ITS OWN ROW. The first version matched the propertyIds/jobIds
  // pair alone, which is the same text hydrate writes two hundred lines up --
  // so deleting the field from accountUsers left hydrate's copy satisfying the
  // check and the mutation walked straight through. Whichever-one-exists, the
  // trap this repo first recorded about `.embed-code-btn`.
  ck("accountUsers reads it back out",
    /subId: m\.companyId \?\? null,\s*\n\s*propertyIds: m\.propertyIds \|\| \[\], jobIds: m\.jobIds \|\| \[\]/.test(APPC));
  ck("and the save sends it", /jobIds: u\.jobIds \|\| \[\],/.test(APPC));

  // WHICH ROLES CARRY WHICH LIST IS THE SERVER'S ANSWER. setMembershipProperties
  // keeps a list for a pm as well as an owner and a tenant; setMembershipJobs
  // keeps one for a pm only. The optimistic patch read `"owner"` alone, so
  // saving any edit to a scoped PROPERTY manager blanked their buildings on
  // screen while the server kept them -- a disagreement that lasts until
  // somebody reloads, which is how a scope reads as lost.
  //
  // Both sides now read ONE predicate out of shared/propscope.js rather than
  // restating the list, because restating it is how they came to disagree a
  // second time: `isScoped` in the browser read the raw propertyIds and asked
  // nothing about the role at all, so an admin carrying rows left behind by a
  // promotion read as narrowed on screen and unnarrowed on the server. So
  // what is pinned is that neither side spells the rule out for itself.
  ck("the server asks the shared predicate which roles carry a building list",
    /if \(isPropertyScopedRole\(role\)\) \{/.test(WC));
  ck("so does the optimistic patch",
    /propertyIds: isPropertyScopedRole\(u\.role\)/.test(APPC));
  ck("and neither restates it", !/role === "pm" \|\| ALWAYS_SCOPED_ROLES/.test(WC)
    && !/u\.role === "pm" \|\| ALWAYS_SCOPED_ROLES/.test(APPC));
  ck("and a job list only for a pm, which is who has one",
    /jobIds: u\.role === "pm" \? \(u\.jobIds \|\| \[\]\) : \[\]/.test(APPC));
}

console.log("\n-- a project manager has no API access, on either half --");
{
  const rules = [...WC.matchAll(/app\.(get|post|delete)\("(\/api\/crm-rules[^"]*)", requireRole\(([^)]*)\)/g)];
  ck("all three crm-rules routes are found", rules.length === 3, String(rules.length));
  ck("and every one of them is admin-only",
    rules.length === 3 && rules.every((m) => m[3].trim() === '"admin"'),
    rules.map((m) => `${m[1].toUpperCase()} ${m[2]} -> ${m[3]}`).join(" | "));
  ck("no crm route names pm any more", !/\/api\/crm-rules[^"]*", requireRole\("admin", "pm"\)/.test(WC));

  // The screen follows in the same change, or it is stricter or looser than
  // the route -- and it was looser: a pm reached the rules and not the token.
  ck("the token panel is canManage, as it always was",
    /\{canManage && ACCOUNT_KINDS\[accountKind\]\?\.hires !== false && \(\s*\n\s*<ApiTokens/.test(APPC));
  ck("and the mapping panel is now the same gate",
    /\{canManage && ACCOUNT_KINDS\[accountKind\]\?\.hires !== false && \(\s*\n\s*<CrmMapping/.test(APPC));
  ck("neither is drawn for a pm by role",
    !/\(role === "admin" \|\| role === "pm"\) && ACCOUNT_KINDS\[accountKind\]\?\.hires !== false/.test(APPC));
  // Both halves of one integration behind one gate, which is the point: a
  // token that creates jobs and a dictionary that decides what they are.
  ck("and the two sit behind the same predicate",
    (APPC.match(/\{canManage && ACCOUNT_KINDS\[accountKind\]\?\.hires !== false && \(/g) || []).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
