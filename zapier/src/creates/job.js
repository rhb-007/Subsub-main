const { API, authHeader } = require("../constants");

// The fields are the published ones, in the order the documentation lists
// them, because an integrator reads one and fills in the other. Five required
// and the rest optional -- an API stricter than the screen a person uses makes
// an integration fail over a number no CRM holds.
const inputFields = [
  {
    key: "externalId",
    required: true,
    label: "Job ID in your system",
    // The one nobody asks for and every integration needs, so it says why.
    helpText:
      "Your CRM's own id for this job. SubSub uses it so a retry cannot create " +
      "the same job twice — one scheduled job becoming four is four contractors " +
      "asked to show up on a Tuesday.",
  },
  { key: "title", required: true, label: "Title", helpText: "What the job is called." },
  {
    key: "trades",
    required: true,
    list: true,
    label: "Trades",
    // Dynamic, so nobody types `windows_doors` from memory.
    dynamic: "trade.id.label",
    helpText: "What work this job needs. These become the slots you assign contractors to.",
  },
  {
    key: "date",
    required: true,
    type: "datetime",
    label: "Scheduled date",
    helpText: "The day the work is booked for.",
  },
  {
    key: "address",
    label: "Address",
    helpText: "Street address. Required unless you give a SubSub Property ID below.",
  },
  { key: "area", label: "City" },
  { key: "zip", label: "ZIP" },
  {
    key: "propertyId",
    label: "SubSub property",
    // Dynamic for the same reason Trades is, and a sharper one: this is a
    // uuid. A text box asking for one is a field somebody fills in by going to
    // look it up, and a wrong one is a job refused as `property_not_found`.
    dynamic: "property.id.label",
    helpText: "Use instead of an address for a building already on your account.",
  },
  { key: "time", label: "Time", helpText: "24-hour, e.g. 08:00." },
  { key: "client", label: "Client name" },
  { key: "scope", label: "Scope of work" },
  { key: "notes", label: "Internal notes" },
  { key: "sqft", type: "integer", label: "Square feet" },
  { key: "stories", type: "integer", label: "Stories" },
  { key: "materialsPaidBy", label: "Materials paid by" },
  { key: "materialSource", label: "Material source" },
  { key: "materialSupplier", label: "Supplier" },
  { key: "materialBranch", label: "Supplier branch" },
];

const perform = async (z, bundle) => {
  const i = bundle.inputData;

  // Zapier hands a `datetime` field back as a full ISO timestamp; SubSub wants
  // the day. Slicing here rather than asking for a date-shaped string means
  // somebody can map their CRM's timestamp straight in without a formatter
  // step, which is one more place to get a date wrong.
  const date = String(i.date || "").slice(0, 10);

  const body = { externalId: i.externalId, title: i.title, trades: i.trades, date };
  // `source` is provenance: where the job came from, on the SubSub side.
  body.source = "generic";

  for (const k of ["address", "area", "zip", "propertyId", "time", "client",
    "scope", "notes", "materialsPaidBy", "materialSource", "materialSupplier",
    "materialBranch"]) {
    // Only what was filled in. Sending "" would store an empty string where
    // the column means "not given".
    if (i[k] !== undefined && i[k] !== null && String(i[k]).trim() !== "") body[k] = i[k];
  }
  for (const k of ["sqft", "stories"]) {
    if (i[k] !== undefined && i[k] !== null && String(i[k]).trim() !== "") body[k] = Number(i[k]);
  }

  const res = await z.request({
    url: `${API}/jobs`,
    method: "POST",
    headers: { ...authHeader(z, bundle), "Content-Type": "application/json" },
    body,
  });
  // `duplicate: true` comes back 200 with the id of the job that already
  // exists. It is a SUCCESS, not an error: a webhook that does not get a 200
  // retries, so treating a retry as a failure is how one job becomes four.
  return res.data;
};

module.exports = {
  key: "job",
  noun: "Job",
  display: {
    label: "Create Job",
    description:
      "Creates a scheduled job in SubSub with its trades unassigned, ready to " +
      "assign contractors to.",
  },
  operation: {
    inputFields,
    perform,
    sample: {
      ok: true,
      duplicate: false,
      jobId: "5b0f2a1c-0000-4000-8000-000000000000",
      trades: ["roofing", "gutters"],
      url: "https://app.subsub.work/?job=5b0f2a1c-0000-4000-8000-000000000000",
    },
    outputFields: [
      { key: "jobId", label: "Job ID" },
      { key: "duplicate", type: "boolean", label: "Already existed" },
      { key: "url", label: "Job URL" },
    ],
  },
};
