// What this Worker can actually see, and what it cannot.
//
// Written after an afternoon spent comparing a screenshot of the Cloudflare
// dashboard against a list of names by eye. Password resets were failing with
// nothing to go on, the console kept working because staff sign in through
// Access rather than Supabase, and the only way to check whether
// SUPABASE_URL was really set was to read it off a photograph. A name that
// is one letter wrong looks exactly like a name that is right.
//
// So the Worker says. Names only, never values: this answers "is it set",
// which is the question, and a console that prints secrets is a console that
// leaks them into a screenshot the next time somebody asks for help.
//
// The near-miss check is the point of the whole file. A missing SUPABASE_URL
// beside a present SUPBASE_URL is a typo, not an absence, and saying so
// turns an afternoon into a glance.

const GROUPS = [
  {
    id: "auth", label: "Customer sign-in (Supabase)",
    vars: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    matters: "Without these, customers cannot sign in and password resets cannot be sent. "
      + "Staff sign in through Cloudflare Access instead, so this console keeps working either way — "
      + "which is exactly why a missing one goes unnoticed.",
  },
  {
    id: "mail", label: "Email (Resend)",
    vars: ["RESEND_API_KEY", "MAIL_FROM"],
    matters: "Document requests, work orders and application receipts. "
      + "Password reset mail comes from Supabase, not from here.",
  },
  {
    id: "billing", label: "Billing (Stripe)",
    vars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_SCALE_MONTHLY", "STRIPE_PRICE_SCALE_ANNUAL"],
    matters: "Checkout, the billing portal, and the webhook that tells SubSub somebody paid. "
      + "Without the webhook secret, payments succeed at Stripe and never reach the account.",
  },
  {
    id: "hostnames", label: "Branded addresses (Cloudflare)",
    vars: ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_ZONE_ID", "CF_PAGES_PROJECT"],
    matters: "Provisioning a Scale account's own address. Unset, nothing is provisioned and "
      + "no address fails — it simply never starts.",
  },
  {
    id: "staff", label: "Staff sign-in (Cloudflare Access)",
    vars: ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD"],
    matters: "How this console verifies that a request really came through Access.",
  },
  {
    id: "cron", label: "Scheduled jobs",
    vars: ["CRON_SECRET"],
    matters: "Only needed to run a nightly sweep by hand; the schedule itself does not use it.",
  },
];

// Every name the Worker was given a string for. Bindings -- the database, the
// bucket, a service -- are objects, and listing them here would suggest they
// were settings somebody could mistype.
const settingNames = (env) =>
  Object.keys(env || {}).filter((k) => typeof env[k] === "string");

// Ordinary edit distance, capped: two names this far apart are not a typo of
// each other and running the full matrix on every pair is wasted work.
function distance(a, b, cap = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

// The name somebody probably meant to type. Only offered when it is not
// itself a setting the Worker wants -- otherwise a present STRIPE_SECRET_KEY
// would be suggested as a misspelling of STRIPE_WEBHOOK_SECRET.
function nearMiss(wanted, present, allWanted) {
  let best = null, bestD = Infinity;
  for (const name of present) {
    if (allWanted.has(name)) continue;
    const d = distance(wanted, name);
    if (d < bestD) { bestD = d; best = name; }
  }
  return bestD <= 3 ? { name: best, distance: bestD } : null;
}

export function setupCheck(env) {
  const present = settingNames(env);
  const has = new Set(present.filter((k) => String(env[k]).trim() !== ""));
  const allWanted = new Set(GROUPS.flatMap((g) => g.vars));

  const groups = GROUPS.map((g) => {
    const vars = g.vars.map((name) => {
      const set = has.has(name);
      return {
        name, set,
        // A name one letter out is the single likeliest reason for a
        // setting to be "missing" on a dashboard that visibly lists it.
        suggestion: set ? null : nearMiss(name, present, allWanted),
      };
    });
    const missing = vars.filter((v) => !v.set);
    return {
      id: g.id, label: g.label, matters: g.matters, vars,
      // Partly configured is its own state and the worst one: half a Stripe
      // setup takes payments it cannot record.
      state: missing.length === 0 ? "ok" : missing.length === g.vars.length ? "off" : "partial",
    };
  });

  // Anything set that nothing reads. Usually a rename left behind, sometimes
  // the other half of a typo.
  const unused = present
    .filter((k) => !allWanted.has(k) && !k.startsWith("VITE_")
      && !["STAFF_EMAIL_DOMAIN", "STAFF_ALLOW_PASSWORD", "APP_DOMAIN", "RESEND_API_BASE"].includes(k));

  return { groups, unused };
}
