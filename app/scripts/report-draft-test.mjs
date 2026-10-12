// A TENANT'S REPORT, DRAFTED FROM THEIR PHOTOS -- the route and the rules.
//
// Asked for as "AI should be able to scan the image and automatically write a
// description of the issues in the picture ... fully automated on the tenant
// side". Stubbed at `fetch`, which is what `ANTHROPIC_API_BASE` is for, so the
// request shape is asserted on what Anthropic would actually receive.
//
//   node --no-warnings scripts/report-draft-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { reportDraftChoices, readReportDraft, reportDraftSchema, reportDraftSystem,
  REPORT_DRAFT_MODEL, SOMETHING_ELSE } from "../shared/reportdraft.js";
import { DRAFT_MODEL, knowsThinking } from "../shared/photodraft.js";
import { TENANT_PROBLEMS } from "../shared/tenantproblems.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const sent = [];
let reply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://claude.test")) return realFetch(url, init);
  sent.push({ url: u, body: JSON.parse(init.body) });
  if (typeof reply === "function") return reply();
  return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
};
const answer = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_pm','Sound','property_manager','soundpm','scale');
INSERT INTO users(id,name,email) VALUES ('u_mgr','Chris','c@x.t'),('u_ten','John Smith','j@x.t'),('u_own','Ann','a@x.t');
INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES ('prop_1','acc_pm','Press','1620 Belmont','Seattle','WA','98122');
INSERT INTO memberships(id,user_id,account_id,role) VALUES
  ('m_mgr','u_mgr','acc_pm','admin'),('m_ten','u_ten','acc_pm','tenant'),('m_own','u_own','acc_pm','owner');
INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1'),('m_own','prop_1');
`);
const env = { DB: makeD1(db), ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_API_BASE: "https://claude.test/v1" };
const call = (method, body, who = "u_ten", e = env) => worker.fetch(new Request("https://api.subsub.work/api/report-draft", {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" } }), e);
const PHOTO = "A".repeat(4000);

try {
  console.log("\n-- the rules --");
  const home = reportDraftChoices("home");
  ck("the model never chooses an emergency", !home.some((l) => TENANT_PROBLEMS.find((p) => p.label === l)?.g === "Emergency"));
  ck("an office tenant is not offered a bath", !reportDraftChoices("office").includes("The tub or shower won't drain")
    && home.includes("The tub or shower won't drain"));
  ck("Something else is always a choice", home.includes(SOMETHING_ELSE));
  ck("one model with the photo drafts, and its thinking setting is known",
    REPORT_DRAFT_MODEL === DRAFT_MODEL && knowsThinking(REPORT_DRAFT_MODEL));
  ck("the schema's problem is the list, as an enum", JSON.stringify(reportDraftSchema(home).properties.problem.enum) === JSON.stringify(home));
  let d = readReportDraft({ problem: "Not a real label", title: "Leak.", description: "Water.", unclear: false, urgent: false }, home);
  ck("a problem not on the list files under Something else, so the fields still draw, and the title loses its period",
    d.problem === SOMETHING_ELSE && d.title === "Leak", JSON.stringify(d));
  d = readReportDraft({ problem: "My sink is leaking", title: "x", description: "It is dark.", unclear: true, urgent: false }, home);
  ck("an unclear answer offers no problem and no title", d.problem === null && d.title === "" && d.unclear);
  const sys = reportDraftSystem();
  ck("the prompt asks for American English in the tenant's voice", /American English/.test(sys) && /first person/.test(sys));
  ck("and refuses cause and blame", /caused it or whose fault/.test(sys));

  console.log("\n-- who may ask --");
  let r = await call("GET");
  ck("a tenant is told it is on", r.status === 200 && (await r.json()).configured === true);
  r = await call("GET", null, "u_ten", { ...env, ANTHROPIC_API_KEY: "" });
  ck("and that it is off with no key", r.status === 200 && (await r.json()).configured === false);
  r = await call("POST", { photos: [PHOTO] }, "u_own");
  ck("an owner seat cannot spend it", r.status === 403, String(r.status));
  r = await call("POST", { photos: [PHOTO] }, "u_mgr");
  ck("nor the manager -- it is the tenant's form", r.status === 403, String(r.status));

  console.log("\n-- the request --");
  reply = answer({ problem: "My sink is leaking", title: "Water under the kitchen sink",
    description: "There's water pooling under my kitchen sink.", unclear: false, urgent: false });
  sent.length = 0;
  r = await call("POST", { photos: [PHOTO, PHOTO], where: "home", problem: "", words: "it started Tuesday" });
  const got = await r.json();
  ck("it answers the form", r.status === 200 && got.problem === "My sink is leaking"
    && got.title === "Water under the kitchen sink" && /pooling/.test(got.description), JSON.stringify(got));
  const body = sent[0]?.body;
  ck("both photos go, as JPEG images", body?.messages?.[0]?.content?.filter((x) => x.type === "image").length === 2
    && body.messages[0].content.every((x) => x.type !== "image" || x.source.media_type === "image/jpeg"));
  ck("the tenant's own words go as context", JSON.stringify(body?.messages).includes("it started Tuesday"));
  const wire = JSON.stringify(body || {});
  ck("no name, no address, no account goes with them",
    !/John Smith|1620 Belmont|Sound|acc_pm|u_ten/.test(wire), wire.slice(0, 200));
  ck("structured output, with the list as the enum",
    body?.output_config?.format?.schema?.properties?.problem?.enum?.length === home.length);
  ck("and no thinking field for this model", !("thinking" in (body || {})));
  ck("nothing is stored", db.prepare(`SELECT COUNT(*) n FROM jobs`).get().n === 0);

  console.log("\n-- what it refuses --");
  sent.length = 0;
  r = await call("POST", { photos: ["A".repeat(600 * 1024)] });
  ck("a photo past the ceiling is refused before anything is sent", r.status === 413 && sent.length === 0);
  r = await call("POST", { photos: [] });
  ck("no photos, no call", r.status === 400 && sent.length === 0);
  sent.length = 0;
  r = await call("POST", { photos: Array(9).fill(PHOTO) });
  ck("at most six photos are read", sent[0]?.body?.messages?.[0]?.content?.filter((x) => x.type === "image").length === 6);
  r = await call("POST", { photos: [PHOTO] }, "u_ten", { ...env, ANTHROPIC_API_KEY: "" });
  ck("with no key it says so by name", r.status === 503 && (await r.json()).error === "ai_not_configured");
  reply = () => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "busy" } }), { status: 529 });
  r = await call("POST", { photos: [PHOTO] });
  ck("an outage is ai_unavailable, not a 500", r.status === 502 && (await r.json()).error === "ai_unavailable");

  console.log("\n-- the screen --");
  const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
  const tenantForm = src.slice(src.indexOf("// ---- Their photos, read for them"), src.indexOf("const isSeeded = (k) =>"));
  ck("adding photos runs the draft with no button", /\[shotKey, aiOn, !!form\]/.test(tenantForm) && /api\.draftReport\(/.test(tenantForm));
  ck("photos are downscaled first", /jpegForDraft\(sh\.url\)/.test(tenantForm));
  ck("a field the tenant typed in is left alone",
    /!f\.scope\.trim\(\) \|\| f\.scope === s0\.scope/.test(tenantForm)
    && /!f\.title\.trim\(\) \|\| f\.title === s0\.title/.test(tenantForm));
  ck("a problem they picked is left alone", /!f\.problem \|\| f\.problem\.label === s0\.problem/.test(tenantForm));
  ck("a stale answer is dropped", /ticket !== drafting\.current/.test(tenantForm));
  const allow = readFileSync(join(app, "worker", "index.js"), "utf8");
  const ta = allow.slice(allow.indexOf("const TENANT_ALLOWED = ["), allow.indexOf("];", allow.indexOf("const TENANT_ALLOWED = [")));
  ck("the tenant allowlist carries it", /report-draft/.test(ta));
} catch (e) { fail++; console.log("FAIL  threw", e); }
globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
