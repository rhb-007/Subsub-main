// The Postman collection and the Zapier invite link behind the two "ways to
// start" cards on Account -> Integrations and on developers.html.
//
// The collection is read back through Postman's own SDK (postman-collection,
// pinned) rather than trusted, its example bodies are checked against the
// field lists the routes validate with -- and run through the real route --
// and the route that serves it is driven through the Worker.
//
//   node --no-warnings scripts/postman-test.mjs

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { postmanCollection, JOB_EXAMPLE, INSPECTION_EXAMPLE, POSTMAN_SCHEMA } from "../shared/postman.js";
import { REQUIRED_FIELDS, OPTIONAL_FIELDS, validateIngest } from "../shared/ingest.js";
import { INSPECT_REQUIRED_FIELDS, INSPECT_OPTIONAL_FIELDS, readInspection, roomStatusFor } from "../shared/inspectingest.js";
import { TRADE_IDS } from "../shared/trades.js";
import { zapierInviteUrl, INTEGRATIONS } from "../shared/integrations.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const require = createRequire(import.meta.url);
const { Collection } = require("postman-collection");

console.log("\n-- the collection, read by Postman's own SDK --");
const raw = postmanCollection();
const col = new Collection(raw);
const back = col.toJSON();
ck("the schema is the one the SDK writes", back.info.schema === POSTMAN_SCHEMA && raw.info.schema === POSTMAN_SCHEMA,
  back.info.schema);
const reqs = [];
col.forEachItem((it) => reqs.push(it));
ck("it holds seven requests", reqs.length === 7, String(reqs.length));
const by = (name) => reqs.find((r) => r.name === name);
ck("bearer auth reads the token variable, under the key Postman's runtime reads",
  col.auth?.type === "bearer" && col.auth.parameters().get("token") === "{{token}}",
  JSON.stringify(back.auth));
ck("the token variable is blank: no secret ships in it",
  raw.variable.find((v) => v.key === "token")?.value === "");
ck("every request goes to the base URL variable",
  reqs.every((r) => r.request.url.toString().startsWith("{{baseUrl}}/")));
ck("the base URL is the live API", raw.variable.find((v) => v.key === "baseUrl")?.value === "https://api.subsub.work/api/v1");
const paths = reqs.map((r) => `${r.request.method} ${r.request.url.getPath()}`);
for (const want of ["GET /me", "GET /trades", "GET /properties", "POST /jobs", "POST /inspections",
  "POST /hooks/generic/{{token}}", "POST /hooks/generic/{{token}}/inspections"]) {
  ck(`it carries ${want}`, paths.includes(want), paths.join(", "));
}
const hook = by("Post a job (webhook address, no header)");
ck("the webhook-address requests send no Authorization header",
  hook?.request.auth?.type === "noauth" && by("Post an inspection (webhook address, no header)")?.request.auth?.type === "noauth");
ck("the header requests inherit the bearer auth", !by("Post a job").request.auth);
const jobBody = JSON.parse(by("Post a job").request.body.raw);
ck("a POST body is JSON, said so twice", by("Post a job").request.body.mode === "raw"
  && by("Post a job").request.headers.get("Content-Type") === "application/json");

console.log("\n-- the examples are bodies the routes accept --");
const jobFields = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS, "address", "propertyId"]);
ck("the job example carries every required field", REQUIRED_FIELDS.every((f) => f in JOB_EXAMPLE));
ck("and nothing the route does not read", Object.keys(JOB_EXAMPLE).every((k) => jobFields.has(k)),
  Object.keys(JOB_EXAMPLE).filter((k) => !jobFields.has(k)).join(","));
const v = validateIngest(jobBody, { tradeIds: TRADE_IDS });
ck("the job example validates", v.ok === true, JSON.stringify(v.errors));
const inspFields = new Set([...INSPECT_REQUIRED_FIELDS, ...INSPECT_OPTIONAL_FIELDS]);
ck("the inspection example carries every required field", INSPECT_REQUIRED_FIELDS.every((f) => f in INSPECTION_EXAMPLE));
ck("and nothing the route does not read", Object.keys(INSPECTION_EXAMPLE).every((k) => inspFields.has(k)));
const ri = readInspection(INSPECTION_EXAMPLE);
ck("the inspection example reads, with both rooms on it", ri.ok === true && ri.inspection?.rooms?.length === 2,
  JSON.stringify(ri).slice(0, 300));
ck("and its condition words are ones SubSub knows, so the example lands no room unchecked",
  INSPECTION_EXAMPLE.rooms.every((r) => roomStatusFor(r.status, []).matched),
  JSON.stringify(INSPECTION_EXAMPLE.rooms.map((r) => roomStatusFor(r.status, []))));

console.log("\n-- the route --");
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const env = { DB: makeD1(freshDb({ base: SCHEMA, migrations: [] })) };
const res = await worker.fetch(new Request("https://api.subsub.work/api/v1/postman.json"), env);
const served = await res.json().catch(() => null);
ck("it is served with no token at all", res.status === 200, String(res.status));
ck("as a download", /attachment; filename="SubSub API\.postman_collection\.json"/.test(res.headers.get("content-disposition") || ""));
ck("readable from Postman's own origin", res.headers.get("access-control-allow-origin") === "*");
ck("and it is the collection", JSON.stringify(served) === JSON.stringify(raw));

console.log("\n-- the Zapier invite link --");
ck("a zapier.com link is taken", zapierInviteUrl("https://zapier.com/developer/public-invite/247047/abc/") !== null);
ck("a subdomain of zapier.com is taken", zapierInviteUrl("https://developer.zapier.com/x") !== null);
ck("plain http is refused", zapierInviteUrl("http://zapier.com/x") === null);
ck("a look-alike host is refused", zapierInviteUrl("https://zapier.com.evil.test/x") === null
  && zapierInviteUrl("https://evilzapier.com/x") === null);
ck("blank is null", zapierInviteUrl("") === null && zapierInviteUrl(undefined) === null);
ck("the API-key switch names Zapier and Postman as what it governs",
  /Zapier/.test(INTEGRATIONS.find((i) => i.id === "api")?.what) && /Postman/.test(INTEGRATIONS.find((i) => i.id === "api")?.what));

console.log("\n-- the docs page --");
const dev = readFileSync(new URL("../../developers.html", import.meta.url), "utf8");
ck("developers.html has a Postman section and a Zapier section to link to",
  /<h2 id="postman">/.test(dev) && /<h2 id="zapier">/.test(dev));
ck("its two cards are their own, beside each other", /data-start="postman"/.test(dev) && /data-start="zapier"/.test(dev));
ck("the Zapier card says who it is for", /Not a developer\?/.test(dev));
ck("the Postman section names the address the route serves", dev.includes("https://api.subsub.work/api/v1/postman.json"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
