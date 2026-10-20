// THE POSTMAN COLLECTION FOR THE PUBLIC API, built from the same field lists
// the routes validate against, so it cannot describe a field the API has
// dropped or miss one it added.
//
// The format is Postman's collection v2.1. Its shape was read from Postman's
// own SDK (postman-collection 5.3.1: the schema URL in Collection#toJSON, and
// `mode`/`raw`/`options` in RequestBody) and the bearer key from its runtime
// (postman-runtime's authorizer/bearer.js reads `token`) -- the schema site is
// blocked here, and those two packages are what Postman itself loads. The
// suite round-trips the result through the SDK rather than trusting this file.
//
// Served by the API Worker at GET /api/v1/postman.json rather than as a file
// on subsub.work: generated per request from these lists, it cannot go stale,
// and the marketing site deliberately publishes no .json.
//
// It carries no account data and no token. `{{token}}` is a collection
// variable left blank, and the import screen in Postman is where it is pasted.

import { REQUIRED_FIELDS, OPTIONAL_FIELDS } from "./ingest.js";
import { INSPECT_REQUIRED_FIELDS, INSPECT_OPTIONAL_FIELDS } from "./inspectingest.js";

export const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";
export const POSTMAN_PATH = "/api/v1/postman.json";
export const POSTMAN_FILENAME = "SubSub API.postman_collection.json";
export const API_ORIGIN = "https://api.subsub.work";

// Example bodies. Every required field is in each, and nothing that is not a
// field the route reads -- the suite checks both against the lists above.
export const JOB_EXAMPLE = {
  externalId: "CRM-1041",
  source: "generic",
  title: "Reroof — 14 Alder Way",
  trades: ["roofing", "gutters"],
  date: "2026-10-14",
  time: "08:00",
  address: "14 Alder Way",
  area: "Seattle",
  zip: "98101",
  client: "M. Okafor",
  scope: "Tear off and replace, 30yr architectural.",
};

export const INSPECTION_EXAMPLE = {
  externalId: "WALK-2207",
  kind: "move_out",
  property: "Ballard Apts",
  unit: "4B",
  inspectedOn: "2026-10-14",
  rooms: [
    { name: "Kitchen", status: "ok" },
    { name: "Bathroom 1", status: "needs work", note: "Cracked basin, left of the tap." },
  ],
};

const json = (o) => JSON.stringify(o, null, 2);

const url = (path, query) => {
  const segs = path.replace(/^\//, "").split("/");
  return {
    raw: `{{baseUrl}}/${segs.join("/")}${query ? `?${query.map((q) => `${q.key}=${q.value}`).join("&")}` : ""}`,
    host: ["{{baseUrl}}"],
    path: segs,
    ...(query ? { query } : {}),
  };
};

const jsonHeader = [{ key: "Content-Type", value: "application/json" }];

function item(name, { method, path, body, description, query, noauth }) {
  const request = { method, header: body ? jsonHeader : [], url: url(path, query), description };
  if (body) request.body = { mode: "raw", raw: json(body), options: { raw: { language: "json" } } };
  // The webhook addresses carry the token in the path, for systems that cannot
  // set a header -- sending the header as well would teach the wrong thing.
  if (noauth) request.auth = { type: "noauth" };
  return { name, request };
}

export function postmanCollection() {
  const fieldNote = (req, opt) => `Required: ${req.join(", ")}. Optional: ${opt.join(", ")}.`;
  return {
    info: {
      name: "SubSub API",
      description: "Post scheduled jobs and unit inspections into SubSub, and read the trades and "
        + "buildings they can name. Paste your API token (My account -> Integrations -> Connect your "
        + "CRM) into the collection's `token` variable. Full reference: https://subsub.work/developers",
      schema: POSTMAN_SCHEMA,
    },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
    variable: [
      { key: "baseUrl", value: `${API_ORIGIN}/api/v1`, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    item: [
      {
        name: "Reads",
        item: [
          item("Who this token belongs to", { method: "GET", path: "/me",
            description: "The account the token belongs to. A read, so it is the safe way to test a token." }),
          item("Trades", { method: "GET", path: "/trades",
            description: "Every trade id a job may name, with its label." }),
          item("Buildings", { method: "GET", path: "/properties", query: [{ key: "page", value: "0" }],
            description: "The buildings a job or inspection may name by propertyId. 100 a page; a short page is the last." }),
        ],
      },
      {
        name: "Jobs",
        item: [
          item("Post a job", { method: "POST", path: "/jobs", body: JOB_EXAMPLE,
            description: `${fieldNote(REQUIRED_FIELDS, OPTIONAL_FIELDS)} Send address or propertyId. `
              + "The same externalId sent twice returns the job that exists rather than making another." }),
          item("Post a job (webhook address, no header)", {
            method: "POST", path: "/hooks/generic/{{token}}", body: JOB_EXAMPLE, noauth: true,
            description: "For a system that cannot set an Authorization header: the token goes in the address." }),
        ],
      },
      {
        name: "Inspections",
        item: [
          item("Post an inspection", { method: "POST", path: "/inspections", body: INSPECTION_EXAMPLE,
            description: `${fieldNote(INSPECT_REQUIRED_FIELDS, INSPECT_OPTIONAL_FIELDS)} Send property or `
              + "propertyId. It always arrives as a draft. Accounts with buildings only." }),
          item("Post an inspection (webhook address, no header)", {
            method: "POST", path: "/hooks/generic/{{token}}/inspections", body: INSPECTION_EXAMPLE, noauth: true,
            description: "The inspections door for a system that cannot set a header." }),
        ],
      },
    ],
  };
}
