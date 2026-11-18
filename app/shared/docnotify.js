// EMAILS TO THE HIRING SIDE WHEN A COMPANY ON ITS ROSTER ADDS TO ITS
// COMPLIANCE PACK. One switch per item, each ON unless somebody turned it
// off: a missing key is on, so every person who existed before this reads
// the same as a new one.
//
// Kept per person (users.notify.docUploads), because whether a project
// manager wants an email every time a W-9 lands is their call, not the
// account's.

export const DOC_NOTIFY_KINDS = [
  { id: "insurance", label: "Certificate of insurance", hint: "A new or renewed certificate." },
  { id: "bond", label: "Surety bond", hint: "A new or renewed bond." },
  { id: "w9", label: "IRS Form W-9", hint: "Needed before you can pay them." },
  { id: "license", label: "License number", hint: "Added or changed on their record." },
  { id: "agreement", label: "Signed agreement", hint: "They signed your agreement. You countersign it." },
];

const IDS = DOC_NOTIFY_KINDS.map((k) => k.id);

// What an upload of a document kind is, as one of these. The agreement is
// stored as the "contract" document.
export const docNotifyKind = (docKind) =>
  docKind === "contract" ? "agreement" : IDS.includes(docKind) ? docKind : null;

// Is this person told about this item? `notify` is the parsed users.notify.
export const docNotifyOn = (notify, kind) => {
  if (!IDS.includes(kind)) return false;
  const d = notify && typeof notify.docUploads === "object" ? notify.docUploads : null;
  return !d || d[kind] !== false;
};

// The stored shape: known keys only, each a boolean. Anything else is dropped.
export const cleanDocNotify = (raw) => {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of IDS) if (raw[id] !== undefined) out[id] = !!raw[id];
  return out;
};

export const docNotifyLabel = (kind) => DOC_NOTIFY_KINDS.find((k) => k.id === kind)?.label || kind;
