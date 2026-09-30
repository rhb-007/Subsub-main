// Which jobs a seat may see.
//
// SEAT SCOPING ALREADY EXISTED AND DID NOTHING FOR A GENERAL CONTRACTOR.
// `membership_properties` narrows a property manager to named buildings, and
// the comment on `ROLES.pm` says why it is one role rather than two: a large
// managing agent assigns each manager to named buildings and a small one does
// not, which is the same job with or without a list.
//
// A general contractor has `properties: false`. No buildings at all. So the
// one account kind whose pm seat is actually called a PROJECT manager had
// nothing to be scoped by, and a firm with six project managers gave every one
// of them the whole book. The unit of work for a general contractor is the
// JOB, and this is that axis.
//
// THE ASYMMETRY IS COPIED DELIBERATELY, because it is the same asymmetry and
// for the same reason. For a manager, no rows means nobody narrowed them, so
// they see everything -- which is what every membership was before this
// existed, and what an upgrade must leave untouched. An owner and a tenant are
// scoped by property and are not touched here at all: their jobs already
// follow their buildings, and giving them a second, emptier list would narrow
// them to nothing.
export const JOB_SCOPED_ROLES = ["pm"];

// The stored list, turned into the scope. `null` means unrestricted -- never
// an empty array, which means "narrowed to nothing" and is a different answer.
export function jobScopeFrom(role, ids) {
  if (!JOB_SCOPED_ROLES.includes(String(role || ""))) return null;
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.length ? list : null;
}

// May this seat see this one job? Unrestricted seats see everything, which is
// what `null` is for; a narrowed one sees exactly its list.
export const maySeeJob = (jobIds, jobId) =>
  !jobIds || (jobId != null && jobIds.includes(jobId));

// What a narrowed seat is told they are looking at. A manager who has been
// given four jobs out of ninety needs to know the list is short on purpose --
// an unexplained short list reads as data missing, and the first thing
// somebody does about that is ask whether the product is broken.
export function scopeNote(jobIds, word = "job") {
  if (!jobIds) return "";
  const n = jobIds.length;
  return `You are assigned to ${n} ${word}${n === 1 ? "" : "s"}. Everything here is scoped to ${n === 1 ? "it" : "them"}.`;
}
