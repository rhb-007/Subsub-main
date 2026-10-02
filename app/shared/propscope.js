// WHICH SEATS ARE NARROWED BY BUILDING, and how to ask.
//
// This was three expressions of one rule in two languages, and they
// disagreed. The Worker's `propertyScope` answers null for anything that is
// not a pm, an owner or a tenant -- so an ADMIN is never narrowed by
// building, whatever rows happen to exist. The browser's `isScoped` read the
// raw `propertyIds` off the seat and asked no question about the role at all.
//
// `GET /api/account-users` hands back the raw `membership_properties` rows for
// every person on the account, because the user form has to draw the picker
// with what is actually stored. So an admin carrying stray rows reads as
// scoped IN THE BROWSER and as unscoped ON THE SERVER, and `runsTheAccount` --
// `isStaffRole(role) && !isScoped(membership)` -- then shuts the account down
// around somebody the API would let do anything.
//
// WHICH IS NOT HYPOTHETICAL: reported as a property manager's own building
// opening with no vendor list, no Edit, no Remove, no owners panel and one
// line reading "Add the owner above and they can take this building over",
// over a header reading "Your buildings" instead of "Properties". Every one of
// those is `canManage` false. The seat was an admin -- the impersonation
// banner said nothing about a fallback -- and it was an admin who had been a
// project manager scoped to named buildings, promoted through the console.
// The promotion wrote `memberships.role` and left the buildings behind.
//
// So: one rule, imported by both, and the question includes the role.

// Always limited to named buildings, and for which an empty list means
// NOTHING rather than everything -- a guest nobody has given a building to
// sees no buildings.
export const ALWAYS_SCOPED_ROLES = ["owner", "tenant"];

// Every seat a building list may be stored against. A property manager's is
// optional: most firms have one or two people who see the whole book, a big
// one assigns each manager to named buildings, and it is the same job either
// way -- so for them an empty list means EVERYTHING. Nobody else may carry one
// at all.
export const PROPERTY_SCOPED_ROLES = ["pm", ...ALWAYS_SCOPED_ROLES];

export const isPropertyScopedRole = (role) =>
  PROPERTY_SCOPED_ROLES.includes(String(role || ""));

// Is this seat actually narrowed? Role first, then the list -- a list against
// a role that cannot carry one narrows nobody, and treating it as a narrowing
// is the bug above. Takes either shape: the browser's membership
// (`propertyIds`) or a row carrying the same field.
export const isPropertyScoped = (m) =>
  isPropertyScopedRole(m?.role) && (m?.propertyIds || []).length > 0;
