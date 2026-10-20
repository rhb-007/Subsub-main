// The integrations an account switches on and off for itself.
//
// Every one of these runs on the ACCOUNT'S OWN credentials or its own
// systems: an API key it minted, a webhook its CRM posts to, an inspection
// app it pays for. That is what puts them in one place in Account and gives
// each a switch -- the account is the only party that knows whether its
// Zapier account is still live, and the only one that should be able to
// stop something posting into it.
//
// NO ROW MEANS ON. Every integration that already works keeps working when
// this ships, with nothing backfilled, the same asymmetry `engagedAs` and
// `jobScopeFrom` use. And a database without migration 090 reads as on
// rather than off: a missing table must not silently stop every job that
// arrives from a CRM, which would cost somebody their work to report our
// schema.
//
// OFF IS ENFORCED ON THE SERVER, at the token check every door shares. A
// switch the receiver did not read would be a switch that lies -- the
// sender would go on landing jobs while the screen said it was off.
//
// `connect: "token"` is one SubSub READS FROM with the account's own token,
// pasted in Account -> Integrations and stored sealed (worker/secretbox.js).
// Its switch is drawn only once it is connected, because switching on
// something with no credential behind it changes nothing.
//
// `soon` is an integration SubSub cannot yet connect to. It is listed so an
// account sees what is coming, and it has no switch: a control that changes
// nothing is the screen-that-lies rule pointed at a toggle.

export const INTEGRATIONS = [
  {
    id: "api",
    name: "Your API key",
    what: "Anything that posts with your API key: the Zapier app, Make, n8n, Postman or code you write.",
    uses: "An API key",
  },
  {
    id: "jobnimbus",
    name: "JobNimbus",
    what: "Jobs your JobNimbus automation posts to its SubSub webhook address.",
    uses: "A webhook address",
    source: "jobnimbus",
  },
  {
    id: "webhooks",
    name: "Other CRMs",
    what: "Jobs any other system posts to the generic webhook address.",
    uses: "A webhook address",
    source: "generic",
  },
  {
    id: "inspection_hooks",
    name: "Inspection apps",
    what: "Unit walks your inspection app posts in. Each arrives as a draft.",
    uses: "A webhook address",
    buildings: true,
  },
  {
    id: "hover",
    name: "Hover",
    what: "Attach a Hover measurement report to a job, so the work order carries it.",
    uses: "Your Hover account",
    soon: true,
  },
  {
    id: "companycam",
    name: "CompanyCam",
    what: "Import a CompanyCam project's photos and documents onto a job, measurement reports included, so the work order carries them.",
    uses: "Your CompanyCam access token",
    connect: "token",
    // Where the token is made is CompanyCam's screen, not ours, so this names
    // their own help article rather than a menu path that may move.
    tokenHelp: "Create an access token in your CompanyCam account (CompanyCam's help article \"Building custom integrations with CompanyCam's API\" shows where), then paste it here.",
  },
  {
    id: "aurora",
    name: "Aurora Solar",
    what: "Attach an Aurora design's measurements to a job, so the work order carries them.",
    uses: "Your Aurora API key",
    soon: true,
  },
];

export const INTEGRATION_IDS = INTEGRATIONS.map((i) => i.id);

export const integrationById = (id) =>
  INTEGRATIONS.find((i) => i.id === String(id || "")) || null;

// Which switch governs a jobs webhook. A CRM with a receiver of its own has
// its own switch; anything posting to the generic address is "other CRMs".
// A source added to SOURCE_PRESETS later falls under "webhooks" until it is
// given a row here, which is the safe direction: it can still be stopped.
export function hookIntegration(source) {
  const s = String(source || "").toLowerCase();
  const own = INTEGRATIONS.find((i) => i.source === s && i.id !== "webhooks");
  return own ? own.id : "webhooks";
}

// Whether this integration applies to an account of this kind at all.
// Inspection apps need units to walk, so only an account with buildings
// gets that one; the caller passes the answer rather than this module
// importing the account-kind list.
export function integrationApplies(integration, { hasBuildings } = {}) {
  if (!integration) return false;
  if (integration.buildings && !hasBuildings) return false;
  return true;
}

// The stored answer, read once. `rows` is what the table holds for this
// account: [{provider, enabled}]. Anything absent is on.
export function integrationEnabled(rows, id) {
  const row = (rows || []).find((r) => r.provider === id);
  if (!row) return true;
  return Number(row.enabled) !== 0;
}

// The Zapier app's invite link, or null. While the app is private, Zapier
// hands out a link (Manage -> Sharing) that adds it to somebody's Zapier
// account; it is set as ZAPIER_INVITE_URL on the API Worker. Only a zapier.com
// address is accepted: a typo or a pasted page from somewhere else must not
// become the button every account presses.
export function zapierInviteUrl(raw) {
  const s = String(raw || "").trim();
  return /^https:\/\/(?:[a-z0-9-]+\.)*zapier\.com\/[^\s"'<>]*$/i.test(s) ? s : null;
}
