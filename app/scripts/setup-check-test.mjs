// What the Worker can see, and whether it spots a name that is one letter
// wrong. The near-miss case is the one that matters: it is the reason this
// file exists.
//
//   node scripts/setup-check-test.mjs
import { setupCheck } from "../worker/setup-check.js";
const eq = (l, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  console.log(a === b ? `  ok   ${l}` : `  FAIL ${l}\n       got  ${a}\n       want ${b}`);
  if (a !== b) process.exitCode = 1;
};
const find = (r, id) => r.groups.find(g => g.id === id);

// The real case: a typo that looks correct on a dashboard.
let r = setupCheck({ SUPBASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k", DB: {} });
const auth = find(r, "auth");
eq("partly configured", auth.state, "partial");
eq("names the missing one", auth.vars.find(v => v.name === "SUPABASE_URL").set, false);
eq("spots the typo", auth.vars.find(v => v.name === "SUPABASE_URL").suggestion,
   { name: "SUPBASE_URL", distance: 1 });
eq("the one that is set is left alone", auth.vars.find(v => v.name === "SUPABASE_ANON_KEY").suggestion, null);

// A present sibling is never offered as a misspelling of its neighbour.
r = setupCheck({ STRIPE_SECRET_KEY: "sk", DB: {} });
eq("no false suggestion from a real setting",
   find(r, "billing").vars.find(v => v.name === "STRIPE_WEBHOOK_SECRET").suggestion, null);

// All present, all absent.
r = setupCheck({ SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k" });
eq("fully configured", find(r, "auth").state, "ok");
r = setupCheck({});
eq("nothing set at all", find(r, "auth").state, "off");

// Empty string is not set.
r = setupCheck({ SUPABASE_URL: "   ", SUPABASE_ANON_KEY: "k" });
eq("blank counts as unset", find(r, "auth").state, "partial");

// Bindings are not settings.
r = setupCheck({ DB: {}, FILES: {}, API: {}, SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k" });
eq("bindings ignored", r.unused, []);

// Values never come back.
r = setupCheck({ SUPABASE_URL: "https://secret.example", STRIPE_SECRET_KEY: "sk_live_TOPSECRET" });
eq("no values anywhere", /secret\.example|TOPSECRET/.test(JSON.stringify(r)), false);
