// Work order numbers have to be unique, and there have to be enough of them.
//
// They were four random digits: "WO-" + 1000..9999. Nine thousand of them,
// against a UNIQUE column shared by every account on the platform. That is
// the birthday problem with a very small room. At the 237 work orders this
// database happens to hold, one assignment in forty already failed -- and it
// failed as an unhandled 500, so the screen said the assignment did not work
// and nothing said why. It was found as an intermittent test failure that
// did not reproduce on its own, which is exactly how a customer would have
// met it.
//
// Six digits now, and a retry on the collision, because headroom is not a
// guarantee. The format check below is the part that cannot pass by luck.
//
//   node scripts/wo-number-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";
const BATCH = 40;

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const S = Date.now().toString(36);
console.log(`\n-- issuing ${BATCH} work orders back to back --`);
const issued = [], failures = [];
for (let i = 0; i < BATCH; i++) {
  const job = await (await fetch(`${API}/jobs`, { method: "POST", headers: H,
    body: JSON.stringify({ title: `WO number probe ${S}-${i}`, propertyId: "p1", address: "101 Main St", trades: ["roofing"] }) })).json();
  const res = await fetch(`${API}/jobs/${job.id}/assign`, { method: "POST", headers: H,
    body: JSON.stringify({ trade: "roofing", companyId: "cmp_r", value: "150", responseWindow: "24h" }) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) failures.push(`#${i} HTTP ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  else issued.push(body.woNumber);
}

ck(`all ${BATCH} were issued`, failures.length === 0, failures.slice(0, 3).join(" | "));
ck("every number came back", issued.length === BATCH && issued.every(Boolean), `${issued.length} numbers`);

// The deterministic one. Four digits cannot pass this; six always does.
const shaped = issued.filter((n) => /^WO-\d{6}$/.test(n));
ck("each is WO- plus six digits", shaped.length === issued.length,
  issued.find((n) => !/^WO-\d{6}$/.test(n)) || `${shaped.length}/${issued.length}`);

ck("no two of them are the same", new Set(issued).size === issued.length,
  `${new Set(issued).size} distinct of ${issued.length}`);

// And nothing already in the table shares one, which is what the UNIQUE
// constraint would have refused.
const all = await (await fetch(`${API}/jobs`, { headers: H })).json();
const seen = new Map();
let dupes = 0;
// The jobs API calls it `wo` on an assignment, not `woNumber` -- that name
// is only on the assign response.
all.forEach((j) => Object.values(j.assignments || {}).forEach((a) => {
  if (!a?.wo) return;
  if (seen.has(a.wo)) dupes++;
  seen.set(a.wo, true);
}));
ck("no duplicate number anywhere in the account", dupes === 0, `${dupes} duplicated`);
ck("the room is big enough to matter", seen.size > 0 && seen.size < 900000, `${seen.size} live numbers in 900,000`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
