import React, { useState, useMemo, useEffect, useRef } from "react";

// ---- Build target ----------------------------------------------------------
// "tenant"   → the customer app (app.subsub.work and each GC's own subdomain).
//              No route to the internal console exists.
// "platform" → SubSub's internal console (admin.subsub.work). Boots straight
//              into the staff login and never shows a customer's branding.
//
// Set at BUILD time, not run time: Vite substitutes the literal, so in a tenant
// build every `BUILD === "platform"` branch folds to false and the console code
// is dropped by the minifier. That is what keeps the console bundle off the
// customer domain — deploy the two hostnames as two builds of this one repo:
//
//   VITE_BUILD=tenant   npm run build     # app.subsub.work, *.subsub.work
//   VITE_BUILD=platform npm run build     # admin.subsub.work
//
// Anything the console must not expose is still enforced server-side; this
// flag only decides what ships to the browser.
const BUILD = import.meta.env.VITE_BUILD === "platform" ? "platform" : "tenant";
import {
  Search, Phone, Mail, MapPin, FileText, Shield, ScrollText, Calendar,
  CheckCircle2, AlertTriangle, X, Plus, Send, Upload, Filter, Star,
  Hammer, Home, PanelTop, Wind, Fence, Layers, Building2, ClipboardList,
  Users, StickyNote, Check, XCircle, Clock, Target, ChevronDown, ChevronRight, Pencil, Trash2, UserCog, Zap, Ruler, BrickWall, LogOut, LogIn, Lock, Download, Shirt, ArrowUpDown, Bell, Receipt, Wrench, ShieldCheck,
  Blocks, Sun, Frame, Square, Layers3, Shovel, Droplet, Thermometer,
  Snowflake, SquareStack, PaintRoller, LayoutGrid, Grid3x3, Boxes, Slice, Trees,
  DoorOpen, Droplets, SprayCan, FilePlus2, TrendingUp, Activity, Link2, Copy, Key,
  Globe, RefreshCw, ExternalLink,
} from "lucide-react";
import { api, getAuth, setAuth, clearAuth, clearStoredAuth, logoUrl } from "./lib/api";
import { supabase, supabaseEnabled } from "./lib/supabaseClient";

// What a confirmation or reset link left in the address bar.
//
// Read at module load, which is the only safe moment: the Supabase client is
// configured with detectSessionInUrl, so it reads the fragment and clears it
// as soon as it can. Reading late means not reading at all.
//
// Everything a link has to say is in that fragment -- whether it worked,
// what kind of link it was, and why it did not -- and until now nothing in
// the app looked. A valid reset link landed on the sign-in screen and did
// nothing, because there was no page that asks for a new password; an
// expired one landed on the same screen with the reason hidden in the URL.
const AUTH_LINK = (() => {
  if (typeof window === "undefined") return {};
  const h = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  return {
    error: h.get("error_description") || h.get("error") || "",
    errorCode: h.get("error_code") || "",
    type: h.get("type") || "",
  };
})();

// ---- Persistence bridge ---------------------------------------------------
// The app below still reads/writes plain useState — every mutator additionally
// calls the API so it survives a reload. See "persistence wiring" further
// down for where each handler picks up its api.* call, and lib/api.js for
// the client itself. Errors from a write-through call are logged, not
// thrown — the local optimistic update already happened, so a transient
// network failure doesn't freeze the UI; it just means that one write may
// not have persisted (worth a toast in a later pass).
const persist = (label, promise) => {
  promise?.catch?.((err) => console.error(`[persist] ${label} failed:`, err));
};

// ---- Domain constants ----------------------------------------------------
const CATEGORIES = [
  // Exterior
  { id: "roofing", label: "Roofing", icon: Home },
  { id: "siding", label: "Siding", icon: PanelTop },
  { id: "windows_doors", label: "Windows / Doors", icon: Building2 },
  { id: "gutters", label: "Gutters", icon: Wind },
  { id: "soffit_fascia", label: "Soffit / Fascia", icon: Ruler },
  { id: "coping", label: "Coping", icon: BrickWall },
  { id: "masonry", label: "Masonry / Brick", icon: Blocks },
  { id: "solar", label: "Solar", icon: Sun },
  // Structure & site
  { id: "framing", label: "Framing", icon: Frame },
  { id: "concrete", label: "Concrete", icon: Square },
  { id: "foundation", label: "Foundation", icon: Layers3 },
  { id: "excavation", label: "Excavation / Grading", icon: Shovel },
  { id: "demolition", label: "Demolition", icon: Hammer },
  // Mechanical, electrical, plumbing
  { id: "electrical", label: "Electrical", icon: Zap },
  { id: "plumbing", label: "Plumbing", icon: Droplet },
  { id: "hvac", label: "HVAC", icon: Thermometer },
  { id: "insulation", label: "Insulation", icon: Snowflake },
  // Interior finishes
  { id: "drywall", label: "Drywall / Sheetrock", icon: SquareStack },
  { id: "painting", label: "Painting", icon: PaintRoller },
  { id: "flooring", label: "Flooring / Carpet", icon: LayoutGrid },
  { id: "tile_stone", label: "Tile / Stone", icon: Grid3x3 },
  { id: "cabinets_counters", label: "Cabinets / Countertops", icon: Boxes },
  { id: "trim_carpentry", label: "Finish Carpentry", icon: Slice },
  // Outdoor
  { id: "deck_fence", label: "Deck / Fence", icon: Fence },
  { id: "hardscaping", label: "Hardscaping", icon: Layers },
  { id: "landscaping", label: "Landscaping", icon: Trees },
  // Specialty
  { id: "garage_doors", label: "Garage Doors", icon: DoorOpen },
  { id: "restoration", label: "Water / Fire Restoration", icon: Droplets },
  { id: "cleaning", label: "Final Clean", icon: SprayCan },
];

// The same six groups the signup page shows, in the same order. Ids only --
// labels come from CATEGORIES, so a rename happens in one place.
const TRADE_GROUPS = [
  ["Exterior", ["roofing", "siding", "windows_doors", "gutters", "soffit_fascia", "coping", "masonry", "solar"]],
  ["Structure & site", ["framing", "concrete", "foundation", "excavation", "demolition"]],
  ["Mechanical, electrical, plumbing", ["electrical", "plumbing", "hvac", "insulation"]],
  ["Interior finishes", ["drywall", "painting", "flooring", "tile_stone", "cabinets_counters", "trim_carpentry"]],
  ["Outdoor", ["deck_fence", "hardscaping", "landscaping"]],
  ["Specialty", ["garage_doors", "restoration", "cleaning"]],
];

// id -> label, so a rename in CATEGORIES reaches every place that prints one.
const TRADE_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const CAP_LIBRARY = {
  roofing: ["Asphalt shingle", "Metal roof", "Cedar shake", "Flat / TPO", "Tear-off", "Repair / leak", "Skylight"],
  siding: ["Fiber cement", "Vinyl", "LP SmartSide", "Cedar", "Stucco", "Board & batten"],
  windows_doors: ["Vinyl windows", "Wood windows", "Entry doors", "Patio / slider", "Egress cut-in", "Trim / casing"],
  gutters: ["5\" K-style", "6\" oversized", "Seamless", "Gutter guards", "Downspout / drainage"],
  soffit_fascia: ["Aluminum soffit", "Vented soffit", "Fascia wrap", "Cedar soffit", "Repair / rot"],
  coping: ["Metal coping", "Stone coping", "Parapet detail", "Custom bend"],
  masonry: ["Brick veneer", "Block wall", "Stone veneer", "Chimney repair", "Tuckpointing", "Repair / restoration"],
  solar: ["Roof-mount PV", "Ground-mount PV", "Battery storage", "Inverter swap", "Panel removal / reset"],

  framing: ["Rough framing", "Floor systems", "Roof trusses", "Steel stud", "Structural repair", "Additions"],
  concrete: ["Flatwork / slab", "Footings", "Stem walls", "Driveway / approach", "Stamped / decorative", "Cut & remove"],
  foundation: ["Stem wall", "Crawlspace", "Underpinning", "Waterproofing", "Drainage / french drain", "Crack repair"],
  excavation: ["Site prep", "Grading", "Trenching", "Utility dig", "Haul-off", "Backfill / compaction"],
  demolition: ["Interior strip-out", "Full teardown", "Selective demo", "Debris haul-off", "Asbestos-aware"],

  electrical: ["Rough-in", "Panel upgrade", "Service change", "Lighting / fixtures", "EV charger", "Generator", "Low voltage", "Troubleshooting"],
  plumbing: ["Rough-in", "Repipe", "Water heater", "Tankless", "Fixtures / trim", "Sewer / drain", "Gas line", "Leak repair"],
  hvac: ["Furnace", "AC / condenser", "Heat pump", "Mini-split", "Ductwork", "Ventilation", "Service / maintenance"],
  insulation: ["Batt", "Blown-in", "Spray foam", "Rigid board", "Air sealing", "Attic / crawlspace"],

  drywall: ["Hang", "Tape / mud", "Texture", "Level 5 finish", "Patch / repair", "Ceilings"],
  painting: ["Interior", "Exterior", "Cabinet refinish", "Spray / lacquer", "Stain / seal", "Prep / prime"],
  flooring: ["LVP / vinyl plank", "Hardwood", "Engineered wood", "Carpet", "Laminate", "Sheet vinyl", "Subfloor prep", "Refinish / sand"],
  tile_stone: ["Floor tile", "Shower / wet wall", "Backsplash", "Natural stone", "Large format", "Waterproofing", "Heated floor"],
  cabinets_counters: ["Cabinet install", "Custom cabinetry", "Quartz", "Granite", "Solid surface", "Templating", "Refacing"],
  trim_carpentry: ["Base / casing", "Crown molding", "Interior doors", "Stairs / railing", "Built-ins", "Wainscot / paneling"],

  deck_fence: ["Composite deck", "Cedar deck", "PT framing", "Wood fence", "Vinyl fence", "Railing", "Pergola"],
  hardscaping: ["Paver patio", "Retaining wall", "Concrete flatwork", "Walkway", "Fire pit", "Drainage / grading"],
  landscaping: ["Planting / beds", "Sod / seed", "Irrigation", "Tree work", "Bark / rock", "Maintenance"],

  garage_doors: ["Door install", "Opener", "Spring / cable repair", "Insulated door", "Custom / carriage"],
  restoration: ["Water mitigation", "Fire / smoke", "Mold remediation", "Structural drying", "Contents / pack-out"],
  cleaning: ["Construction clean", "Final / detail clean", "Window clean", "Pressure wash", "Debris removal"],
};

const AREAS = ["Seattle", "Bellevue", "Tacoma", "Everett", "Kirkland", "Renton", "Kent", "Redmond", "Lynnwood", "Auburn"];

// Approx lat/lng centroids for demo proximity math (no geocoding backend).
const ZIP_GEO = {
  "98101": [47.6106, -122.3345], "98004": [47.6180, -122.2043], "98402": [47.2529, -122.4443],
  "98201": [47.9790, -122.2021], "98033": [47.6769, -122.2060], "98052": [47.6740, -122.1215],
  "98055": [47.4519, -122.2043], "98032": [47.3809, -122.2348], "98037": [47.8279, -122.2854],
  "98002": [47.3082, -122.2126], "90210": [34.0901, -118.4065],
};
const CITY_ZIP = {
  Seattle: "98101", Bellevue: "98004", Tacoma: "98402", Everett: "98201", Kirkland: "98033",
  Redmond: "98052", Renton: "98055", Kent: "98032", Lynnwood: "98037", Auburn: "98002",
};
// Haversine miles; falls back to a stable pseudo-distance for unknown ZIPs.
function zipDistance(a, b) {
  if (!a || !b) return null;
  if (a === b) return 0;
  const ga = ZIP_GEO[a], gb = ZIP_GEO[b];
  if (ga && gb) {
    const [la1, lo1] = ga, [la2, lo2] = gb;
    const R = 3958.8, toR = (d) => (d * Math.PI) / 180;
    const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  // unknown ZIP: deterministic estimate so the UI still behaves
  const n = (z) => [...String(z)].reduce((s, c) => s + c.charCodeAt(0), 0);
  return Math.abs(n(a) - n(b)) % 60;
}
const RATING_TIERS = [4.5, 4.0, 3.5, 3.0];
const EARN_TIERS = [
  { id: "0", label: "No earnings yet", test: (n) => n === 0 },
  { id: "1", label: "Under $10k", test: (n) => n > 0 && n < 10000 },
  { id: "2", label: "$10k – $50k", test: (n) => n >= 10000 && n < 50000 },
  { id: "3", label: "$50k+", test: (n) => n >= 50000 },
];
const SORTS = [
  { id: "match", label: "Best match" },
  { id: "rating", label: "Rating (high → low)" },
  { id: "earned", label: "Earnings (high → low)" },
  { id: "completed", label: "Jobs completed (most)" },
  { id: "accept", label: "Accept rate (high → low)" },
  { id: "crew", label: "Crew size (largest)" },
  { id: "name", label: "Company name (A → Z)" },
  { id: "distance", label: "Distance (nearest)" },
];
const DONE_TIERS = [
  { id: "0", label: "None yet", test: (n) => n === 0 },
  { id: "1", label: "1 – 5 jobs", test: (n) => n >= 1 && n <= 5 },
  { id: "2", label: "6 – 20 jobs", test: (n) => n >= 6 && n <= 20 },
  { id: "3", label: "20+ jobs", test: (n) => n > 20 },
];
// Work-order trades map to sub categories for recommendations
const WO_TRADES = [
  { id: "roofing", label: "Roofing" },
  { id: "siding", label: "Siding" },
  { id: "windows_doors", label: "Windows" },
  { id: "gutters", label: "Gutters" },
  { id: "deck_fence", label: "Deck / Fence" },
  { id: "hardscaping", label: "Hardscaping" },
  { id: "soffit_fascia", label: "Soffit / Fascia" },
  { id: "coping", label: "Coping" },
];
const CREW_TIERS = [
  { id: "1-3", label: "1–3", test: (n) => n <= 3 },
  { id: "4-7", label: "4–7", test: (n) => n >= 4 && n <= 7 },
  { id: "8+", label: "8+", test: (n) => n >= 8 },
];

// ---- Sample data ---------------------------------------------------------
// coverage: { cities:[...], radius:{ zip, miles }|null } — cities and/or a travel radius
// Demo off-days: a few upcoming dates so availability is visible immediately.
const _d = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const seedSubs = [
  {
    id: 1, company: "Cascade Roofworks", contact: "Miguel Alvarez", phone: "206-555-0142",
    email: "miguel@cascaderoof.com", categories: ["roofing", "gutters"],
    warranty: "10",
    license: "CASCADR842KL", ubi: "603221887",
    licenseCheck: { found: true, licenseNumber: "CASCADR842KL", businessName: "Cascade Roofworks", licenseType: "CONSTRUCTION CONTRACTOR", status: "ACTIVE", effectiveDate: "2023-04-11", expirationDate: _d(420), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(420) }, checkedAt: _d(-7) },
    mailStreet: "4120 Airport Way S", mailCity: "Seattle", mailState: "WA", mailZip: "98108",
    city: "Seattle", state: "WA", zip: "98108",
    caps: ["Asphalt shingle", "Metal roof", "Tear-off", "Repair / leak", "Seamless"],
    coverage: { mode: "cities", cities: ["Seattle", "Bellevue", "Renton", "Kent"], radii: [] },
    crews: [
      { id: "c1", name: "Roof Crew A", available: true, unavailableDays: [_d(3), _d(4)], members: [
        { name: "Miguel Alvarez", role: "Lead" }, { name: "Diego Ruiz", role: "Installer" },
        { name: "Sam Okafor", role: "Installer" } ] },
      { id: "c2", name: "Roof Crew B", available: true, unavailableDays: [], members: [
        { name: "Luis Mendez", role: "Lead" }, { name: "Ty Brooks", role: "Installer" },
        { name: "Owen Park", role: "Laborer" } ] },
    ],
    rating: 4.8, bond: true, insurance: true, contract: true, available: true,
    accepted: 34, declined: 3,
    notify: { email: true, sms: true },
    unavailableDays: [],
    autoSchedule: true,
    w9: true,
    docFiles: { insurance: "cascade-insurance.pdf", bond: "cascade-bond.pdf", contract: "cascade-agreement.pdf", w9: "cascade-w9.pdf" },
    docReview: { insurance: { status: "verified", limits: { cgl_occ: "1000000", cgl_agg: "2000000", prod_comp: "2000000", auto: "1000000", empl: "1000000", umbrella: "2000000" }, expires: _d(240), checks: { named: true, primary: true, wc: true, current: true, carrier: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-30) }, bond: { status: "verified", amount: "50000", checks: { active: true, amount: true, principal: true, surety: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-30) }, contract: { status: "verified", checks: { signed: true, counter: true, version: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-30) }, w9: { status: "verified", checks: { tin: true, name: true, entity: true, signed: true, current: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-30) } },
    notes: "Preferred roofer. Fast on tear-offs. Owner answers his phone. Net-15 terms.",
  },
  {
    id: 2, company: "Emerald Exteriors", contact: "Dana Cho", phone: "425-555-0198",
    email: "dana@emeraldext.com", categories: ["siding", "windows_doors", "soffit_fascia"],
    warranty: "5",
    license: "EMERALE119QP", ubi: "602884113",
    licenseCheck: { found: true, licenseNumber: "EMERALE119QP", businessName: "Emerald Exteriors", licenseType: "CONSTRUCTION CONTRACTOR", status: "ACTIVE", effectiveDate: "2023-04-11", expirationDate: _d(300), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(300) }, checkedAt: _d(-7) },
    mailStreet: "820 108th Ave NE", mailCity: "Bellevue", mailState: "WA", mailZip: "98004",
    city: "Bellevue", state: "WA", zip: "98004",
    caps: ["Fiber cement", "LP SmartSide", "Cedar", "Trim / casing", "Aluminum soffit", "Fascia board"],
    coverage: { mode: "radius", cities: [], radii: [{ zip: "98004", miles: 30 }] },
    crews: [
      { id: "c1", name: "Siding Crew", available: true, unavailableDays: [], members: [
        { name: "Dana Cho", role: "Lead" }, { name: "Marco Reyes", role: "Installer" },
        { name: "Beth Lang", role: "Installer" }, { name: "Kai Winters", role: "Laborer" } ] },
    ],
    rating: 4.5, bond: true, insurance: true, contract: false, available: true,
    accepted: 21, declined: 5,
    notify: { email: true, sms: false },
    unavailableDays: [],
    autoSchedule: false,
    docFiles: { insurance: "emerald-insurance.pdf", bond: "emerald-bond.pdf", contract: null },
    docReview: { insurance: { status: "pending" }, bond: { status: "verified", amount: "30000", checks: { active: true, amount: true, principal: true, surety: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-12) } },
    notes: "Great fiber cement work. Books out ~2 weeks. Still need signed contract on file.",
  },
  {
    id: 3, company: "Rainshield Gutters", contact: "Tom Betancourt", phone: "253-555-0177",
    email: "tom@rainshield.com", categories: ["gutters"],
    warranty: "2",
    license: "RAINSHG733X", ubi: "601447290",
    licenseCheck: { found: true, licenseNumber: "RAINSHG733X", businessName: "Rainshield Gutters", licenseType: "CONSTRUCTION CONTRACTOR", status: "EXPIRED", effectiveDate: "2023-04-11", expirationDate: _d(-40), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(400) }, checkedAt: _d(-7) },
    city: "Tacoma", state: "WA", zip: "98409",
    caps: ["Seamless", "6\" oversized", "Gutter guards", "Downspout / drainage"],
    coverage: { mode: "cities", cities: ["Tacoma", "Auburn", "Kent"], radii: [] },
    crews: [
      { id: "c1", name: "Gutter Crew", available: true, unavailableDays: [], members: [
        { name: "Tom Betancourt", role: "Lead" }, { name: "Rico Salas", role: "Installer" } ] },
    ],
    rating: 4.2, bond: false, insurance: true, contract: true, available: false,
    accepted: 12, declined: 8,
    notify: { email: true, sms: true },
    unavailableDays: [],
    autoSchedule: false,
    docFiles: { insurance: "rainshield-insurance.pdf", bond: null, contract: "rainshield-agreement.pdf" },
    docReview: { insurance: { status: "rejected", note: "Outerhome is not listed as additional insured — please ask your carrier to add us and resend.", verifiedBy: "Richard Braun", verifiedAt: _d(-5) }, contract: { status: "pending" } },
    notes: "Small crew, south-end only. Declines a lot when busy. No bond yet.",
  },
  {
    id: 4, company: "Northwest Window Co", contact: "Priya Nair", phone: "206-555-0231",
    email: "priya@nwwindow.com", categories: ["windows_doors"],
    warranty: "lifetime",
    license: "NORTHWW551MC", ubi: "604112556",
    licenseCheck: { found: true, licenseNumber: "NORTHWW551MC", businessName: "Northwest Window Co", licenseType: "CONSTRUCTION CONTRACTOR", status: "ACTIVE", effectiveDate: "2023-04-11", expirationDate: _d(500), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(500) }, checkedAt: _d(-7) },
    city: "Seattle", state: "WA", zip: "98134",
    caps: ["Vinyl windows", "Entry doors", "Patio / slider", "Egress cut-in"],
    coverage: { mode: "radius", cities: [], radii: [{ zip: "98101", miles: 40 }, { zip: "98201", miles: 20 }] },
    crews: [
      { id: "c1", name: "Install Team 1", available: true, unavailableDays: [_d(6), _d(7)], members: [
        { name: "Priya Nair", role: "Lead" }, { name: "Josh Hale", role: "Installer" },
        { name: "Amir Fadel", role: "Installer" } ] },
      { id: "c2", name: "Install Team 2", available: true, unavailableDays: [], members: [
        { name: "Grace Liu", role: "Lead" }, { name: "Neil Ross", role: "Installer" } ] },
    ],
    rating: 4.9, bond: true, insurance: true, contract: true, available: true,
    accepted: 47, declined: 2,
    notify: { email: true, sms: true },
    unavailableDays: [],
    autoSchedule: true,
    w9: true,
    docFiles: { insurance: "northwest-insurance.pdf", bond: "northwest-bond.pdf", contract: "northwest-agreement.pdf", w9: "northwest-w9.pdf" },
    docReview: { insurance: { status: "verified", limits: { cgl_occ: "2000000", cgl_agg: "4000000", prod_comp: "4000000", auto: "1000000", empl: "1000000", umbrella: "2000000" }, expires: _d(180), checks: { named: true, primary: true, wc: true, current: true, carrier: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-60) }, bond: { status: "verified", amount: "60000", checks: { active: true, amount: true, principal: true, surety: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-60) }, contract: { status: "verified", checks: { signed: true, counter: true, version: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-60) }, w9: { status: "verified", checks: { tin: true, name: true, entity: true, signed: true, current: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-60) } },
    notes: "Top-rated. Handles egress cut-ins others won't. Worth the premium.",
  },
  {
    id: 5, company: "Sound Deck & Fence", contact: "Kyle Meyer", phone: "425-555-0165",
    email: "kyle@sounddeck.com", categories: ["deck_fence", "hardscaping"],
    warranty: "3",
    license: "SOUNDDF298TR", ubi: "602775431",
    licenseCheck: { found: true, licenseNumber: "SOUNDDF298TR", businessName: "Sound Deck & Fence", licenseType: "CONSTRUCTION CONTRACTOR", status: "ACTIVE", effectiveDate: "2023-04-11", expirationDate: _d(260), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(260) }, checkedAt: _d(-7) },
    city: "Kirkland", state: "WA", zip: "98033",
    caps: ["Composite deck", "Cedar deck", "Wood fence", "Railing", "Paver patio"],
    coverage: { mode: "cities", cities: ["Kirkland", "Redmond", "Bellevue", "Seattle"], radii: [] },
    crews: [
      { id: "c1", name: "Deck Crew", available: true, unavailableDays: [], members: [
        { name: "Kyle Meyer", role: "Lead" }, { name: "Brant Cole", role: "Carpenter" },
        { name: "Jess Ivy", role: "Carpenter" }, { name: "Rudy Vance", role: "Laborer" } ] },
      { id: "c2", name: "Fence Crew", available: false, unavailableDays: [], members: [
        { name: "Hana Kim", role: "Lead" }, { name: "Cole Duff", role: "Installer" },
        { name: "Pat Nunez", role: "Installer" }, { name: "Wes Tran", role: "Laborer" } ] },
    ],
    rating: 4.4, bond: true, insurance: false, contract: true, available: true,
    accepted: 29, declined: 6,
    notify: { email: true, sms: false },
    unavailableDays: [],
    autoSchedule: false,
    docFiles: { insurance: null, bond: "sound-bond.pdf", contract: "sound-agreement.pdf" },
    notes: "Big crew, can move fast on decks. Insurance cert expired — chase renewal.",
  },
  {
    id: 6, company: "Stoneline Hardscapes", contact: "Rosa Delgado", phone: "253-555-0119",
    email: "rosa@stoneline.com", categories: ["hardscaping", "coping"],
    warranty: "1",
    license: "STONELH664BV", ubi: "603998210",
    licenseCheck: { found: true, licenseNumber: "STONELH664BV", businessName: "Stoneline Hardscapes", licenseType: "CONSTRUCTION CONTRACTOR", status: "ACTIVE", effectiveDate: "2023-04-11", expirationDate: _d(380), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(380) }, checkedAt: _d(-7) },
    city: "Tacoma", state: "WA", zip: "98402",
    caps: ["Paver patio", "Retaining wall", "Walkway", "Drainage / grading", "Stone coping", "Wall cap", "Precast concrete coping"],
    coverage: { mode: "radius", cities: [], radii: [{ zip: "98402", miles: 50 }] },
    crews: [
      { id: "c1", name: "Hardscape Crew", available: true, unavailableDays: [], members: [
        { name: "Rosa Delgado", role: "Lead" }, { name: "Ed Marsh", role: "Mason" },
        { name: "Vic Alonzo", role: "Mason" }, { name: "Lena Ford", role: "Laborer" },
        { name: "Cruz Vega", role: "Laborer" } ] },
    ],
    rating: 4.7, bond: true, insurance: true, contract: true, available: false,
    accepted: 38, declined: 4,
    notify: { email: false, sms: true },
    unavailableDays: [],
    autoSchedule: true,
    w9: true,
    docFiles: { insurance: "stoneline-insurance.pdf", bond: "stoneline-bond.pdf", contract: "stoneline-agreement.pdf", w9: "stoneline-w9.pdf" },
    docReview: { insurance: { status: "verified", limits: { cgl_occ: "1000000", cgl_agg: "2000000", prod_comp: "2000000", auto: "1000000", empl: "1000000" }, expires: _d(90), checks: { named: true, primary: true, wc: true, current: true, carrier: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-20) }, bond: { status: "verified", amount: "30000", checks: { active: true, amount: true, principal: true, surety: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-20) }, contract: { status: "verified", checks: { signed: true, counter: true, version: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-20) }, w9: { status: "pending" } },
    notes: "Excellent retaining walls. Booked solid through next month.",
  },
  {
    id: 7, company: "Summit Roofing LLC", contact: "Aaron Webb", phone: "425-555-0140",
    email: "aaron@summitroof.com", categories: ["roofing", "soffit_fascia"],
    warranty: "7",
    license: "SUMMITR407WD", ubi: "601330974",
    licenseCheck: { found: true, licenseNumber: "SUMMITR407WD", businessName: "Summit Roofing LLC", licenseType: "CONSTRUCTION CONTRACTOR", status: "ACTIVE", effectiveDate: "2023-04-11", expirationDate: _d(340), suspendDate: null, bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" }, insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: _d(340) }, checkedAt: _d(-7) },
    city: "Everett", state: "WA", zip: "98201",
    caps: ["Asphalt shingle", "Cedar shake", "Flat / TPO", "Skylight", "Fascia wrap", "Vented soffit"],
    coverage: { mode: "cities", cities: ["Everett", "Lynnwood", "Kirkland"], radii: [] },
    crews: [
      { id: "c1", name: "Roof Crew", available: true, unavailableDays: [], members: [
        { name: "Aaron Webb", role: "Lead" }, { name: "Nate Sims", role: "Installer" },
        { name: "Kurt Homes", role: "Installer" } ] },
    ],
    rating: 4.6, bond: true, insurance: true, contract: true, available: true,
    accepted: 26, declined: 3,
    notify: { email: true, sms: false },
    unavailableDays: [],
    autoSchedule: false,
    docFiles: { insurance: "summit-insurance.pdf", bond: "summit-bond.pdf", contract: "summit-agreement.pdf" },
    docReview: { insurance: { status: "verified", limits: { cgl_occ: "1000000", cgl_agg: "1500000", prod_comp: "2000000", auto: "1000000", empl: "1000000" }, overrides: { cgl_agg: "Small-crew gutter work only; $1.5M aggregate accepted for this scope." }, expires: _d(150), checks: { named: true, primary: true, wc: true, current: true, carrier: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-45) }, bond: { status: "verified", amount: "35000", checks: { active: true, amount: true, principal: true, surety: true }, verifiedBy: "Richard Braun", verifiedAt: _d(-45) }, contract: { status: "pending" } },
    notes: "North-end roofer. Solid on flat/TPO. Good backup to Cascade.",
  },
];

// ---- Users & roles -------------------------------------------------------
// ---- Account type ---------------------------------------------------------
// Who the account is, as opposed to what a given user may do inside it. The
// four match the audiences the marketing site sells to.
//
// `properties` is the real distinction: a general contractor subs out trades
// job by job and has no building list, so the Properties tab is theirs to not
// have. The other three manage a standing portfolio and scope vendors to
// specific buildings.
// `invites` is the scoped roles this kind of account has anyone to hand out.
// It mirrors who is on the other side of the table: a managing agent answers
// to owners, an owner hires managing agents, and a portfolio runs both
// relationships at once. A general contractor has neither, and no buildings
// to scope them to.
const ACCOUNT_KINDS = {
  general_contractor: { label: "General contractor", properties: false, invites: [] },
  property_manager:   { label: "Property manager", properties: true, invites: ["owner"] },
  // A building owner's account has no owners to invite -- they are the owner.
  // The people they let in are managing agents, which is the ordinary
  // property manager role with a list of buildings attached.
  building_owner:     { label: "Building owner", properties: true, invites: [] },
  portfolio_manager:  { label: "Commercial portfolio manager", properties: true,
                        invites: ["owner"] },
};
// Anyone keeping a building list has people living or trading in it, so
// tenants are offered on all three rather than listed per kind.
const hasTenants = (account) => ACCOUNT_KINDS[kindOf(account)].properties;
const DEFAULT_ACCOUNT_KIND = "general_contractor";
const kindOf = (account) =>
  (account && ACCOUNT_KINDS[account.kind]) ? account.kind : DEFAULT_ACCOUNT_KIND;
const hasProperties = (account) => ACCOUNT_KINDS[kindOf(account)].properties;

// Phone numbers are typed in a dozen shapes and then compared, dialled and
// texted as one, so every field that takes one runs its input through here.
// Ten digits, formatted as they type; a leading US country code is dropped
// rather than rejected, because numbers pasted from a contact card carry one.
const phoneDigits = (v) => {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.slice(0, 10);
};
const formatPhone = (v) => {
  const d = phoneDigits(v);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)})${d.slice(3)}`;
  return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6)}`;
};
// Same shape the API enforces, so the two can't disagree about what counts
// as an address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validEmail = (v) => EMAIL_RE.test(String(v ?? "").trim());

const ROLES = {
  admin: { label: "Admin", can: ["dashboard", "contractors", "properties", "calendar", "jobs", "uniforms", "account"] },
  // "Property manager", not "project manager": these accounts are property
  // businesses, and project-manager was general-contractor language that had
  // been left on the role everywhere.
  //
  // One role whether they run the whole book or five buildings. A large
  // managing agent assigns each manager to named buildings and a small one
  // does not; that is the same job with or without a list, and it lives in
  // membership_properties rather than in a second role nobody could tell
  // apart from this one by its name.
  pm: { label: "Property manager", can: ["dashboard", "contractors", "properties", "calendar", "jobs", "uniforms", "account"] },
  // A building owner is a guest in somebody else's account, scoped to the
  // buildings they were granted. No contractor directory -- they see who is
  // coming to their own jobs, not who the account works with -- and no
  // availability calendar or uniforms, which are the account's business.
  owner: { label: "Building owner", can: ["dashboard", "properties", "jobs", "account"] },
  // Somebody who lives or trades in one of the buildings. They report
  // problems and follow what happens to them, and that is the whole of it --
  // no dashboard, no portfolio, no other tenant's repairs, no money. Their
  // screen is its own thing rather than a stripped-down version of the
  // account's, which is why "tenant" is the only view they carry.
  tenant: { label: "Tenant", can: ["tenant", "account"] },
  contractor: { label: "Contractor", can: ["portal", "account"] },
};
// Roles that are always limited to named buildings, and for which an empty
// list means nothing rather than everything. A property manager's list is
// optional, so they are not here -- ask `isScoped` instead, which reads the
// seat rather than the role.
const ALWAYS_SCOPED_ROLES = ["owner", "tenant"];
// Whether THIS seat is narrowed, which for a manager is a question about
// their buildings and not about their job title.
const isScoped = (m) => (m?.propertyIds || []).length > 0;
// Roles that belong to the account itself, as opposed to somebody it let in.
// The difference decides who may see money and who may run the place.
const isStaffRole = (r) => r === "admin" || r === "pm";
// Runs the account itself: its buildings, its plan, its onboarding. A manager
// given five buildings runs those five, not the firm.
const runsTheAccount = (role, membership) => isStaffRole(role) && !isScoped(membership);
const seedUsers = [
  { id: "u1", name: "Richard Braun", email: "rb@outerhome.com", role: "admin" },
  { id: "u2", name: "Alicia Gomez", email: "alicia@outerhome.com", role: "pm" },
  // Demo: a second admin whose account sits on the Scale plan, so the two
  // plans can be compared side by side without changing billing.
  { id: "u9", name: "Sam Okafor", email: "sam@subsub.work", role: "admin", platform: true },
  { id: "u10", name: "Priya Raman", email: "priya@subsub.work", role: "admin", platform: true },
  { id: "u5", name: "Ross Mather", email: "ross@outerhome.com", role: "admin" },
  { id: "u3", name: "Miguel Alvarez", email: "miguel@cascaderoof.com", role: "contractor", subId: 1 },
  { id: "u4", name: "Dana Cho", email: "dana@emeraldext.com", role: "contractor", subId: 2 },
];

// ===========================================================================
// DATA MODEL — production shape, see DEPLOYMENT.md "The identity model"
// ===========================================================================
// A subcontractor is NOT owned by the company that hires them. Three concepts:
//
//   companies    a business in the world. Global. Deduped on WA L&I license.
//   accounts     a hiring company's workspace (plan, branding, users, jobs).
//   engagements  the account <-> company relationship. Per-GC data lives here.
//
// The UI still works with a flat "sub" object, composed on the fly by
// composeSub(). Writes are routed back to the right table by splitPatch().
// That keeps the components simple while the STORAGE matches production, so
// the server implementation is a direct translation of what's below.

// Which table owns which field. This map is the whole design in one place.
const COMPANY_FIELDS = [
  // identity — one business, one row
  "company", "contact", "phone", "email", "license", "ubi", "licenseCheck",
  "city", "state", "zip", "mailStreet", "mailCity", "mailState", "mailZip",
  // their crews are their crews; availability MUST be global or you
  // double-book real people across two GCs on the same day
  "crews", "coverage", "available", "unavailableDays", "warranty",
  // one certificate, uploaded once, shared by every GC that engages them
  "insurance", "bond", "contract", "w9", "docFiles",
  // how they want to be contacted — their preference, not yours
  "notify",
];
const ENGAGEMENT_FIELDS = [
  // your verdict on their documents, against YOUR requirements.
  // GC A may require $2M aggregate where GC B accepts $1M.
  "docReview",
  // what they do for you specifically
  "categories", "caps",
  // your experience of them
  "rating", "ratedJobs", "accepted", "declined", "autoSchedule", "notes",
  "status", "propertyIds",
];

// Split one flat seed record into its company half and engagement half.
function splitSeed(s) {
  const co = { id: s.id }, en = {};
  COMPANY_FIELDS.forEach((k) => { if (k in s) co[k] = s[k]; });
  ENGAGEMENT_FIELDS.forEach((k) => { if (k in s) en[k] = s[k]; });
  return { co, en };
}
// Route a patch to the correct table(s).
function splitPatch(patch) {
  const co = {}, en = {};
  Object.keys(patch).forEach((k) => {
    if (ENGAGEMENT_FIELDS.includes(k)) en[k] = patch[k];
    else co[k] = patch[k];              // default to the company record
  });
  return { co, en };
}
// Flatten a company + engagement back into the shape the UI expects.
// `id` stays the COMPANY id, so every existing reference (a.subId === sub.id)
// keeps working unchanged.
function composeSub(co, en) {
  return {
    ...co, ...en,
    id: co.id,
    engagementId: en.id,
    accountId: en.accountId,
  };
}

const seedCompanies = seedSubs.map((s) => splitSeed(s).co);

// Outerhome's actual logo mark (their file, not a recolor), used as the
// logo for their own account only.
const OUTERHOME_MARK = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjY2IDI0MiAxMjQgMTExIj48cG9seWdvbiBmaWxsPSIjMTgxNzE2IiBwb2ludHM9IjE4NC45OSwyNzcuNDggMTg0Ljk5LDM0Ny42NyAxNjMuMzMsMzQ3LjY3IDE2My4zMywyOTAuMTggMTI4LjI0LDI3MS41MSA5My4xNCwyOTAuMTggOTMuMTQsMzMyLjc0IDkzLjE2LDMzMi43MyAxMjguMzIsMzExLjM5IDEyOC4yNCwzNDcuNjcgNzEuNDksMzQ3LjY3IDcxLjQ5LDI3Ny40OCAxMjguMjQsMjQ3LjYxIi8+PC9zdmc+";

// ---- Activity log -----------------------------------------------------------
// One append-only stream per account: who did what, when. Read in the
// superadmin console; written by the tenant app on the actions that matter.
const seedActivity = [
  { id: "ev1",  accountId: "a2", at: "2026-09-18T08:12:00Z", userId: "u5", kind: "login",        text: "Signed in" },
  { id: "ev2",  accountId: "a2", at: "2026-09-18T08:20:00Z", userId: "u5", kind: "doc_verified", text: "Verified insurance for Cascade Roofworks" },
  { id: "ev3",  accountId: "a2", at: "2026-09-17T15:41:00Z", userId: "u5", kind: "wo_issued",    text: "Issued WO-4417 to Cascade Roofworks · roofing · $12,400" },
  { id: "ev4",  accountId: "a2", at: "2026-09-16T10:03:00Z", userId: "u5", kind: "job_created",  text: "Created job 1420 Maple St — re-roof" },
  { id: "ev5",  accountId: "a2", at: "2026-09-15T09:30:00Z", userId: "u5", kind: "sub_added",    text: "Added Summit Roofing LLC" },
  { id: "ev6",  accountId: "a1", at: "2026-09-18T07:55:00Z", userId: "u1", kind: "login",        text: "Signed in" },
  { id: "ev7",  accountId: "a1", at: "2026-09-18T08:02:00Z", userId: "u2", kind: "login",        text: "Signed in" },
  { id: "ev8",  accountId: "a1", at: "2026-09-17T16:22:00Z", userId: "u1", kind: "doc_rejected", text: "Rejected bond for Emerald Exteriors · below $30,000 minimum" },
  { id: "ev9",  accountId: "a1", at: "2026-09-17T11:10:00Z", userId: "u2", kind: "job_completed",text: "Completed 88 Cedar Ave — gutters" },
  { id: "ev10", accountId: "a1", at: "2026-09-12T14:00:00Z", userId: "u1", kind: "license_check",text: "Ran L&I license check on Stoneline Hardscapes · active" },
  { id: "ev11", accountId: "a3", at: "2026-09-17T13:05:00Z", userId: null, kind: "plan_changed", text: "Upgraded to Scale (monthly)" },
  { id: "ev12", accountId: "a4", at: "2026-09-18T09:14:00Z", userId: null, kind: "limit_hit",    text: "Hit the 3-subcontractor limit on Basic" },
];
const ACTIVITY_LABEL = {
  login: "Sign-in", doc_verified: "Document", doc_rejected: "Document", wo_issued: "Work order",
  job_created: "Job", job_completed: "Job", sub_added: "Subcontractor", license_check: "License",
  plan_changed: "Plan", limit_hit: "Plan", impersonation: "Platform", user_added: "Platform", change_order: "Change order",
  service_call: "Callback",
};

// ---- Superadmins ----------------------------------------------------------
// SubSub's own staff. Deliberately NOT a role in ROLES — that would touch
// every can() check and every tab. Instead they get a separate console.
// "finance" gates revenue; "impersonate" gates sign-in-as. Both audited and
// both answered by the server, which re-reads the `superadmins` table on
// every request — there is no seeded staff list any more.
const STAFF_ROLE_LABEL = { superadmin: "Superadmin", standard: "Standard" };
// Subscription history, append-only. Current account state can't tell you
// what expansion or churn happened in a given month; this can.
const seedSubscriptionEvents = [
  { id: "se1", accountId: "a2", at: "2026-03-04", kind: "created",   fromPlan: null,    toPlan: "basic", cycle: "monthly", mrrDelta: 0 },
  { id: "se2", accountId: "a2", at: "2026-03-19", kind: "upgraded",  fromPlan: "basic", toPlan: "scale", cycle: "monthly", mrrDelta: 9900 },
  { id: "se3", accountId: "a2", at: "2026-06-01", kind: "cycle",     fromPlan: "scale", toPlan: "scale", cycle: "annual",  mrrDelta: -1650 },
  { id: "se4", accountId: "a1", at: "2026-07-22", kind: "created",   fromPlan: null,    toPlan: "basic", cycle: "monthly", mrrDelta: 0 },
  { id: "se5", accountId: "a3", at: "2026-08-02", kind: "created",   fromPlan: null,    toPlan: "basic", cycle: "monthly", mrrDelta: 0 },
  { id: "se6", accountId: "a3", at: "2026-08-14", kind: "upgraded",  fromPlan: "basic", toPlan: "scale", cycle: "monthly", mrrDelta: 9900 },
  { id: "se7", accountId: "a4", at: "2026-08-20", kind: "created",   fromPlan: null,    toPlan: "basic", cycle: "monthly", mrrDelta: 0 },
  { id: "se8", accountId: "a5", at: "2026-05-11", kind: "created",   fromPlan: null,    toPlan: "basic", cycle: "monthly", mrrDelta: 0 },
  { id: "se9", accountId: "a5", at: "2026-05-30", kind: "upgraded",  fromPlan: "basic", toPlan: "scale", cycle: "monthly", mrrDelta: 9900 },
  { id: "se10", accountId: "a5", at: "2026-09-02", kind: "canceled", fromPlan: "scale", toPlan: null,    cycle: "monthly", mrrDelta: -9900 },
];
// Normalized MRR in cents: annual ÷ 12, so a $990/yr account is $82.50/mo.
const mrrOf = (acct) => {
  if (!acct || acct.status === "canceled" || acct.plan !== "scale") return 0;
  return acct.billing === "annual" ? Math.round(99000 / 12) : 9900;
};

// ---- Properties ---------------------------------------------------------
// Property and portfolio managers run different vendors at different
// buildings. A property belongs to an account; an engagement can be scoped to
// specific properties, or left open to all of them (how a GC would use it).
const seedProperties = [
  { id: "p1", accountId: "a3", name: "Riverside Apartments", address: "1420 Riverside Dr",
    city: "Seattle", state: "WA", zip: "98101", units: 84, notes: "" },
  { id: "p2", accountId: "a3", name: "Cedar Court Townhomes", address: "88 Cedar Ave",
    city: "Seattle", state: "WA", zip: "98103", units: 32, notes: "" },
  { id: "p3", accountId: "a2", name: "Harbor Point Tower", address: "700 Harbor Way",
    city: "Bellevue", state: "WA", zip: "98004", units: 210, notes: "Class A office" },
  { id: "p4", accountId: "a2", name: "Northgate Retail Center", address: "9200 1st Ave NE",
    city: "Seattle", state: "WA", zip: "98115", units: 18, notes: "14 tenant spaces" },
];

// Two hiring accounts, so the same subcontractor can be seen in both.
const seedAccounts = [
  { id: "a1", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
    plan: "basic", billing: "monthly",
    createdAt: "2026-07-22", lastActive: "2026-09-18",
    theme: { bg: "#F4F6F4", surface: "#FFFFFF", text: "#12211C", accent: "#1F6B4A", btnText: "#FFFFFF" },
    logoData: OUTERHOME_MARK, useDefaultMark: false },
  { id: "a3", name: "Meridian Property Group", subdomain: "meridian", kind: "property_manager",
    plan: "scale", billing: "monthly",
    createdAt: "2026-08-02", lastActive: "2026-09-17", theme: null },
  { id: "a4", name: "Northline Homes", subdomain: "northline", kind: "general_contractor",
    plan: "basic", billing: "monthly",
    createdAt: "2026-08-20", lastActive: "2026-09-18", theme: null },
  { id: "a5", name: "Riverside Renovations", subdomain: "riverside", kind: "general_contractor",
    plan: "scale", billing: "monthly",
    status: "canceled", createdAt: "2026-05-11", lastActive: "2026-08-30", theme: null },
  { id: "a2", name: "Harbor Point Builders", subdomain: "harborpoint", kind: "portfolio_manager",
    plan: "scale", billing: "annual",
    createdAt: "2026-03-04", lastActive: "2026-09-18",
    theme: { bg: "#0E1B2A", surface: "#16263B", text: "#EAF1F8", accent: "#E0913C", btnText: "#1A1207" },
    logoData: null, useDefaultMark: false },
];

// Outerhome engages all seven. Harbor Point engages three of the same
// companies — one record each, two relationships.
const seedEngagements = (function () {
  const out = [];
  seedSubs.forEach((s) => {
    out.push({ id: "e" + s.id, accountId: "a1", companyId: s.id, ...splitSeed(s).en });
  });
  // Harbor Point's own view of Cascade, Northwest and Summit: their own
  // ratings, their own auto-schedule setting, and their own document verdicts.
  [
    { companyId: 1, rating: 4.4, ratedJobs: 6,  autoSchedule: false,
      notes: "Roofing only for us. Good on tear-offs.",
      docReview: { insurance: { status: "pending" } } },
    { companyId: 4, rating: 5.0, ratedJobs: 11, autoSchedule: true, propertyIds: ["p3"],
      notes: "Our go-to for window packages.",
      docReview: {
        insurance: { status: "verified", limits: { cgl_occ: "2000000", cgl_agg: "4000000", prod_comp: "4000000", auto: "1000000", empl: "1000000" }, expires: _d(180), checks: { named: true, primary: true, wc: true, current: true, carrier: true }, verifiedBy: "Ross Mather", verifiedAt: _d(-14) },
        bond: { status: "verified", amount: "60000", checks: { active: true, amount: true, principal: true, surety: true }, verifiedBy: "Ross Mather", verifiedAt: _d(-14) },
        contract: { status: "verified", checks: { signed: true, counter: true, version: true }, verifiedBy: "Ross Mather", verifiedAt: _d(-14) } } },
    { companyId: 7, rating: 0, ratedJobs: 0, autoSchedule: false, propertyIds: ["p4"],
      notes: "Just invited — no jobs yet.",
      docReview: {} },
  ].forEach((e, i) => {
    const base = seedSubs.find((s) => s.id === e.companyId);
    out.push({
      id: "e2" + (i + 1), accountId: "a2", companyId: e.companyId,
      categories: base.categories, caps: base.caps,
      accepted: 0, declined: 0, status: "active",
      ...e,
    });
  });
  return out;
})();

// Users are global. `memberships` joins a person to an account with a role,
// so one login can be a contractor in several accounts and an admin in their own.
const seedMemberships = [
  { userId: "u1", accountId: "a1", role: "admin" },
  { userId: "u2", accountId: "a1", role: "pm" },
  { userId: "u5", accountId: "a2", role: "admin" },
  // Miguel is a contractor for BOTH hiring companies, and an admin of his own.
  { userId: "u3", accountId: "a1", role: "contractor", companyId: 1 },
  { userId: "u3", accountId: "a2", role: "contractor", companyId: 1 },
  { userId: "u4", accountId: "a1", role: "contractor", companyId: 2 },
];


// ---- Helpers -------------------------------------------------------------
const catMeta = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
const acceptRate = (s) => {
  const t = s.accepted + s.declined;
  return t ? Math.round((s.accepted / t) * 100) : 0;
};
// ---- Availability is CREW based -------------------------------------------
// Each crew carries its own on/off switch and marked-off days. A contractor is
// bookable on a day only if they're taking work AND at least one crew is free.
// How a contractor wants to receive system notifications. SMS is notification-
// only — admins and PMs cannot send ad-hoc texts, just email.
const notifyPrefs = (s) => s.notify || { email: true, sms: false };
const notifyLabel = (s) => {
  const n = notifyPrefs(s);
  if (n.email && n.sms) return "Email + SMS";
  if (n.sms) return "SMS only";
  return "Email only";
};
const crewOffDays = (c) => c.unavailableDays || [];
const crewFreeOn = (c, day) => c.available !== false && !crewOffDays(c).includes(day);
// legacy contractor-level off-days still respected if present
const isOffDay = (s, day) => (s.unavailableDays || []).includes(day);
function freeCrews(sub, day) {
  if (!sub.available || isOffDay(sub, day)) return [];
  return (sub.crews || []).filter((c) => crewFreeOn(c, day));
}
const availableOn = (s, day) => freeCrews(s, day).length > 0;

// IMPORTANT: pass ALL jobs here, across every account. A crew booked by another
// hiring company is physically unavailable to you that day. Details of other
// accounts' jobs are never shown — only the fact that the crew is taken.
function dayStatus(sub, jobs, day, ignoreJobId, viewAccountId) {
  if (!day) return null;
  if (!sub.available) return { kind: "unavailable", label: "Not taking work", crews: [] };
  const free = freeCrews(sub, day);
  if (free.length === 0) {
    return { kind: "off", label: "All crews marked off this day", crews: [] };
  }
  // crews already committed to another job that day
  const busy = new Set();
  let elsewhere = 0;
  (jobs || []).forEach((j) => {
    if (j.date !== day || j.id === ignoreJobId) return;
    Object.values(j.assignments || {}).forEach((a) => {
      if (a.subId !== sub.id || !a.crewName) return;
      busy.add(a.crewName);
      // booked by a different hiring company — count it, but don't leak details
      if (viewAccountId && j.accountId && j.accountId !== viewAccountId) elsewhere += 1;
    });
  });
  const open = free.filter((c) => !busy.has(c.name));
  if (open.length === 0) {
    return {
      kind: "booked",
      label: elsewhere > 0
        ? `All free crews booked — ${elsewhere} on another company's job`
        : `All free crews booked: ${[...busy].join(", ")}`,
      crews: [],
    };
  }
  return {
    kind: "free",
    label: `${open.length} crew${open.length === 1 ? "" : "s"} free: ${open.map((c) => c.name).join(", ")}`,
    crews: open,
  };
}

// Earnings and completed-job counts, derived from issued work orders.
function contractorStats(sub, jobs) {
  let earned = 0, completed = 0, active = 0;
  (jobs || []).forEach((j) => Object.values(j.assignments || {}).forEach((a) => {
    if (a.subId !== sub.id) return;
    const live = a.status === "accepted" || a.auto;
    if (!live) return;
    if (j.status === "completed") { completed += 1; earned += Number(moneyRaw(a.value) || 0); }
    else active += 1;
  }));
  return { earned, completed, active };
}
// A work order is DERIVED from a job when a contractor is assigned to a trade.
// It is never authored on its own — these are the only WO-specific fields.
// One clock for the whole app, so every countdown ticks in step.
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ---- Response deadlines --------------------------------------------------
// The admin picks how long the subcontractor has to reply when the work order
// goes out. Past the deadline the offer is expired: the sub can no longer
// accept, and the admin is prompted to match someone else.
const RESPONSE_WINDOWS = [
  { id: "15m", label: "15 minutes", mins: 15 },
  { id: "1h",  label: "1 hour",     mins: 60 },
  { id: "4h",  label: "4 hours",    mins: 240 },
  { id: "12h", label: "12 hours",   mins: 720 },
  { id: "24h", label: "24 hours",   mins: 1440 },
  { id: "2d",  label: "2 days",     mins: 2880 },
  { id: "3d",  label: "3 days",     mins: 4320 },
  { id: "7d",  label: "7 days",     mins: 10080 },
];
const DEFAULT_WINDOW = "24h";
const windowMins = (id) => (RESPONSE_WINDOWS.find((w) => w.id === id) || { mins: 1440 }).mins;

// Only a pending offer can expire. Accepted, declined and auto-booked are settled.
const awaitingReply = (a) => !!a && a.status === "pending" && !a.auto && !!a.respondBy;
const msLeft = (a, now) => (awaitingReply(a) ? new Date(a.respondBy).getTime() - now : null);
const isExpired = (a, now) => { const m = msLeft(a, now); return m !== null && m <= 0; };
// "4h 12m" / "38m" / "45s" — coarse at distance, precise near the wire.
function countdown(ms) {
  if (ms === null) return "";
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
// Under an hour is worth flagging visually.
const urgencyOf = (ms) => ms === null ? "" : ms <= 0 ? "expired"
  : ms < 3600000 ? "soon" : ms < 14400000 ? "today" : "ok";

function issueWO(sub, job, trade, details = {}) {
  const prox = job.zip ? coversZip(sub, job.zip) : null;
  return {
    subId: sub.id, company: sub.company, contact: sub.contact,
    crewName: details.crewName || (sub.crews && sub.crews[0]?.name) || null,
    wo: "WO-" + Math.floor(1000 + Math.random() * 9000),
    woIssued: new Date().toISOString().slice(0, 10),
    tradeScope: details.tradeScope || "",
    value: details.value || "",
    signedWO: null,
    status: sub.autoSchedule ? "accepted" : "pending",
    auto: !!sub.autoSchedule,
    // deadline only applies when someone actually has to reply
    responseWindow: sub.autoSchedule ? null : (details.responseWindow || DEFAULT_WINDOW),
    respondBy: sub.autoSchedule ? null
      : new Date(Date.now() + windowMins(details.responseWindow || DEFAULT_WINDOW) * 60000).toISOString(),
    respondedAt: null,
    rating: null,
    distance: prox?.distance ?? null, inRange: prox?.inRange ?? null,
  };
}

// Ratings are recorded per crew per job; these roll them up.
function crewRatings(sub, jobs) {
  const byCrew = {};
  (jobs || []).forEach((j) => Object.values(j.assignments || {}).forEach((a) => {
    if (a.subId !== sub.id || !a.rating) return;
    const key = a.crewName || "Unassigned crew";
    (byCrew[key] ||= []).push(a.rating);
  }));
  return Object.entries(byCrew).map(([name, rs]) => ({
    name, count: rs.length, avg: Math.round((rs.reduce((n, r) => n + r, 0) / rs.length) * 10) / 10,
  }));
}
const crewCount = (s) => (s.crews || []).length;
const headCount = (s) => (s.crews || []).reduce((n, c) => n + (c.members?.length || 0), 0);
const DOC_LABELS = { insurance: "Certificate of insurance", bond: "Surety bond", contract: "Signed subcontractor agreement", w9: "IRS Form W-9" };
const DOC_KINDS = ["insurance", "bond", "contract", "w9"];
// Used mid-sentence. Lowercasing DOC_LABELS would mangle "IRS Form W-9".
const DOC_LABELS_INLINE = {
  insurance: "certificate of insurance",
  bond: "surety bond",
  contract: "signed subcontractor agreement",
  w9: "IRS Form W-9",
};

// ---- Washington State insurance & bond requirements ----------------------
// The schedule Outerhome holds subcontractors to. Reviewers check each line
// against the certificate of insurance.
const INSURANCE_LINES = [
  { id: "cgl_occ",   label: "Commercial General Liability", sub: "per occurrence",              min: 1000000 },
  { id: "cgl_agg",   label: "General aggregate",            sub: "",                            min: 2000000 },
  { id: "prod_comp", label: "Products & completed operations", sub: "",                          min: 2000000 },
  { id: "auto",      label: "Auto liability",               sub: "combined single limit",        min: 1000000 },
  { id: "empl",      label: "Employer's liability",         sub: "",                            min: 1000000 },
  { id: "umbrella",  label: "Umbrella / excess",            sub: "higher-risk or larger subs",  min: 1000000, optional: true },
];
const INSURANCE_ATTEST = [
  { id: "named",   label: (b) => `${b} named as additional insured on CGL` },
  { id: "primary", label: () => "Primary & non-contributory wording present" },
  { id: "wc",      label: () => "WA L&I workers' comp account active (or exempt)" },
  { id: "current", label: () => "Policy period covers the work dates" },
  { id: "carrier", label: () => "Carrier and policy number legible" },
];
const BOND_MIN = 30000;

// ---- Change orders --------------------------------------------------------
// A work order is immutable once accepted: it records what was agreed. Any
// change after that is a numbered change order the other side has to accept.
// The revised value is derived — original plus every accepted delta — never
// written back onto the work order.
const CO_KINDS = [
  { id: "add",    label: "Added scope",   hint: "extra work, extra money" },
  { id: "deduct", label: "Deducted scope", hint: "work removed, money back" },
  { id: "nocost", label: "No-cost change", hint: "date, sequence or clarification only" },
];
const coSeq = (n) => "CO-" + String(n).padStart(2, "0");
// Change orders live against a work order, identified by job + trade.
const cosFor = (cos, jobId, trade) =>
  (cos || []).filter((c) => c.jobId === jobId && c.trade === trade)
    .sort((a, b) => a.seq - b.seq);
const acceptedDelta = (cos, jobId, trade) =>
  cosFor(cos, jobId, trade).filter((c) => c.status === "accepted")
    .reduce((n, c) => n + Number(c.valueDelta || 0), 0);
const revisedValue = (a, cos, jobId, trade) =>
  Number(moneyRaw(a?.value) || 0) + acceptedDelta(cos, jobId, trade);
// GC-raised COs carry a response deadline just like the original offer.
// Sub-raised ones wait on the GC, who is in the app anyway, so no clock.
const coAwaiting = (c) => c.status === "pending";
const coExpired = (c, now) => c.origin === "gc" && c.status === "pending"
  && c.respondBy && new Date(c.respondBy).getTime() <= now;

// ---- Warranties and callbacks -------------------------------------------
// Each subcontractor states how long they warranty their labor: 1–10 years
// in one-year steps, or lifetime. A callback is a defect reported soon after
// the job (industry norm is 30 days); a warranty claim is anything later that
// still falls inside their stated window.
const WARRANTY_OPTIONS = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), label: `${i + 1} year${i ? "s" : ""}`, years: i + 1 })),
  { id: "lifetime", label: "Lifetime", years: Infinity },
];
const CALLBACK_DAYS = 30;
const warrantyYears = (s) => {
  const w = s && s.warranty;
  if (!w) return null;
  if (w === "lifetime") return Infinity;
  const n = Number(w);
  return Number.isFinite(n) ? n : null;
};
const warrantyLabel = (s) => {
  const y = warrantyYears(s);
  if (y === null) return "No warranty on file";
  return y === Infinity ? "Lifetime labor warranty" : `${y} year${y > 1 ? "s" : ""} labor warranty`;
};
const daysSince = (iso, now) => iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : null;
// Which remedy applies to a completed job right now.
function coverageFor(sub, job, now) {
  const done = job && job.completedAt;
  if (!done) return { kind: "none", label: "Job not completed" };
  const d = daysSince(done, now);
  const y = warrantyYears(sub);
  if (d <= CALLBACK_DAYS) {
    return { kind: "callback", days: d,
      label: `Callback window — ${CALLBACK_DAYS - d} of ${CALLBACK_DAYS} days left` };
  }
  if (y === null) return { kind: "expired", days: d, label: `${d} days ago · no warranty on file` };
  if (y === Infinity) return { kind: "warranty", days: d, label: `Lifetime warranty — covered` };
  const withinYears = d <= y * 365;
  return withinYears
    ? { kind: "warranty", days: d,
        label: `Within ${y}-year warranty — ${Math.max(0, y - Math.floor(d / 365))} year${y - Math.floor(d / 365) === 1 ? "" : "s"} remaining` }
    : { kind: "expired", days: d, label: `${Math.floor(d / 365)} years ago · ${y}-year warranty expired` };
}

// ---- WA L&I license verification ----------------------------------------
// Washington publishes the contractor registry as free open data (Socrata
// SODA, no API key). Four datasets join on the license number:
//   m8qx-ubtq  general    — status, type, effective/expiration, UBI, principal
//   ciwg-agsx  insurance  — carrier, policy #, coverage amount, dates
//   bzff-4fmt  bond       — surety firm, bond amount, impairment, dates
//   4xk5-x9j6  principals — owners and officers of record
// In production this is a single fetch; here it is stubbed so the UI is real.
const LNI_BASE = "https://data.wa.gov/resource";
const LNI_DATASETS = { general: "m8qx-ubtq", insurance: "ciwg-agsx", bond: "bzff-4fmt", principals: "4xk5-x9j6" };
const lniVerifyUrl = (lic) =>
  `${LNI_BASE}/${LNI_DATASETS.general}.json?contractorlicensenumber=${encodeURIComponent(lic)}`;
const lniPublicLookup = (lic) =>
  `https://secure.lni.wa.gov/verify/Detail.aspx?LIC=${encodeURIComponent(lic)}`;

// Stand-in for the live lookup. Returns the same shape the SODA join gives.
function lookupLicense(sub) {
  const lic = (sub.license || "").trim();
  if (!lic) return { found: false, error: "No license number on file" };
  // Demo behavior: a license ending in "X" simulates an expired registration.
  const expired = /X$/i.test(lic);
  const today = new Date();
  const exp = new Date(today); exp.setDate(today.getDate() + (expired ? -40 : 400));
  return {
    found: true,
    licenseNumber: lic,
    businessName: sub.company,
    ubi: sub.ubi || null,
    licenseType: "CONSTRUCTION CONTRACTOR",
    status: expired ? "EXPIRED" : "ACTIVE",
    effectiveDate: "2023-04-11",
    expirationDate: exp.toISOString().slice(0, 10),
    suspendDate: null,
    primaryPrincipal: sub.contact,
    bond: { surety: "North River Insurance Company", number: "46CF842686", amount: 30000, expires: "Until Canceled" },
    insurance: { carrier: "State National Ins Co", policy: "NXT9PTHTLT-01-GL", coverage: 1000000, expires: exp.toISOString().slice(0, 10) },
    checkedAt: new Date().toISOString().slice(0, 10),
    source: lniVerifyUrl(lic),
  };
}
// License must be found, ACTIVE, not suspended, and not past expiry.
function licenseOk(sub) {
  const c = sub.licenseCheck;
  if (!c?.found) return false;
  if (c.status !== "ACTIVE" || c.suspendDate) return false;
  return !c.expirationDate || c.expirationDate >= new Date().toISOString().slice(0, 10);
}
// What an admin/PM must confirm for bond and agreement. Insurance uses the
// coverage schedule above instead of a flat checklist.
const DOC_CHECKS = {
  bond: (b) => [
    { id: "active", label: "Bond is active, not cancelled" },
    { id: "amount", label: `Bond amount at least ${formatMoney(BOND_MIN)}` },
    { id: "principal", label: "Principal matches the company name on file" },
    { id: "surety", label: "Surety is licensed in Washington" },
  ],
  w9: (b) => [
    { id: "tin", label: "TIN or EIN filled in and legible" },
    { id: "name", label: "Name and business name match the company on file" },
    { id: "entity", label: "Tax classification selected (LLC, S-corp, sole prop…)" },
    { id: "signed", label: "Signed and dated in Part II" },
    { id: "current", label: "Current form revision (Rev. March 2024 or later)" },
  ],
  contract: (b) => [
    { id: "signed", label: "Signed and dated by the contractor" },
    { id: "counter", label: `Countersigned by ${b}` },
    { id: "version", label: "Current version of the agreement" },
  ],
};

const lineLabel = (id) => id === "bond" ? "Bond amount"
  : (INSURANCE_LINES.find((l) => l.id === id)?.label || id);
const activeOverrides = (rv) => Object.entries(rv?.overrides || {})
  .filter(([, reason]) => reason && reason.trim())
  .map(([id, reason]) => ({ id, label: lineLabel(id), reason }));
const INSURANCE_MIN = 1000000; // headline CGL figure used in copy

// A document is only usable once a human has reviewed it.
const docReview = (s, kind) => (s.docReview || {})[kind] || null;
const docStatus = (s, kind) => {
  if (!s[kind]) return "missing";
  const r = docReview(s, kind);
  return r?.status || "pending";
};
const docVerified = (s, kind) => docStatus(s, kind) === "verified";
const DOC_STATUS_LABEL = { missing: "Not uploaded", pending: "Awaiting review", verified: "Verified", rejected: "Rejected" };
// "Missing" means not usable: absent, unreviewed, or rejected.
const missingDocs = (s) => DOC_KINDS.filter((k) => !docVerified(s, k));
// Full compliance = three verified documents AND an active WA registration.
const complianceGaps = (s) => [
  ...missingDocs(s).map((k) => DOC_LABELS[k]),
  ...(licenseOk(s) ? [] : ["Active WA contractor registration"]),
];
const unverifiedDocs = (s) => DOC_KINDS.filter((k) => s[k] && !docVerified(s, k));
const pendingReviewDocs = (s) => DOC_KINDS.filter((k) => docStatus(s, k) === "pending");
const docsComplete = (s) => missingDocs(s).length === 0 && licenseOk(s);
// email body for "matched but blocked on paperwork"
// The documents email tells the contractor to sign in and upload — never to
// reply with attachments. `brand` supplies the tenant's portal URL.
// ---- Outbound notifications (one way, no reply) --------------------------
// The platform has no inbox. Everything sent is a no-reply system notification
// that points the contractor back into their portal.
const portalUrl = (brand) => `${brand ? brand.subdomain : "app"}.subsub.work`;
const docsLink = (brand) => `https://${portalUrl(brand)}/documents`;
// The inverse of portalUrl(): which account's subdomain is this browser on
// right now, if any? "app" is the generic, unbranded entry point — not a
// company — and local/preview hosts (localhost, *.pages.dev) have no
// subdomain to detect at all.
function detectSubdomain() {
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith(".subsub.work")) return null;
  const sub = host.slice(0, -".subsub.work".length);
  if (!sub || sub === "app" || sub === "www" || sub.includes(".")) return null;
  return sub;
}

// The same rules the API enforces, kept in step with RESERVED_SUBDOMAINS and
// SUBDOMAIN_RE in worker/index.js. Checked here as well so the answer comes
// back while they type rather than after a save that looked like it worked;
// the API is still the one that decides, and it is the one that knows whether
// somebody else already holds the name.
const RESERVED_SUBDOMAINS = new Set([
  "app", "www", "admin", "api", "platform", "dashboard", "portal", "status",
  "mail", "smtp", "ftp", "cdn", "assets", "static", "help", "support",
  "docs", "blog", "billing", "account", "accounts", "login", "signup",
  "subsub", "test", "staging", "dev", "demo",
]);
function subdomainProblem(s) {
  if (!s) return "Pick an address.";
  if (s.length < 3) return "Too short — use at least 3 characters.";
  if (s.length > 40) return "Too long — 40 characters at most.";
  if (!/^[a-z0-9]/.test(s) || !/[a-z0-9]$/.test(s)) return "It can't start or end with a dash.";
  if (s.includes("--")) return "Two dashes in a row aren't allowed.";
  if (RESERVED_SUBDOMAINS.has(s)) return `“${s}” is reserved by SubSub. Try another.`;
  return null;
}
// What went wrong saving branding, said in words rather than a status code.
function brandSaveError(err) {
  switch (err?.body?.error) {
    case "subdomain_taken":
      return "That address is already taken by another company. Try another one.";
    case "invalid_subdomain":
      return "That address can't be used. Use 3–40 letters, numbers and dashes.";
    case "invalid_theme":
      return "One of the colors isn't a valid hex value.";
    default:
      return err?.status === 403
        ? "Only an admin on this account can change branding."
        : "Couldn't save. Check your connection and try again.";
  }
}

// ---- White-label theming -------------------------------------------------
// Applies to the two pages a subcontractor sees before they're inside the app:
// the sign-in page and the public application form a GC links to from their
// own site. The app's own chrome is never themed.
const DEFAULT_THEME = {
  bg: "#F4F6F4", surface: "#FFFFFF", text: "#12211C",
  accent: "#1F6B4A", btnText: "#FFFFFF",
};
const THEME_FIELDS = [
  { id: "bg",       label: "Page background" },
  { id: "surface",  label: "Card background" },
  { id: "text",     label: "Text" },
  { id: "accent",   label: "Buttons & links" },
  { id: "btnText",  label: "Button text" },
];
const themeOf = (brand) => ({ ...DEFAULT_THEME, ...((brand && brand.theme) || {}) });
// Inline custom properties so the themed pages don't need a stylesheet rebuild.
const themeVars = (t) => ({
  "--wl-bg": t.bg, "--wl-surface": t.surface, "--wl-text": t.text,
  "--wl-accent": t.accent, "--wl-btn-text": t.btnText,
});
// Readable hint: rough relative luminance, used to warn on low contrast.
function luminance(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return 1;
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrastRatio = (a, b) => {
  const l1 = luminance(a), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
};
// A contractor signs in with their email address — show it so they don't guess.
const usernameOf = (sub) => sub.email || "(no email on file)";

// The document-request email is composed by the API (worker/mail.js), not
// here: the server is what sends it, so the server owns the words. The
// preview in NotifyForm asks for that same text rather than rendering a
// second copy that could drift from what actually goes out.
// SMS has to work for someone standing on a roof: one line, one link.
// Kept under 160 chars where possible so it sends as a single segment.
function buildDocSms(sub, job, brand) {
  const n = missingDocs(sub).length;
  const company = brand ? brand.name : "SubSub";
  const need = `${n} doc${n === 1 ? "" : "s"} needed`;
  const why = job ? "to release your work order" : "to activate your account";
  return `${company}: ${need} ${why}. Upload at ${docsLink(brand)} — user: ${usernameOf(sub)}. No replies.`;
}

// Currency helpers: keep raw digits in state, display formatted.
// Round figures in marketing copy read better without cents.
const formatDollars = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

function formatMoney(v) {
  if (v === "" || v == null) return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return "";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// live-typing display: group digits, allow one decimal, no forced cents yet
function moneyLive(v) {
  const raw = String(v).replace(/[^0-9.]/g, "");
  if (!raw) return "";
  const [i, ...rest] = raw.split(".");
  const dec = rest.length ? "." + rest.join("").slice(0, 2) : "";
  const int = i ? Number(i).toLocaleString("en-US") : "0";
  return "$" + int + dec;
}
const moneyRaw = (v) => String(v ?? "").replace(/[^0-9.]/g, "");

// short day label like "Sep 16"
function formatDay(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  return isNaN(d) ? dateStr : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// A renewal date, from a full ISO timestamp rather than a plain date string --
// Stripe's period end carries a time, and "renews 20 Sep 2027" wants the year
// because it can be a year away.
function niceDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// "4 minutes ago" rather than an ISO timestamp: the only thing anyone wants
// from this field is whether the answer beside it is fresh.
function niceWhen(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `on ${niceDay(iso)}`;
}

// pretty preview like "Wed, Sep 16 · 7:00 AM"
function formatWhen(dateStr, timeStr) {
  if (!dateStr) return null;
  const [h = "07", min = "00"] = (timeStr || "07:00").split(":");
  const d = new Date(`${dateStr}T${(timeStr || "07:00")}:00`);
  if (isNaN(d)) return null;
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const hr = Number(h); const ap = hr >= 12 ? "PM" : "AM"; const h12 = hr % 12 || 12;
  return `${day} · ${h12}:${min} ${ap}`;
}
// coverage: { cities:[...], radius:{ zip, miles } | null }
// Coverage is EITHER a set of named cities OR one-or-more ZIP radii.
// { mode: "cities"|"radius", cities: [...], radii: [{ zip, miles }] }
const covRadii = (c) => c.radii || (c.radius ? [c.radius] : []);
const covMode = (c) => c.mode || (covRadii(c).length && !(c.cities || []).length ? "radius" : "cities");
const coverageAreas = (c) => (covMode(c) === "cities" ? (c.cities || []) : []);
const coverageLabel = (c) => {
  if (covMode(c) === "radius") {
    const r = covRadii(c);
    return r.length ? r.map((x) => `${x.miles} mi of ${x.zip}`).join(" · ") : "No radius set";
  }
  const cities = c.cities || [];
  return cities.length ? cities.join(", ") : "No area set";
};
// Does a contractor cover a given job ZIP? Cities mode matches named cities;
// radius mode matches if ANY of their radii reach it.
function coversZip(sub, zip) {
  if (!zip) return null;
  const c = sub.coverage;
  if (covMode(c) === "cities") {
    const cityZips = (c.cities || []).map((city) => CITY_ZIP[city]).filter(Boolean);
    if (cityZips.includes(zip)) return { inRange: true, distance: 0, via: "city" };
    const dists = cityZips.map((z) => zipDistance(z, zip)).filter((d) => d != null);
    if (dists.length) return { inRange: false, distance: Math.min(...dists), via: "city" };
    return { inRange: false, distance: null, via: null };
  }
  // radius mode: nearest radius wins
  let best = null;
  covRadii(c).forEach((r) => {
    const d = zipDistance(r.zip, zip);
    if (d == null) return;
    const hit = { inRange: d <= r.miles, distance: d, via: "radius", miles: r.miles, from: r.zip };
    if (!best || (hit.inRange && !best.inRange) || d < best.distance) best = hit;
  });
  return best || { inRange: false, distance: null, via: null };
}

// ---- Multi-select dropdown ----------------------------------------------
function MultiSelect({ label, icon: Icon, options, selected, onChange, disabled, renderOpt }) {
  const [open, setOpen] = useState(false);
  const toggle = (v) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="ms">
      <label>{Icon && <Icon size={13} />} {label}</label>
      <button className={`ms-btn ${disabled ? "disabled" : ""}`} onClick={() => !disabled && setOpen(!open)}>
        <span>{selected.length ? `${selected.length} selected` : "Any"}</span>
        <ChevronDown size={14} />
      </button>
      {open && !disabled && (
        <>
          <div className="ms-scrim" onClick={() => setOpen(false)} />
          <div className="ms-menu">
            {options.map((o) => {
              const val = typeof o === "object" ? o.id : o;
              const lab = renderOpt ? renderOpt(o) : (typeof o === "object" ? o.label : o);
              return (
                <button key={val} className={`ms-opt ${selected.includes(val) ? "on" : ""}`} onClick={() => toggle(val)}>
                  <span className="ms-check">{selected.includes(val) && <Check size={12} />}</span>
                  {lab}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MoneyInput({ value, onChange, placeholder = "$0.00" }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      inputMode="decimal"
      value={focused ? moneyLive(value) : (value === "" ? "" : formatMoney(value))}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(moneyRaw(e.target.value))}
    />
  );
}

function StarRate({ value, onRate, label = "Rate" }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div className="star-rate" onMouseLeave={() => setHover(0)}>
      <span className="sr-label">{value ? "Rated" : label}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={`sr-star ${n <= shown ? "on" : ""}`}
          onMouseEnter={() => setHover(n)} onClick={() => onRate(n)}
          title={`${n} star${n > 1 ? "s" : ""}`}>
          <Star size={15} fill={n <= shown ? "currentColor" : "none"} />
        </button>
      ))}
      {value ? <span className="sr-val">{value}.0</span> : null}
    </div>
  );
}

function DocPill({ ok, label }) {
  return (
    <span className={`doc-pill ${ok ? "doc-ok" : "doc-missing"}`}>
      {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{label}
    </span>
  );
}
function Stars({ value }) {
  return <span className="stars"><Star size={12} fill="currentColor" /> {value.toFixed(1)}</span>;
}

// ---- Main app ------------------------------------------------------------
export default function SubSub() {
  // Storage matches production: three tables, not one.
  const [companies, setCompanies] = useState(seedCompanies);
  const [engagements, setEngagements] = useState(seedEngagements);
  const [accounts, setAccounts] = useState(seedAccounts);
  const [memberships, setMemberships] = useState(seedMemberships);
  const [properties, setProperties] = useState(seedProperties);
  const [users, setUsers] = useState(BUILD === "platform" ? seedUsers : seedUsers.filter((u) => !u.platform));
  const [currentUserId, setCurrentUserId] = useState("u1");
  const [currentAccountId, setCurrentAccountId] = useState("a1");
  const now = useNow();
  // Which account's own subdomain (e.g. outerhome.subsub.work) this browser
  // is on, if any — fetched once, publicly, so the login screen can show
  // that account's real branding instead of generic/demo branding before
  // anyone has signed in. Real-auth only: the dev-stub demo picker doesn't
  // need this, and a production account may not even exist locally.
  const [subdomainBrand, setSubdomainBrand] = useState(null);
  useEffect(() => {
    if (!supabaseEnabled) return;
    const sub = detectSubdomain();
    if (!sub) return;
    api.getAccountBySubdomain(sub).then((a) => {
      setSubdomainBrand({ id: a.id, name: a.name, subdomain: a.subdomain, kind: a.kind, plan: a.plan, billing: a.billing,
        logoData: a.logoKey ? logoUrl(a.id) : null, useDefaultMark: a.useDefaultMark, theme: a.theme });
    }).catch(() => {}); // no account on this subdomain — fall through to generic branding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [loading, setLoading] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  // A general contractor links to their own application form from their own
  // website, and the account page's "open the live application form" link
  // points at the same place. A query string rather than a path, for the same
  // reason the invite token is one: Pages resolves /?apply=1 without depending
  // on SPA-fallback configuration.
  // Only on a company's own address: the form applies to a specific account,
  // and app.subsub.work is nobody's, so there is nothing to apply to there.
  const openingApplication = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("apply")
    && !!detectSubdomain();
  const [publicView, setPublicView] = useState(
    BUILD === "platform" ? "superadmin" : openingApplication ? "signup" : "login"); // login | signup | superadmin

  // The public views are not separate pages, so without this the browser's
  // Back button leaves the app altogether -- to whatever the tab held before,
  // which after an upgrade is Stripe's checkout page. Going to the application
  // form pushes an entry, so Back comes back to the sign-in screen, which is
  // what it looks like it should do.
  const pushedSignup = useRef(false);
  const showSignup = () => {
    try { window.history.pushState({ ssView: "signup" }, ""); pushedSignup.current = true; }
    catch { /* the view still changes; only Back is worse off */ }
    setPublicView("signup");
  };
  const leaveSignup = () => {
    if (pushedSignup.current) { pushedSignup.current = false; window.history.back(); }
    else setPublicView("login");
  };
  useEffect(() => {
    const onPop = (e) => {
      if (e.state && e.state.ssView === "signup") { pushedSignup.current = true; setPublicView("signup"); }
      else { pushedSignup.current = false; setPublicView((v) => (v === "signup" ? "login" : v)); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Somebody arriving on a link their general contractor sent them. Read once
  // on mount; the token is a query string rather than a path because this is
  // a single page served by Pages, where an unknown path depends on
  // SPA-fallback configuration to resolve and a query string always does.
  const [inviteToken, setInviteToken] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("invite");
  });
  const [invite, setInvite] = useState(null);
  const [inviteErr, setInviteErr] = useState("");
  // The same idea for tenants, on its own parameter. A separate name rather
  // than a flag on the other one: the two links are accepted by answering
  // completely different questions and land on different screens.
  const [tenantToken] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("tenant");
  });
  const [tenantInvite, setTenantInvite] = useState(null);
  const [tenantInviteErr, setTenantInviteErr] = useState("");
  // Set when a sign-in resolves to more than one account and nothing in the
  // address says which. Holds the whole login result, so choosing costs no
  // second round trip.
  const [chooser, setChooser] = useState(null);
  const [superadminView, setSuperadminView] = useState(false);   // SubSub staff console
  // What the SERVER says this staff user may do. Never derived in the browser:
  // the same flags are re-checked on every platform request.
  const [staff, setStaff] = useState(null);
  // The console's own data, straight from the API. Null until it loads, so the
  // screens never quietly render seed figures as if they were real.
  const [platform, setPlatform] = useState(null);
  const [platformErr, setPlatformErr] = useState("");
  useEffect(() => {
    if (!staff) { setPlatform(null); return; }
    let live = true;
    api.platform.bootstrap()
      .then((d) => { if (live) { setPlatform(d); setPlatformErr(""); } })
      .catch((e) => { if (live) setPlatformErr(e?.message || "load_failed"); });
    return () => { live = false; };
  }, [staff]);

  // Every console write runs through here. The server re-checks the staff
  // role and writes the audit row before it changes anything, so the browser
  // has nothing to decide -- it sends, then re-reads. Patching local state
  // instead would leave a console showing what it hoped had happened, which
  // is worse than one that waits half a second.
  const platformWrite = async (call, failure, { reload = true } = {}) => {
    setPlatformErr("");
    try {
      const result = await call();
      if (reload) setPlatform(await api.platform.bootstrap());
      return result;
    } catch (err) {
      console.error("[platform] write failed:", err);
      setPlatformErr(
        err?.status === 403 ? "You do not have permission to do that."
          : err?.body?.error === "confirm_name_mismatch" ? "That name did not match, so nothing was deleted."
          : err?.body?.error === "subdomain_taken" ? "That sign-in address is already taken."
          : err?.body?.error === "already_a_member" ? "That person is already on this account."
          : failure
      );
      throw err;
    }
  };
  const [impersonating, setImpersonating] = useState(null);  // { by, account }

  // Arrived on a confirmation or reset link. Decided from the fragment the
  // module captured before Supabase could clear it, then confirmed by the
  // client's own PASSWORD_RECOVERY event -- belt and braces, because getting
  // this wrong means a working link silently doing nothing, which is the bug
  // this screen exists to end.
  const [authFlow, setAuthFlow] = useState(() =>
    AUTH_LINK.error
      ? { kind: "link_failed", code: AUTH_LINK.errorCode, message: AUTH_LINK.error }
      : AUTH_LINK.type === "recovery"
        ? { kind: "set_password", reason: "recovery" }
        : (AUTH_LINK.type === "signup" || AUTH_LINK.type === "invite")
          ? { kind: "set_password", reason: "confirmed" }
          : null);

  useEffect(() => {
    if (!supabaseEnabled) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setAuthFlow({ kind: "set_password", reason: "recovery" });
    });
    return () => data?.subscription?.unsubscribe?.();
  }, []);

  // Nothing should stay in the address bar once it has been read: a fragment
  // carrying a one-time token is not something to leave lying in history.
  const closeAuthFlow = () => {
    setAuthFlow(null);
    try { window.history.replaceState(null, "", window.location.pathname + window.location.search); }
    catch { /* nothing to do if the browser refuses */ }
  };
  const [subEvents] = useState(seedSubscriptionEvents);
  const [activity, setActivity] = useState(seedActivity);
  // Append to the account's activity stream. Cheap to call; the console reads it.
  const logEvent = (kind, text, extra = {}) => setActivity((ev) => [{
    id: "ev" + Date.now() + Math.random().toString(36).slice(2, 6),
    accountId: extra.accountId || account.id, at: new Date().toISOString(),
    userId: extra.userId === undefined ? me.id : extra.userId, kind, text,
  }, ...ev]);
  // White-label tenant branding — one GC per instance (outerhome.subsub.work)

  const [pane, setPane] = useState("jobs"); // contractor portal pane
  const [userMenu, setUserMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [userForm, setUserForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [allJobs, setJobs] = useState([]);   // global; a crew can only be in one place
  const [query, setQuery] = useState("");
  const [fCats, setFCats] = useState([]);
  const [fCaps, setFCaps] = useState([]);
  const [fAreas, setFAreas] = useState([]);
  const [fRatings, setFRatings] = useState([]);
  const [fCrew, setFCrew] = useState([]);
  const [fAvail, setFAvail] = useState([]);
  const [readyOnly, setReadyOnly] = useState(false);
  const [autoOnly, setAutoOnly] = useState(false);
  const [jobPhase, setJobPhase] = useState("active");

  const [uniformOrders, setUniformOrders] = useState([]);
  const [upgradePrompt, setUpgradePrompt] = useState(null); // { kind: "contractor" | "user" }
  const [reviewing, setReviewing] = useState(null); // { sub, kind }
  // Callbacks and warranty claims raised against a completed job.
  const [serviceCalls, setServiceCalls] = useState([]);
  const [raising, setRaising] = useState(null);   // { job, trade, a, kind }
  const [changeOrders, setChangeOrders] = useState([]);
  const [coForm, setCoForm] = useState(null);     // { job, trade, a, origin }
  const [fEarn, setFEarn] = useState([]);
  const [fDone, setFDone] = useState([]);
  const [sortBy, setSortBy] = useState("match");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [jobZip, setJobZip] = useState("");
  const [inRangeOnly, setInRangeOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [newPropertyAt, setNewPropertyAt] = useState(0);   // see tryAddProperty
  const [jobForm, setJobForm] = useState(null);           // { forSub? } create-job modal
  const [assigning, setAssigning] = useState(null);       // { job, trade } -> pick contractor
  const [viewWO, setViewWO] = useState(null);   // { job, trade, a }
  const [assignSub, setAssignSub] = useState(null);       // { sub } -> pick job+trade
  const [notifying, setNotifying] = useState(null); // one-way system notification
  const [adding, setAdding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [editing, setEditing] = useState(null); // sub being edited
  const [tab, setTab] = useState("dashboard");

  const capOptions = useMemo(() => {
    const cats = fCats.length ? fCats : CATEGORIES.map((c) => c.id);
    return [...new Set(cats.flatMap((c) => CAP_LIBRARY[c] || []))];
  }, [fCats]);

  const minRating = fRatings.length ? Math.min(...fRatings) : 0;

  // --- current user / role ---
  const me = users.find((u) => u.id === currentUserId) || users[0];

  // ---- derived view -------------------------------------------------------
  // Role is per ACCOUNT, not per user: the same person can be a contractor in
  // one account and an admin in another.
  const myMemberships = memberships.filter((m) => m.userId === currentUserId);
  const membership = myMemberships.find((m) => m.accountId === currentAccountId)
    || myMemberships[0] || { role: "contractor", accountId: currentAccountId };
  const role = membership.role;
  // Two gates, not one: the role says what this person may do, the account type
  // says what this account has at all. A general contractor has no building
  // list, so Properties is not theirs to see whatever their role is.
  const can = (view) => {
    if (!ROLES[role].can.includes(view)) return false;
    if (view === "properties") return hasProperties(account);
    return true;
  };
  const canRate = role === "admin" || role === "pm";
  const canComplete = role === "admin" || role === "pm";

  // "Home" is not one screen. An admin's is the dashboard; a contractor has
  // no dashboard at all -- the role cannot see one -- and theirs is the job
  // list. Sending everybody to "dashboard" would land a contractor on a blank
  // screen, since the tab renders behind can("dashboard").
  const homeTab = can("dashboard") ? "dashboard" : can("tenant") ? "tenant" : "portal";
  const homeTitle = homeTab === "dashboard" ? "Back to the dashboard"
    : homeTab === "tenant" ? "Back to your reports"
    : "Back to my jobs";
  const goHome = () => {
    // Anything open belongs to the screen being left: a contractor's detail
    // modal, a half-opened menu, the mobile drawer. Home means home.
    setSelected(null); setAddMenu(false); setUserMenu(false); setMobileNav(false);
    if (homeTab === "portal") setPane("jobs");
    setTab(homeTab);
  };

  // The account being viewed supplies branding and the plan. Before login,
  // prefer the real account this subdomain belongs to (if any) over the
  // fallback — otherwise every subdomain would show the same generic/demo
  // branding on its login screen.
  const account = accounts.find((a) => a.id === membership.accountId) || accounts[0];
  // Signed out on a hostname that belongs to nobody — app.subsub.work, a
  // preview URL, localhost — is SubSub's own front door, so it wears SubSub's
  // branding. Falling through to `account` here meant whichever account
  // happened to be first in state, which is how a stranger arriving at the
  // generic address was greeted by some unrelated customer's name and logo.
  const GENERIC_BRAND = { id: null, name: "SubSub", subdomain: "app",
    logoData: null, useDefaultMark: true, theme: null, isSubSub: true };
  // An invite link names the account itself, so it beats whatever the
  // hostname would otherwise imply — the whole point is that a contractor can
  // use it without being told a subdomain first.
  const inviteBrand = invite?.account
    ? { id: invite.account.id, name: invite.account.name, subdomain: invite.account.subdomain,
        logoData: invite.account.logoKey ? logoUrl(invite.account.id) : null,
        useDefaultMark: invite.account.useDefaultMark, theme: invite.account.theme }
    : null;
  // Signed in, `brand` is this account -- but only Scale has branding to
  // apply. On Basic there is no logo, no palette and no hostname of their
  // own, so strip all three here rather than guarding each render site: a
  // downgrade must not leave a logo on the sign-in page or print an address
  // that has no certificate. The account row keeps its reserved subdomain
  // either way; this is only what gets shown.
  const brand = !loggedIn
    ? (inviteBrand || subdomainBrand || GENERIC_BRAND)
    : (PLANS[account.plan]?.branding
        ? account
        : { ...account, logoData: null, theme: null, useDefaultMark: true, subdomain: "app" });
  // What this person is, in the words the customer uses. A subcontractor signing
  // into someone else's portal is a contractor, not "a general contractor" — the
  // account type is the hiring side's identity, not theirs.
  // A contractor and a tenant are both guests: naming the account's own type
  // at them ("Property manager (tenant)") describes somebody else's business,
  // not their relationship to it.
  //
  // And the account's type is often the same word as the role -- a property
  // manager working for a property manager -- which read as "Property manager
  // (property manager)". Said once in that case.
  const roleLabel = (() => {
    if (role === "contractor" || role === "tenant") return ROLES[role].label;
    const kind = ACCOUNT_KINDS[kindOf(account)].label;
    const seat = ROLES[role].label;
    if (kind.toLowerCase() === seat.toLowerCase()) return seat;
    return `${kind} (${seat.toLowerCase()})`;
  })();
  const plan = account.plan;
  const billing = account.billing || "monthly";
  const setBilling = (c) => {
    persist("patchAccount.billing", api.patchAccount({ billing: c }));
    setAccounts((as) => as.map((a) => a.id === account.id ? { ...a, billing: c } : a));
  };
  // Saving branding is the one settings write that can be refused -- an
  // address somebody else already holds, or one that is not a legal hostname
  // -- so it reports back rather than firing and forgetting. Returns null on
  // success and a sentence to show otherwise; the local copy is only updated
  // once the server has actually taken it, because an optimistic subdomain is
  // an address on screen that nothing answers at.
  const setBrand = async (patch) => {
    const resolved = typeof patch === "function" ? patch(account) : patch;
    try {
      // Logo upload has its own request (it needs the file), so only
      // name/subdomain/useDefaultMark/theme go here.
      const res = await api.patchAccount({
        name: resolved.name, subdomain: resolved.subdomain,
        useDefaultMark: resolved.useDefaultMark, theme: resolved.theme,
      });
      setAccounts((as) => as.map((a) => a.id === account.id ? {
        ...a, ...resolved,
        subdomain: res?.subdomain || resolved.subdomain,
        // Changing the address takes the old hostname down and puts a new one
        // up, so whatever the old one's status was no longer describes
        // anything. The API sends back the status the account now really has.
        hostnameStatus: res?.hostnameStatus ?? null,
      } : a));
      return null;
    } catch (err) {
      console.error("[persist] patchAccount.brand failed:", err);
      return brandSaveError(err);
    }
  };
  // Upgrading is a payment, so it leaves for Stripe rather than flipping a
  // column. Nothing in this app decides that somebody is on Scale -- Stripe
  // says so, its webhook records it, and the account reflects that.
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErr, setBillingErr] = useState("");

  // Stripe's form opens in a panel here when we have a publishable key to
  // mount it with; otherwise the browser goes to stripe.com as before.
  const [checkoutSecret, setCheckoutSecret] = useState(null);

  const startCheckout = async (cycle) => {
    setBillingBusy(true); setBillingErr("");
    try {
      const res = await api.startCheckout(cycle || billing, STRIPE_PK ? "embedded" : "hosted");
      if (res.clientSecret) { setCheckoutSecret(res.clientSecret); setBillingBusy(false); return; }
      window.location.href = res.url;
    } catch (err) {
      console.error("[billing] checkout failed:", err);
      setBillingBusy(false);
      // Stripe says exactly what it objected to; passing that through beats
      // "try again in a moment", which is advice that has never once helped
      // with a misconfigured price id.
      setBillingErr(err?.status === 501
        ? "Billing isn't switched on yet, so nothing can be charged. Nobody can upgrade until it is."
        : err?.body?.detail ? `Stripe refused: ${err.body.detail}`
        : "Couldn't start checkout. Try again in a moment.");
    }
  };

  // Cards, invoices and cancellation all live in Stripe's own portal. Building
  // any of it here would mean handling card details, which is the one thing
  // worth never touching.
  const openBillingPortal = async () => {
    setBillingBusy(true); setBillingErr("");
    try {
      const { url } = await api.billingPortal();
      window.location.href = url;
    } catch (err) {
      console.error("[billing] portal failed:", err);
      setBillingBusy(false);
      setBillingErr(err?.status === 409
        ? "There's no subscription to manage yet."
        : err?.body?.detail ? `Stripe refused: ${err.body.detail}`
        : "Couldn't open billing. Try again in a moment.");
    }
  };
  // Cancelling and un-cancelling, in the app. Both re-read the account
  // rather than guessing at the new state: the server has just heard from
  // Stripe, and a screen showing what it hoped happened is how somebody ends
  // up thinking they cancelled when they did not.
  const [cancelBusy, setCancelBusy] = useState(false);
  const changeSubscription = async (which) => {
    setCancelBusy(true); setBillingErr("");
    try {
      await (which === "cancel" ? api.cancelSubscription() : api.resumeSubscription());
      const fresh = await api.getAccount();
      setAccounts((as) => as.map((a) => a.id === fresh.id ? {
        ...a, plan: fresh.plan, billing: fresh.billing,
        subscriptionStatus: fresh.subscriptionStatus,
        currentPeriodEnd: fresh.currentPeriodEnd,
        cancelAtPeriodEnd: fresh.cancelAtPeriodEnd,
      } : a));
    } catch (err) {
      console.error("[billing] change failed:", err);
      setBillingErr(err?.status === 409
        ? "There's no subscription to change yet."
        : err?.body?.detail ? `Stripe refused: ${err.body.detail}`
        : "Couldn't make that change. Try again in a moment.");
    } finally {
      setCancelBusy(false);
    }
  };

  const setAccountKind = (kind) => {
    if (!ACCOUNT_KINDS[kind]) return;
    persist("patchAccount.kind", api.patchAccount({ kind }));
    setAccounts((as) => as.map((a) => a.id === account.id ? { ...a, kind } : a));
  };
  const setAccountTrades = (trades) => {
    persist("patchAccount.trades", api.patchAccount({ trades }));
    setAccounts((as) => as.map((a) => a.id === account.id ? { ...a, trades } : a));
  };

  // Flatten company + engagement into the "sub" shape the UI consumes.
  const subs = useMemo(() => engagements
    .filter((e) => e.accountId === account.id)
    .map((e) => {
      const co = companies.find((c) => c.id === e.companyId);
      return co ? composeSub(co, e) : null;
    })
    .filter(Boolean), [engagements, companies, account.id]);

  // Properties belong to the account you're viewing.
  const accountProperties = useMemo(
    () => properties.filter((p) => p.accountId === account.id), [properties, account.id]);
  const propName = (id) => (properties.find((p) => p.id === id) || {}).name || "—";
  // A vendor with no properties listed is available everywhere in the account.
  const servesProperty = (sub, propertyId) =>
    !propertyId || !(sub.propertyIds || []).length || sub.propertyIds.includes(propertyId);

  // Jobs you can see are your account's. But crew AVAILABILITY is computed from
  // allJobs — a crew booked by another GC genuinely cannot work for you that day.
  const jobs = useMemo(() => allJobs.filter((j) => j.accountId === account.id),
    [allJobs, account.id]);

  // Users visible in THIS account, with their role in it.
  const accountUsers = useMemo(() => memberships
    .filter((m) => m.accountId === account.id)
    .map((m) => {
      const u = users.find((x) => x.id === m.userId);
      return u ? { ...u, role: m.role, subId: m.companyId ?? null,
        propertyIds: m.propertyIds || [], unit: m.unit || null } : null;
    })
    .filter(Boolean), [memberships, users, account.id]);

  const mySub = role === "contractor"
    ? subs.find((s) => s.id === membership.companyId)
    : null;
  const filtered = useMemo(() => {
    const list = subs.filter((s) => {
      if (fCats.length && !s.categories.some((c) => fCats.includes(c))) return false;
      if (fCaps.length && !s.caps.some((c) => fCaps.includes(c))) return false;
      if (fAreas.length) {
        const cov = coverageAreas(s.coverage);
        if (!cov.some((a) => fAreas.includes(a))) return false;
      }
      if (fRatings.length && s.rating < minRating) return false;
      if (fCrew.length && !fCrew.some((id) => CREW_TIERS.find((t) => t.id === id)?.test(headCount(s)))) return false;
      if (fAvail.length) {
        const state = s.available ? "available" : "unavailable";
        if (!fAvail.includes(state)) return false;
      }
      if (readyOnly && !(s.bond && s.insurance && s.contract)) return false;
      if (autoOnly && !s.autoSchedule) return false;
      if (fEarn.length || fDone.length) {
        const st = contractorStats(s, jobs);
        if (fEarn.length && !fEarn.some((id) => EARN_TIERS.find((t) => t.id === id)?.test(st.earned))) return false;
        if (fDone.length && !fDone.some((id) => DONE_TIERS.find((t) => t.id === id)?.test(st.completed))) return false;
      }
      if (inRangeOnly && jobZip) {
        const p = coversZip(s, jobZip);
        if (!p?.inRange) return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = [s.company, s.contact, s.email, s.notes, coverageLabel(s.coverage),
          ...s.caps, ...s.categories.map((c) => catMeta(c).label)].join(" ").toLowerCase();
        const rq = parseFloat(q);
        if (!hay.includes(q) && !(rq && s.rating >= rq)) return false;
      }
      return true;
    });
    const withProx = jobZip ? list.map((s) => ({ ...s, _prox: coversZip(s, jobZip) })) : list;
    const st = (x) => contractorStats(x, jobs);
    const byDistance = (a, b) => {
      const da = a._prox?.distance, db = b._prox?.distance;
      if (da == null) return 1; if (db == null) return -1;
      return da - db;
    };
    const sorted = [...withProx];
    switch (sortBy) {
      case "rating":    sorted.sort((a, b) => b.rating - a.rating); break;
      case "earned":    sorted.sort((a, b) => st(b).earned - st(a).earned); break;
      case "completed": sorted.sort((a, b) => st(b).completed - st(a).completed); break;
      case "accept":    sorted.sort((a, b) => acceptRate(b) - acceptRate(a)); break;
      case "crew":      sorted.sort((a, b) => headCount(b) - headCount(a)); break;
      case "name":      sorted.sort((a, b) => a.company.localeCompare(b.company)); break;
      case "distance":  sorted.sort(byDistance); break;
      default:
        // best match: nearest first when a job ZIP is set, else docs+available+rating
        if (jobZip) sorted.sort(byDistance);
        else sorted.sort((a, b) =>
          (docsComplete(b) - docsComplete(a)) ||
          (Number(b.available) - Number(a.available)) ||
          (b.rating - a.rating));
    }
    return sorted;
  }, [subs, fCats, fCaps, fAreas, fRatings, minRating, fCrew, fAvail, readyOnly, autoOnly, fEarn, fDone, jobs, query, jobZip, inRangeOnly, sortBy]);

  const clearFilters = () => {
    setQuery(""); setFCats([]); setFCaps([]); setFAreas([]); setFRatings([]); setFCrew([]); setFAvail([]);
    setReadyOnly(false); setAutoOnly(false); setFEarn([]); setFDone([]); setJobZip(""); setInRangeOnly(false);
  };
  const activeCount = fCats.length + fCaps.length + fAreas.length + fRatings.length +
    fCrew.length + fAvail.length + fEarn.length + fDone.length + (readyOnly ? 1 : 0) + (autoOnly ? 1 : 0) + (query.trim() ? 1 : 0) +
    (jobZip ? 1 : 0) + (inRangeOnly ? 1 : 0);

  // --- Jobs: a job has multiple trades, each trade gets its own contractor ---
  const createJob = async (job, forSub) => {
    let id, requested = false;
    try { ({ id, requested } = await api.createJob(job)); }
    catch (err) { console.error("[persist] createJob failed:", err); id = Date.now(); }
    logEvent(requested ? "job_requested" : "job_created",
      requested ? `Requested work: ${job.title}` : `Created job ${job.title}`);

    const assignments = {};
    if (forSub && docsComplete(forSub)) {
      job.trades.filter((t) => forSub.categories.includes(t)).forEach((t) => {
        assignments[t] = issueWO(forSub, job, t);
        persist("assign", api.assign(id, {
          trade: t, companyId: forSub.id, tradeScope: assignments[t].tradeScope,
          value: assignments[t].value, crewName: assignments[t].crewName,
          responseWindow: assignments[t].responseWindow,
        }));
      });
    }
    setJobs((js) => [{ ...job, id, accountId: account.id, status: "active", notes: "",
      createdAt: new Date().toISOString().slice(0, 10), assignments,
      // Mirrors what the server just decided, so the row reads as a request
      // straight away rather than looking like a live job until the next load.
      requestedBy: requested ? currentUserId : null, approvedAt: null }, ...js]);
    setJobForm(null);
    setTab("jobs");
    return id;
  };

  // Agreeing to work a building owner asked for. Until this happens nothing
  // can be assigned against it, which the server enforces too.
  const approveJob = (id) => {
    const jb = allJobs.find((j) => j.id === id);
    persist("approveJob", api.approveJob(id));
    setJobs((js) => js.map((j) => (j.id === id
      ? { ...j, approvedAt: new Date().toISOString() } : j)));
    if (jb) logEvent("job_approved", `Approved requested work: ${jb.title}`);
  };

  // Mark a job complete — this is what unlocks rating and notes.
  const completeJob = (id) => {
    const jb = allJobs.find((j) => j.id === id);
    if (jb) logEvent("job_completed", `Completed ${jb.title}`);
    persist("completeJob", api.completeJob(id));
    setJobs((js) => js.map((j) => j.id === id ? {
      ...j, status: "completed", completedAt: new Date().toISOString().slice(0, 10) } : j));
  };
  const completeJobInner = (id) =>
    setJobs((js) => js.map((j) => j.id === id ? {
      ...j, status: "completed", completedAt: new Date().toISOString().slice(0, 10) } : j));
  const reopenJob = (id) => {
    persist("reopenJob", api.reopenJob(id));
    setJobs((js) => js.map((j) => j.id === id ? { ...j, status: "active", completedAt: null } : j));
  };
  const setJobNotes = (id, notes) => {
    persist("patchJob.notes", api.patchJob(id, { notes }));
    setJobs((js) => js.map((j) => j.id === id ? { ...j, notes } : j));
  };
  const addMeasurementDoc = (id, name) => {
    const next = [...(allJobs.find((j) => j.id === id)?.measurementDocs || []), name];
    persist("patchJob.measurementDocs", api.patchJob(id, { measurementDocs: next }));
    setJobs((js) => js.map((j) => j.id === id ? { ...j, measurementDocs: next } : j));
  };
  const removeMeasurementDoc = (id, name) => {
    const next = (allJobs.find((j) => j.id === id)?.measurementDocs || []).filter((d) => d !== name);
    persist("patchJob.measurementDocs", api.patchJob(id, { measurementDocs: next }));
    setJobs((js) => js.map((j) => j.id === id ? { ...j, measurementDocs: next } : j));
  };

  // Assigning a contractor ISSUES a work order for that trade. The WO is never
  // authored separately — it is derived from the job plus these trade details.
  const assignContractor = (jobId, trade, sub, details = {}) => {
    // One work order per trade, each with its OWN scope and value. Nothing
    // is bundled implicitly — the admin ticked each trade on the form.
    const wanted = (details.trades && details.trades.length)
      ? details.trades
      : [{ trade, tradeScope: details.tradeScope || "", value: details.value || "" }];
    wanted.forEach((ln) => {
      persist("assign", api.assign(jobId, {
        trade: ln.trade, companyId: sub.id, tradeScope: ln.tradeScope, value: ln.value,
        crewName: details.crewName, responseWindow: details.responseWindow,
      }));
    });
    { const jb = allJobs.find((j) => j.id === jobId);
      const n = (details.trades && details.trades.length) || 1;
      if (jb) logEvent("wo_issued", `Issued ${n > 1 ? n + " work orders" : "a work order"} to ${sub.company} on ${jb.title}`); }
    setJobs((js) => js.map((j) => {
      if (j.id !== jobId) return j;
      const next = { ...j.assignments };
      wanted.forEach((ln) => {
        next[ln.trade] = issueWO(sub, j, ln.trade, {
          crewName: details.crewName,
          responseWindow: details.responseWindow,
          tradeScope: ln.tradeScope,
          value: ln.value,
        });
      });
      return { ...j, assignments: next };
    }));
    setAssigning(null);
    setAssignSub(null);
    setTab("jobs");
  };

  const unassignTrade = (jobId, trade) => {
    persist("unassign", api.unassignTrade(jobId, trade));
    setJobs((js) => js.map((j) => {
      if (j.id !== jobId) return j;
      const a = { ...j.assignments }; delete a[trade];
      return { ...j, assignments: a };
    }));
  };
  // A reply after the deadline is refused here as well as in the UI, so a
  // stale tab can't accept an expired offer.
  const respondTrade = (jobId, trade, status) => {
    const woId = allJobs.find((j) => j.id === jobId)?.assignments?.[trade]?.id;
    if (woId) persist("respond", api.respondToWorkOrder(woId, status));
    setJobs((js) => js.map((j) => {
      if (j.id !== jobId) return j;
      const a = j.assignments[trade];
      if (!a || isExpired(a, Date.now())) return j;
      return { ...j, assignments: { ...j.assignments, [trade]: {
        ...a, status, respondedAt: new Date().toISOString() } } };
    }));
  };
  // Rate a contractor's performance on one trade of one job; the contractor's
  // overall rating becomes the average of all their rated jobs.
  const rateAssignment = (jobId, trade, stars) => {
    const woId = allJobs.find((j) => j.id === jobId)?.assignments?.[trade]?.id;
    if (woId) persist("rate", api.rateWorkOrder(woId, stars));
    setJobs((js) => {
      const next = js.map((j) => j.id !== jobId ? j : {
        ...j, assignments: { ...j.assignments, [trade]: { ...j.assignments[trade], rating: stars } },
      });
      const subId = next.find((j) => j.id === jobId)?.assignments[trade]?.subId;
      if (subId != null) {
        const all = next.flatMap((j) => Object.values(j.assignments || {})
          .filter((a) => a.subId === subId && a.rating));
        if (all.length) {
          const avg = all.reduce((n, a) => n + a.rating, 0) / all.length;
          // Your rating of them belongs to the relationship, not the company.
          // (The server already recomputed this same average — this just
          // keeps the local view in sync without waiting for a refetch.)
          setEngagements((es) => es.map((e) =>
            (e.companyId === subId && e.accountId === currentAccountId)
              ? { ...e, rating: Math.round(avg * 10) / 10, ratedJobs: all.length } : e));
        }
      }
      return next;
    });
  };

  const uploadSignedWO = (jobId, trade, file) => {
    const name = file.name;
    const woId = allJobs.find((j) => j.id === jobId)?.assignments?.[trade]?.id;
    setJobs((js) => js.map((j) => j.id !== jobId ? j : {
      ...j, assignments: { ...j.assignments, [trade]: { ...j.assignments[trade], signedWO: name } } }));
    if (!woId) return;
    (async () => {
      try {
        const { key: fileKey } = await api.uploadFile("signed-wo", file);
        await api.setWorkOrderSigned(woId, fileKey);
      } catch (err) {
        console.error("[persist] uploadSignedWO failed:", err);
      }
    })();
  };
  const setTradeCrew = (jobId, trade, crewName) => {
    const woId = allJobs.find((j) => j.id === jobId)?.assignments?.[trade]?.id;
    if (woId) persist("crew", api.setWorkOrderCrew(woId, crewName));
    setJobs((js) => js.map((j) => j.id !== jobId ? j : {
      ...j, assignments: { ...j.assignments, [trade]: { ...j.assignments[trade], crewName } },
    }));
  };

  const atContractorLimit = subs.length >= PLANS[plan].limit;
  // Basic allows 5 jobs per calendar month; Scale is unlimited.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const jobsThisMonth = jobs.filter((j) => (j.createdAt || "").slice(0, 7) === thisMonth).length;
  const atJobLimit = jobsThisMonth >= PLANS[plan].jobsPerMonth;
  const canBrand = PLANS[plan].branding;
  // Basic includes a single user; Scale is unlimited. Contractor logins don't
  // count against the seat limit — only admins and property managers do.
  // Neither do tenants: a building has as many as it has apartments, and charging
  // per resident would price the feature out of being used at all.
  const seatCount = accountUsers.filter((u) => u.role !== "contractor" && u.role !== "tenant").length;
  const atSeatLimit = seatCount >= PLANS[plan].userLimit;
  const addSub = (sub) => {
    logEvent("sub_added", `Added ${sub.company}`);
    // Dedupe on WA L&I license: if this business is already on SubSub for
    // another account, reuse the company record and only add the relationship.
    // Their profile, crews and documents come across immediately.
    const lic = (sub.license || "").trim().toUpperCase();
    const existing = lic ? companies.find((c) => (c.license || "").toUpperCase() === lic) : null;
    const { co, en } = splitSeed(sub);
    const companyId = existing ? existing.id : Date.now();
    // Server dedupes the same way (on license, then email) — local ids only
    // drift from the real ones for a brand-new company until the next hydrate.
    persist("addSub", api.addSub(sub));
    if (!existing) setCompanies((cs) => [{ ...co, id: companyId }, ...cs]);
    setEngagements((es) => [{
      id: "e" + Date.now(), accountId: account.id, companyId,
      ...en, status: "active", rating: 0, ratedJobs: 0, accepted: 0, declined: 0,
    }, ...es]);
    setAdding(false);
  };
  // Called instead of opening the form when the plan is maxed out.
  // Persists first so the id is the real one, then applies the optimistic
  // shape the UI expects — same pattern as createJob. A failed write falls
  // back to a local-only id rather than freezing the form.
  const addProperty = async (p) => {
    let id;
    try { ({ id } = await api.createProperty(p)); }
    catch (err) { console.error("[persist] createProperty failed:", err); id = "p" + Date.now(); }
    setProperties((ps) => [{ ...p, id, accountId: account.id }, ...ps]);
    return id;
  };
  const patchProperty = (id, patch) => {
    persist("patchProperty", api.patchProperty(id, patch));
    setProperties((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const removeProperty = (id) => {
    // The server clears the same two pointers inside one batch: the vendor
    // scoping rows, and any job still aimed at this property.
    persist("removeProperty", api.removeProperty(id));
    setProperties((ps) => ps.filter((p) => p.id !== id));
    // drop it from any vendor scoped to it, so nothing points at a dead property
    setEngagements((es) => es.map((e) => (e.propertyIds || []).includes(id)
      ? { ...e, propertyIds: e.propertyIds.filter((x) => x !== id) } : e));
  };
  const tryAddJob = (forSub, forProperty) => {
    // The plan belongs to the account, not to a guest of it. Showing an owner
    // an upgrade prompt would be asking the wrong person for money.
    if (atJobLimit && runsTheAccount(role, membership)) { setAddMenu(false); setUpgradePrompt({ kind: "job" }); return; }
    if (atJobLimit) { setAddMenu(false); setBillingNote("This account has reached its job limit. Ask whoever manages it to raise it."); return; }
    setJobForm({ ...(forSub ? { forSub } : {}), ...(forProperty ? { forProperty } : {}) });
  };
  const tryAddContractor = () => {
    if (atContractorLimit) { setAddMenu(false); setUpgradePrompt({ kind: "contractor" }); return; }
    setAdding(true);
  };
  // The new-property form lives inside PropertiesView, which owns it because
  // that is where it is nearly always opened from. Opening it from the header
  // means crossing that boundary, so a nonce is passed down and the view
  // opens a blank form whenever it changes -- a boolean would not fire twice
  // in a row, and "Add a property, cancel, add another" is an ordinary thing
  // to do.
  const tryAddProperty = () => { setTab("properties"); setNewPropertyAt(Date.now()); };
  const tryAddUser = () => {
    if (atSeatLimit) { setAddMenu(false); setUpgradePrompt({ kind: "user" }); return; }
    setUserForm(true);
  };
  const updateSub = (sub) => {
    patchSub(sub.id, sub);
    setEditing(null);
  };
  // One place for the "you've been matched but we need paperwork" email.
  // Available from every surface where a non-compliant contractor appears.
  // One-way compliance notification. Email always, SMS optional.
  const requestDocs = (sub, job = null, trade = null) => {
    setSelected(null); setAssigning(null); setAssignSub(null);
    setNotifying({ sub, job, trade });
  };

  const saveNotes = (id, notes) =>
    patchSub(id, { notes });

  // job slots assigned to me, for the contractor dashboard + tab badge
  const myAssignments = mySub ? jobs.flatMap((j) =>
    Object.entries(j.assignments || {})
      .filter(([, a]) => a.subId === mySub.id)
      .map(([trade, a]) => ({ job: j, trade, a }))) : [];
  const pendingCount = myAssignments.filter((m) => m.a.status === "pending" && !m.a.auto).length;

  // --- user management (admin only) ---
  // A user is global; joining an account is a membership.
  const addUser = (u) => {
    persist("addAccountUser", api.addAccountUser(u));
    const existing = users.find((x) => x.email.toLowerCase() === (u.email || "").toLowerCase());
    const userId = existing ? existing.id : "u" + Date.now();
    if (!existing) setUsers((us) => [...us, { id: userId, name: u.name, email: u.email, phone: u.phone }]);
    setMemberships((ms) => [...ms.filter((m) => !(m.userId === userId && m.accountId === account.id)),
      { userId, accountId: account.id, role: u.role, companyId: u.subId ?? null,
        propertyIds: u.propertyIds || [] }]);
    setUserForm(false);
  };
  // Removing someone from an account drops the membership, not the person —
  // they may still be a contractor or admin elsewhere.
  const removeUser = (id) => {
    persist("removeAccountUser", api.removeAccountUser(id));
    setMemberships((ms) => ms.filter((m) => !(m.userId === id && m.accountId === account.id)));
  };
  const updateUser = (u) => {
    persist("updateAccountUser", api.updateAccountUser(u.id, {
      name: u.name, email: u.email, phone: u.phone, role: u.role, subId: u.subId,
      propertyIds: u.propertyIds || [],
    }));
    // name/email/phone are the person; role is the membership.
    setMemberships((ms) => ms.map((m) =>
      (m.userId === u.id && m.accountId === account.id)
        ? { ...m, role: u.role, companyId: u.subId ?? m.companyId,
            propertyIds: u.role === "owner" ? (u.propertyIds || []) : [] } : m));
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
    setEditUser(null);
  };

  // ---- writers ------------------------------------------------------------
  // Every contractor write goes through here, so the routing lives in ONE place
  // — and, now, the one place that persists. The server's own splitPatch
  // routes the same flat object to companies/engagements independently, so
  // sending it unmodified is enough.
  const patchCompany = (companyId, patch) =>
    setCompanies((cs) => cs.map((c) => (c.id === companyId ? { ...c, ...patch } : c)));
  const patchEngagement = (companyId, patch) =>
    setEngagements((es) => es.map((e) =>
      (e.companyId === companyId && e.accountId === account.id) ? { ...e, ...patch } : e));
  // Split a flat patch and write each half to its own table.
  const patchSub = (companyId, patch) => {
    // propertyIds is an engagement field, but it lives in its own join table
    // rather than a column, so it goes to its own endpoint and is kept out of
    // the generic PATCH body.
    const { propertyIds, ...rest } = patch;
    if (propertyIds !== undefined) {
      persist("setSubProperties", api.setSubProperties(companyId, propertyIds));
    }
    if (Object.keys(rest).length) persist("patchSub", api.patchSub(companyId, rest));
    const { co, en } = splitPatch(patch);
    if (Object.keys(co).length) patchCompany(companyId, co);
    if (Object.keys(en).length) patchEngagement(companyId, en);
  };
  // Merge into the engagement's docReview (per-GC verdict on a shared file).
  const patchDocReview = (companyId, kind, review) => {
    const cur = engagements.find((e) => e.companyId === companyId && e.accountId === account.id);
    patchSub(companyId, {
      docReview: { ...((cur && cur.docReview) || {}), [kind]: review },
    });
  };

  // --- contractor self-service ---
  // Verification: a document only counts once a human has checked it.
  const verifySubDoc = (id, kind, data) => {
    { const sb = subs.find((x) => x.id === id); if (sb) logEvent("doc_verified", `Verified ${DOC_LABELS_INLINE[kind]} for ${sb.company}`); }
    patchDocReview(id, kind, {
      status: "verified", ...data,
      verifiedBy: me.name, verifiedAt: new Date().toISOString().slice(0, 10),
    });
    setReviewing(null);
  };
  const rejectSubDoc = (id, kind, data) => {
    { const sb = subs.find((x) => x.id === id); if (sb) logEvent("doc_rejected", `Rejected ${DOC_LABELS_INLINE[kind]} for ${sb.company}`); }
    patchDocReview(id, kind, {
      status: "rejected", ...data,
      verifiedBy: me.name, verifiedAt: new Date().toISOString().slice(0, 10),
    });
    setReviewing(null);
    const target = subs.find((x) => x.id === id);
    if (target) requestDocs({ ...target, docReview: { ...(target.docReview || {}), [kind]: { status: "rejected", ...data } } });
  };

  // Runs the L&I lookup and stores the result on the contractor record.
  const verifyLicense = async (id) => {
    const co = companies.find((c) => c.id === id);
    if (!co) return;
    { const sb = subs.find((x) => x.id === id); if (sb) logEvent("license_check", `Ran L&I license check on ${sb.company}`); }
    try {
      const result = await api.verifyLicense(id);
      patchCompany(id, { licenseCheck: result });
    } catch (err) {
      console.error("[persist] verifyLicense failed, using local simulation:", err);
      patchCompany(id, { licenseCheck: lookupLicense(co) });
    }
  };

  // The FILE belongs to the company (uploaded once, shared by every GC).
  // The REVIEW belongs to each engagement, so a re-upload re-opens the queue
  // for every account that engages them.
  // Raise a callback or warranty claim. The sub has to confirm the return
  // visit from their own dashboard before it counts as scheduled.
  const raiseServiceCall = (job, trade, a, data) => {
    logEvent("service_call", `Raised a ${data.kind === "warranty" ? "warranty claim" : "callback"} on ${job.title} · ${a.company}`);
    persist("raiseServiceCall", api.raiseServiceCall({
      jobId: job.id, trade, subId: a.subId, crewName: a.crewName,
      kind: data.kind, issue: data.issue, returnDate: data.returnDate || null, raisedBy: me.name,
    }));
    setServiceCalls((cs) => [{
      id: "sc" + Date.now(),
      accountId: account.id, jobId: job.id, trade, subId: a.subId,
      company: a.company, crewName: a.crewName,
      kind: data.kind,                       // "callback" | "warranty"
      issue: data.issue,
      returnDate: data.returnDate || null,
      status: "awaiting-confirmation",       // -> scheduled -> resolved
      raisedBy: me.name,
      raisedAt: new Date().toISOString(),
      confirmedAt: null, resolvedAt: null, subNote: "",
    }, ...cs]);
    setRaising(null);
  };
  // Raise a change order against an accepted work order. The other side has
  // to accept it before it counts toward the revised value.
  const raiseChangeOrder = (job, trade, a, data) => {
    const existing = cosFor(changeOrders, job.id, trade);
    logEvent("change_order", `${data.origin === "sub" ? "Subcontractor requested" : "Issued"} ${coSeq(existing.length + 1)} on ${a.wo} · ${data.kind}`);
    const origin = data.origin || "gc";
    setChangeOrders((cs) => [{
      id: "co" + Date.now(),
      accountId: account.id, jobId: job.id, trade, wo: a.wo,
      subId: a.subId, company: a.company,
      seq: existing.length + 1,
      origin,                                  // "gc" | "sub"
      kind: data.kind,                         // add | deduct | nocost
      scope: data.scope,
      valueDelta: data.kind === "nocost" ? 0
        : (data.kind === "deduct" ? -1 : 1) * Math.abs(Number(moneyRaw(data.value) || 0)),
      status: "pending",
      responseWindow: origin === "gc" ? (data.responseWindow || DEFAULT_WINDOW) : null,
      respondBy: origin === "gc"
        ? new Date(Date.now() + windowMins(data.responseWindow || DEFAULT_WINDOW) * 60000).toISOString()
        : null,
      raisedBy: data.raisedBy || me.name,
      raisedAt: new Date().toISOString(),
      respondedAt: null, note: "",
    }, ...cs]);
    setCoForm(null);
  };
  // Either side responds. A late accept on a GC-raised CO is refused here as
  // well as in the UI, same as the original offer.
  const respondChangeOrder = (id, status, note = "") =>
    setChangeOrders((cs) => cs.map((c) => {
      if (c.id !== id) return c;
      if (coExpired(c, Date.now())) return c;
      return { ...c, status, note, respondedAt: new Date().toISOString() };
    }));
  const voidChangeOrder = (id) =>
    setChangeOrders((cs) => cs.map((c) => c.id === id && c.status === "pending"
      ? { ...c, status: "void", respondedAt: new Date().toISOString() } : c));

  // Sub confirms (or proposes a different date) from their portal.
  const confirmServiceCall = (id, patch = {}) => {
    persist("confirmServiceCall", api.confirmServiceCall(id, patch));
    setServiceCalls((cs) => cs.map((c) => c.id !== id ? c : {
      ...c, status: "scheduled", confirmedAt: new Date().toISOString(), ...patch }));
  };
  const resolveServiceCall = (id) => {
    persist("resolveServiceCall", api.resolveServiceCall(id));
    setServiceCalls((cs) => cs.map((c) => c.id !== id ? c : {
      ...c, status: "resolved", resolvedAt: new Date().toISOString() }));
  };

  const uploadSubDoc = (id, key, file) => {
    const filename = file.name;
    const co = companies.find((c) => c.id === id);
    patchCompany(id, { [key]: true, docFiles: { ...((co && co.docFiles) || {}), [key]: filename } });
    setEngagements((es) => es.map((e) => e.companyId !== id ? e : {
      ...e, docReview: { ...(e.docReview || {}), [key]: { status: "pending" } } }));

    (async () => {
      try {
        const { key: fileKey } = await api.uploadFile(key, file);
        await api.uploadDocument(id, key, fileKey, filename);
      } catch (err) {
        console.error("[persist] uploadSubDoc failed:", err);
      }
    })();
  };
  const deleteSubDoc = (id, key) => {
    persist("deleteDoc", api.deleteDocument(id, key));
    const co = companies.find((c) => c.id === id);
    patchCompany(id, { [key]: false, docFiles: { ...((co && co.docFiles) || {}), [key]: null } });
    setEngagements((es) => es.map((e) => e.companyId !== id ? e : {
      ...e, docReview: { ...(e.docReview || {}), [key]: null } }));
  };

  // ---- persistence wiring ---------------------------------------------
  // Pulls this account's companies/engagements/jobs/members from the API and
  // replaces the corresponding local state. Called on login and whenever the
  // account switcher changes accounts.
  async function hydrateAccount(accountId, userId) {
    setLoading(true);
    try {
      // allSettled, not all: a building owner is refused several of these
      // outright -- the cross-account booking feed, the uniform orders -- and
      // one 403 rejecting the whole batch would leave them staring at an empty
      // account rather than at their own buildings. A call that fails yields
      // an empty list, which is the truthful answer for a seat that may not
      // see the thing.
      const settled = await Promise.allSettled([
        api.listSubs(), api.listJobs(), api.listAllBookings(), api.listAccountUsers(),
        api.listUniformOrders(), api.listServiceCalls(), api.listProperties(),
      ]);
      settled.forEach((r, i) => {
        if (r.status === "rejected") console.warn("[hydrate] call", i, "failed:", r.reason);
      });
      const [flatSubs, ownJobs, bookings, members, uniformOrderRows, serviceCallRows,
             propertyRows] = settled.map((r) => (r.status === "fulfilled" && Array.isArray(r.value)) ? r.value : []);
      setUniformOrders(uniformOrderRows);
      setServiceCalls(serviceCallRows);
      setProperties(propertyRows);

      const cos = [], ens = [];
      flatSubs.forEach((flat) => {
        const { co, en } = splitSeed(flat);
        co.id = flat.id;
        en.id = flat.engagementId; en.accountId = flat.accountId; en.companyId = flat.id;
        cos.push(co); ens.push(en);
      });
      setCompanies(cos);
      setEngagements(ens);

      // Full detail for our own jobs, plus a privacy-preserving stub (date +
      // which crew is busy, nothing else) for every OTHER account's booking,
      // so dayStatus() still refuses to double-book a crew across GCs.
      const otherStubs = {};
      bookings.filter((b) => b.account_id !== accountId).forEach((b) => {
        const j = (otherStubs[b.job_id] ||= { id: b.job_id, accountId: b.account_id, date: b.date, assignments: {} });
        j.assignments[b.trade] = { subId: b.company_id, crewName: b.crew_name };
      });
      setJobs([...ownJobs, ...Object.values(otherStubs)]);

      setUsers((prev) => {
        const byId = Object.fromEntries(prev.map((u) => [u.id, u]));
        members.forEach((m) => { byId[m.id] = { id: m.id, name: m.name, email: m.email, phone: m.phone }; });
        return Object.values(byId);
      });
      setMemberships((prev) => {
        const key = (m) => `${m.userId}:${m.accountId}`;
        const byKey = Object.fromEntries(prev.map((m) => [key(m), m]));
        members.forEach((m) => {
          byKey[`${m.id}:${accountId}`] = { userId: m.id, accountId, role: m.role, companyId: m.subId,
            propertyIds: m.propertyIds || [], unit: m.unit || null };
        });
        return Object.values(byKey);
      });
    } catch (err) {
      console.error("[hydrate] failed:", err);
    } finally {
      setLoading(false);
    }
  }

  // `email` is only used in dev-stub mode (see LoginPage) — in real-auth
  // mode, identity already comes from the Supabase session that
  // signInWithPassword() just established, so this just asks who that is.
  // Returns null on success, or a message to show. It used to return
  // silently on both failure paths, which left someone who had just typed
  // the right password sitting on the sign-in screen with no explanation and
  // nothing to act on.
  async function handleLogin(email) {
    let result;
    try {
      result = await (supabaseEnabled ? api.getMe() : api.devLogin(email));
    } catch (err) {
      console.error("[login] failed:", err);
      if (err?.status === 401 || err?.status === 404) {
        return "Your login works, but this email isn't on a SubSub account yet. "
          + "Ask whoever runs the account to add you.";
      }
      if (err?.status === 501) return "This site isn't finished being set up. Tell your admin.";
      // A stack trace is not a message. Somebody trying to sign in cannot act
      // on "no such column", and reading one does not inspire confidence in
      // the company holding their insurance certificates. The detail is
      // logged above and in the Worker's own log, which is where it is
      // useful; what reaches the screen says what to do instead.
      if (err?.status >= 500) {
        return "SubSub is having a problem right now — this isn't your login. "
          + "Try again in a minute, and let us know if it keeps happening.";
      }
      if (err?.status === 429) {
        return "Too many attempts from this connection. Wait a few minutes and try again.";
      }
      if (err?.status) return "We couldn't complete that sign-in. Try again in a moment.";
      return "Couldn't reach SubSub. Check your connection, then try again.";
    }
    if (!result) return "Couldn't sign you in. Try again.";
    if (!result.memberships.length) {
      return "Your login works, but you're not a member of any account yet. "
        + "Ask whoever runs the account to add you.";
    }

    // Land in the account this subdomain belongs to, if the person has a
    // membership there — signing in on outerhome.subsub.work shouldn't drop
    // someone into a different company they also happen to belong to.
    const onSub = detectSubdomain();
    const here = onSub && result.memberships.find((m) => m.subdomain === onSub);
    if (here) return enterAccount(result, here);

    // A subcontractor who works for four general contractors has four of
    // these, and picking the first is a coin toss they have to undo. Ask.
    if (result.memberships.length > 1) { setChooser(result); return null; }
    return enterAccount(result, result.memberships[0]);
  }

  // The rest of signing in, once it is settled which account is being entered.
  async function enterAccount(result, primary) {
    setChooser(null);
    setAuth({ userId: result.user.id, accountId: primary.accountId });
    setUsers((prev) => [...prev.filter((u) => u.id !== result.user.id), result.user]);
    setMemberships((prev) => [
      ...prev.filter((m) => m.userId !== result.user.id),
      ...result.memberships.map((m) => ({ userId: result.user.id, accountId: m.accountId, role: m.role, companyId: m.companyId })),
    ]);
    setAccounts((prev) => {
      const byId = Object.fromEntries(prev.map((a) => [a.id, a]));
      result.memberships.forEach((m) => {
        byId[m.accountId] = { id: m.accountId, name: m.accountName, subdomain: m.subdomain,
          kind: m.kind, plan: m.plan, billing: m.billing, theme: m.theme, trades: m.trades,
          subscriptionStatus: m.subscriptionStatus, currentPeriodEnd: m.currentPeriodEnd,
          comped: m.comped, cancelAtPeriodEnd: m.cancelAtPeriodEnd,
          hostnameStatus: m.hostnameStatus,
          logoData: m.logoKey ? logoUrl(m.accountId) : null, useDefaultMark: m.useDefaultMark };
      });
      return Object.values(byId);
    });
    setCurrentUserId(result.user.id);
    setCurrentAccountId(primary.accountId);
    setTab(ROLES[primary.role].can[0]);
    setLoggedIn(true);
    await hydrateAccount(primary.accountId, result.user.id);
    return null;
  }

  useEffect(() => {
    if (!tenantToken) return;
    let live = true;
    api.lookupTenantInvite(tenantToken).then((res) => {
      if (!live) return;
      setTenantInvite(res);
      setPublicView("tenant-signup");
    }).catch((err) => {
      if (!live) return;
      console.error("[tenant-invite] lookup failed:", err);
      setTenantInviteErr(err?.status === 410
        ? "That link has already been used, or it has expired. Ask your building manager for a new one."
        : "That link isn't valid. Check you copied all of it, or ask your building manager for a new one.");
      setPublicView("tenant-signup");
    });
    return () => { live = false; };
  }, [tenantToken]);

  useEffect(() => {
    if (!inviteToken) return;
    let live = true;
    api.lookupInvite(inviteToken).then((res) => {
      if (!live) return;
      setInvite(res);
      setPublicView("signup");
    }).catch((err) => {
      if (!live) return;
      console.error("[invite] lookup failed:", err);
      // A spent link and a forged one are not worth telling apart on screen;
      // both need the same instruction, which is to ask for another.
      setInviteErr(err?.status === 410
        ? "That invite link has already been used, or it has expired. Ask whoever sent it for a new one."
        : "That invite link isn't valid. Check you copied all of it, or ask whoever sent it for a new one.");
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  // Resume a session across reloads. A signed-in person stays signed in:
  // Supabase keeps the session in this browser and refreshes the access token
  // itself, so closing a tab, closing the laptop or coming back tomorrow
  // costs nothing. Nothing here ends a session for being away.
  const [resumeFailed, setResumeFailed] = useState(false);

  const resumeSession = async () => {
    const saved = getAuth();
    if (!saved?.userId || !saved?.accountId) return;
    // Never resume somebody else's seat. The banner lives in memory, so a
    // refresh would put a staff member back inside a customer's account with
    // nothing on screen saying so -- which is the one state this whole
    // mechanism exists to make impossible. Sessions are half an hour and
    // deliberately cheap to start again.
    if (saved.impersonation) {
      api.platform.endImpersonation(saved.impersonation);
      clearStoredAuth();
      return;
    }
    setResumeFailed(false);

    let acct;
    try {
      acct = await api.getAccount();
    } catch (err) {
      console.error("[resume] failed:", err);
      // Only a refusal means the session is genuinely over. A 500, a timeout
      // or a dropped connection means the server had a bad moment, and
      // throwing the session away over that is how somebody ends up signed
      // out by a bug they did not cause -- with no way to tell that from
      // having been logged out on purpose.
      if (err?.status === 401 || err?.status === 403) clearAuth();
      else setResumeFailed(true);
      return;
    }

    setAccounts((prev) => [...prev.filter((a) => a.id !== acct.id), {
      id: acct.id, name: acct.name, subdomain: acct.subdomain, kind: acct.kind,
      plan: acct.plan, billing: acct.billing,
      logoData: acct.logoKey ? logoUrl(acct.id) : null, useDefaultMark: acct.useDefaultMark,
      theme: acct.theme, trades: acct.trades,
      subscriptionStatus: acct.subscriptionStatus, currentPeriodEnd: acct.currentPeriodEnd,
      comped: acct.comped, cancelAtPeriodEnd: acct.cancelAtPeriodEnd,
      hostnameStatus: acct.hostnameStatus, hostnameCheckedAt: acct.hostnameCheckedAt,
    }]);
    if (acct.user) setUsers((prev) => [...prev.filter((u) => u.id !== acct.user.id), acct.user]);
    setCurrentUserId(saved.userId);
    setCurrentAccountId(saved.accountId);
    setLoggedIn(true);
    await hydrateAccount(saved.accountId, saved.userId);
  };

  useEffect(() => {
    // ?apply=1 is somebody asking for the public application form. Resuming a
    // session would put them in the app instead, which is the opposite of what
    // the link says -- and it is the link the account page uses to look at
    // what a subcontractor actually sees. "Back to sign in" gets them in.
    if (openingApplication) return;
    resumeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back from Stripe. The plan does not change here -- it changes when
  // Stripe's webhook arrives, which is usually a second or two behind the
  // browser. So say what happened, take the marker out of the address bar,
  // and re-read the account shortly after rather than leaving somebody who
  // has just paid looking at their old plan with no acknowledgement.
  const [billingNote, setBillingNote] = useState("");
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("billing");
    if (!outcome) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (outcome === "cancelled") { setBillingNote("Checkout cancelled — nothing was charged."); return; }
    setBillingNote("Payment received. Your plan updates in a moment.");
    const t = setTimeout(() => { resumeSession(); setBillingNote(""); }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching accounts, or an admin changing the account type, can leave the
  // current tab unreachable. Fall back rather than render an empty page.
  useEffect(() => {
    if (loggedIn && tab === "properties" && !hasProperties(account)) setTab("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, account.kind, loggedIn, tab]);

  if (!loggedIn && chooser) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <AccountChooser result={chooser} brand={brand}
          onPick={(m) => enterAccount(chooser, m)}
          onBack={() => { setChooser(null); if (supabaseEnabled) supabase.auth.signOut(); }} />
      </div>
    );
  }

  if (!loggedIn && resumeFailed) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <div className="wl-page">
          <div className="wl-card wl-done">
            <h1>Can't reach SubSub</h1>
            <p className="wl-lede">
              You're still signed in — we just couldn't load your account. Check your
              connection and try again.
            </p>
            <button className="wl-btn" onClick={() => resumeSession()}>Try again</button>
            <button className="wl-btn-ghost" style={{ marginTop: 10 }}
              onClick={() => { clearAuth(); setResumeFailed(false); }}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (!loggedIn && inviteToken && !invite && !inviteErr) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--muted)" }}>
          Checking your invite…
        </div>
      </div>
    );
  }

  if (!loggedIn && inviteErr) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <div className="wl-page">
          <div className="wl-card wl-done">
            <h1>This link doesn't work</h1>
            <p className="wl-lede">{inviteErr}</p>
            <button className="wl-btn-ghost" onClick={() => {
              // Drop the token as well as the message, or the render above
              // sees a token with nothing resolved and waits for a lookup
              // that already failed. Take it out of the address bar too, so
              // a reload does not land back here.
              setInviteErr("");
              setInviteToken(null);
              window.history.replaceState(null, "", window.location.pathname);
            }}>
              Go to sign-in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (authFlow) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <AuthLanding flow={authFlow} brand={brand}
          onCancel={closeAuthFlow}
          onDone={async () => {
            closeAuthFlow();
            // They hold a session already, so this is the ordinary sign-in
            // path rather than anything special.
            const msg = await handleLogin();
            if (msg) console.warn("[auth-link] signed in but could not enter:", msg);
          }} />
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        {BUILD === "platform" && publicView === "superadmin" ? (
          <SuperadminLogin
            onLogin={(me) => { setStaff(me); setCurrentUserId(me.userId); setSuperadminView(true); setLoggedIn(true); }} />
        ) : publicView === "tenant-signup" ? (
          <TenantSignup invite={tenantInvite} error={tenantInviteErr}
            onSubmit={(data) => api.acceptTenantInvite(tenantToken, data)}
            onBackToLogin={() => setPublicView("login")} />
        ) : publicView === "signup" ? (
          <SubSignup brand={brand}
            onSubmit={(data) => inviteToken
              ? api.acceptInvite(inviteToken, data)
              : api.applyToAccount(brand.subdomain, data)}
            onBackToLogin={leaveSignup} />
        ) : (
          <LoginPage users={users} brand={brand} accounts={accounts} memberships={memberships}
            onSignup={showSignup}
            onLogin={(email) => handleLogin(email)} />
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--muted)" }}>
          Loading…
        </div>
      </div>
    );
  }

  if (superadminView && BUILD === "platform") {
    const admin = staff || { role: "standard", finance: false, impersonate: false };
    // With real staff auth the data is the API's. The seed arrays are only a
    // fallback for the development picker, which no built bundle contains.
    const P = platform || (staff ? null : {
      accounts, users, memberships, companies, engagements, jobs: allJobs,
      subEvents, activity,
    });
    if (!P) {
      return (
        <div className="ss-root"><style>{CSS}</style>
          <div className="sa-page"><div className="sa-card">
            <div className="sa-brand"><SubSubLogo height={26} /><span className="pf-tag">Platform</span></div>
            <h1>{platformErr ? "Could not load" : "Loading…"}</h1>
            {platformErr && <p className="sa-lede">{platformErr}</p>}
          </div></div>
        </div>
      );
    }
    return (
      <div className="ss-root">
        <style>{CSS}</style>
        <SuperadminConsole me={me} admin={admin} accounts={P.accounts} users={P.users} memberships={P.memberships}
          companies={P.companies} engagements={P.engagements} jobs={P.jobs} subEvents={P.subEvents}
          activity={P.activity} smsDaily={P.smsDaily || []} err={platformErr}
          // Every write goes to the server, which re-checks the staff role,
          // writes the audit row and then changes the data. The console then
          // re-reads rather than patching local state: a console showing what
          // it hoped happened is worse than one that waits half a second.
          onAddUser={async (accountId, u) => {
            await platformWrite(() => api.platform.addUser(accountId, u),
              "Could not add that user.");
          }}
          onPatchAccount={async (id, patch) => {
            await platformWrite(() => api.platform.patchAccount(id, patch),
              "Could not change that account.");
          }}
          onCreateAccount={async (data) => {
            await platformWrite(() => api.platform.createAccount(data),
              "Could not create that account.");
          }}
          // Returns what Cloudflare said, so the panel can show it without
          // waiting for the reload the other writes trigger.
          onSyncHostname={async (id) =>
            platformWrite(() => api.platform.syncHostname(id),
              "Could not set up that address.")}
          // Read-only, so it does not reload the console the way a write does.
          onCheckHostnameSetup={() => api.platform.hostnameCheck()}
          onMailLog={(id) => api.platform.mailLog(id)}
          onSetupCheck={() => api.platform.setupCheck()}
          onDeleteAccount={async (id, confirmName) => {
            await platformWrite(() => api.platform.deleteAccount(id, confirmName),
              "Could not delete that account.");
          }}
          onCreateCompany={async (data) => {
            await platformWrite(() => api.platform.createCompany(data),
              "Could not create that company.");
          }}
          onEditCompany={async (id, patch) => {
            await platformWrite(() => api.platform.patchCompany(id, patch),
              "Could not save those changes.");
          }}
          onDeleteCompany={async (id, confirmName) => {
            await platformWrite(() => api.platform.deleteCompany(id, confirmName),
              "Could not delete that company.");
          }}
          // Takes the id itself rather than an object to pick a field out of.
          // It used to take the row and read `u.id`, but the row it is handed
          // carries `userId` -- so every reset asked the server for a user
          // called "undefined", got "no such user" back, and sent nothing.
          // A shape with one field named differently at each end is a bug
          // waiting to happen; two strings cannot be got wrong.
          onResetPassword={async (userId, accountId) => {
            // Nothing comes back but the address. The link is in the email and
            // nowhere else, which is the property that makes sending one on
            // somebody's behalf safe.
            return platformWrite(() => api.platform.resetPassword(userId, accountId),
              "Could not send that reset email.", { reload: false });
          }}
          onImpersonate={async (acct) => {
            // The server decides. It re-checks the impersonate flag, picks the
            // account's admin, and writes the audit row BEFORE handing the
            // session over — the banner in the interface is not the record.
            if (staff) {
              try {
                const r = await api.platform.impersonate(acct.id);
                // The token is what the API accepts. Setting the ids alone
                // used to leave every call refused, and the app fell back to
                // "contractor with no contractor record" -- an empty screen
                // where the account should have been.
                setAuth({ userId: r.actAsUserId, accountId: r.accountId, impersonation: r.token });
                setImpersonating({ by: me.name, account: acct, token: r.token });
                setCurrentAccountId(r.accountId); setCurrentUserId(r.actAsUserId);
                setSuperadminView(false);

                // And then actually load it. The console has the platform's
                // data, not this account's, so without this the app renders
                // whatever happened to be in state.
                const acctData = await api.getAccount();
                setAccounts((prev) => [...prev.filter((a) => a.id !== acctData.id), {
                  id: acctData.id, name: acctData.name, subdomain: acctData.subdomain,
                  kind: acctData.kind, plan: acctData.plan, billing: acctData.billing,
                  logoData: acctData.logoKey ? logoUrl(acctData.id) : null,
                  useDefaultMark: acctData.useDefaultMark, theme: acctData.theme,
                  trades: acctData.trades, subscriptionStatus: acctData.subscriptionStatus,
                  currentPeriodEnd: acctData.currentPeriodEnd,
                  hostnameStatus: acctData.hostnameStatus,
                }]);
                await hydrateAccount(r.accountId, r.actAsUserId);
                setTab(ROLES.admin.can[0]);
                setLoggedIn(true);
              } catch (e) {
                // Leave no half-started session behind: a token in storage
                // with the console still on screen is the worst of both.
                clearStoredAuth();
                setImpersonating(null); setSuperadminView(true);
                setPlatformErr(e?.status === 403
                  ? "You do not have permission to sign in as an account."
                  : e?.body?.error === "no_admin_on_account"
                    ? "That account has nobody on it to sign in as."
                    : (e?.message || "Could not start that session."));
              }
              return;
            }
            // Development picker only — no server, so nothing is audited.
            const mem = memberships.find((m) => m.accountId === acct.id && m.role === "admin");
            if (!mem) return;
            setImpersonating({ by: me.name, account: acct });
            logEvent("impersonation", `${me.name} signed in as this account`, { accountId: acct.id, userId: null });
            setCurrentAccountId(acct.id); setCurrentUserId(mem.userId);
            setTab("dashboard"); setSuperadminView(false);
          }}
          onSignOut={() => { setStaff(null); setSuperadminView(false); setLoggedIn(false);
            setPublicView("superadmin"); if (supabaseEnabled) supabase.auth.signOut(); }} />
      </div>
    );
  }

  return (
    <div className="ss-root">
      <style>{CSS}</style>
      {impersonating && (
        <div className="imp-banner">
          <Shield size={14} />
          <span>Viewing <b>{impersonating.account.name}</b> as superadmin ({impersonating.by}). Actions are recorded.</span>
          <button onClick={async () => {
            // Hand the seat back rather than just walking away from it: the
            // session would expire on its own, but a revoked one cannot be
            // used by anything that still has the token.
            if (impersonating.token) await api.platform.endImpersonation(impersonating.token);
            clearStoredAuth();
            // Return to whoever the server said this staff user is. There is no
            // seeded staff list to fall back to any more.
            setImpersonating(null); setSuperadminView(true); setLoggedIn(false);
            if (staff?.userId) setCurrentUserId(staff.userId);
          }}>Back to console</button>
        </div>
      )}
      <header className="ss-header">
        <div className="header-top">
          {/* The logo and the company name are what people reach for to get
              back to where they started -- every other site on the web has
              taught them that -- so they are one button, and it goes home.
              The heading stays a heading: a button is phrasing content and
              may live inside an h1, whereas an h1 inside a button has its
              heading role stripped, which would leave this screen with none. */}
          <h1 className="brand">
            <button className="brand-home" onClick={goHome} title={homeTitle}>
              <span className="brand-logo"><BrandMark brand={brand} height={26} /></span>
              <span className="brand-txt">
                <span className="brand-name">{brand.name}</span>
                <span className="brand-url">{portalUrl(brand)}</span>
              </span>
            </button>
          </h1>
          <div className="header-right">
            {/* What this seat can start, which is not the same for all of
                them. A scoped property manager runs the work at their
                buildings but does not change the account's roster or its
                property list, and a building owner can only ask -- so the
                list is built rather than written out and then hidden, and
                when it comes to one thing it is a button rather than a menu
                with a single item in it. */}
            {(() => {
              if (role === "contractor" || role === "tenant") return null;
              const actions = [];
              if (role === "owner") {
                actions.push(["work", "Request work", "Request work", Plus, () => tryAddJob()]);
              } else {
                if (runsTheAccount(role, membership)) {
                  actions.push(["contractor", "Contractor", "New contractor", Hammer, tryAddContractor]);
                  actions.push(["invite", "Invite link", "Invite link", Link2, () => setInviteOpen(true)]);
                  // A general contractor works job to job and has no building
                  // list to add to.
                  if (can("properties")) actions.push(["property", "Property", "New property", Building2, tryAddProperty]);
                }
                actions.push(["job", "Job", "New job", Calendar, () => tryAddJob()]);
              }
              if (actions.length === 1) {
                // On its own there is no "Add" above it to lean on, so it
                // says what it does rather than naming a noun.
                const [, , solo, Icon, go] = actions[0];
                return <button className="add-btn" onClick={go}><Icon size={16} /> {solo}</button>;
              }
              return (
                <div className="add-wrap">
                  <button className="add-btn" onClick={() => setAddMenu((v) => !v)}><Plus size={16} /> Add</button>
                  {addMenu && (
                    <>
                      <div className="add-scrim" onClick={() => setAddMenu(false)} />
                      <div className="add-menu">
                        {actions.map(([id, label, , Icon, go]) => (
                          <button key={id} onClick={() => { setAddMenu(false); go(); }}>
                            <Icon size={14} /> {label}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            <button className="nav-burger" aria-expanded={mobileNav} aria-label="Menu"
              onClick={() => setMobileNav((v) => !v)}><span /></button>
            <div className="user-wrap">
              <button className="user-btn" onClick={() => setUserMenu((v) => !v)}>
                <span className="user-avatar">{me.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                <span className="user-meta">
                  <span className="user-name">{me.name}</span>
                  <span className="user-role">{roleLabel}</span>
                </span>
                <ChevronDown size={13} />
              </button>
              {userMenu && (
                <>
                  <div className="add-scrim" onClick={() => setUserMenu(false)} />
                  <div className="add-menu user-menu">
                    <button className="um-account" onClick={() => { setUserMenu(false); setTab("account"); }}>
                      <UserCog size={14} /> My account
                    </button>
                    {myMemberships.length > 1 && (
                      <>
                        <div className="um-sec">Switch account</div>
                        {myMemberships.map((m) => {
                          const a = accounts.find((x) => x.id === m.accountId);
                          if (!a) return null;
                          return (
                            <button key={m.accountId} className="um-acct"
                              onClick={() => {
                                setAuth({ userId: currentUserId, accountId: m.accountId });
                                setCurrentAccountId(m.accountId);
                                setUserMenu(false); setSelected(null); setPane("jobs");
                                setTab(ROLES[m.role].can[0]);
                                hydrateAccount(m.accountId, currentUserId);
                              }}>
                              <span className="ua-name">{a.name}</span>
                              <span className="ua-role">{ROLES[m.role].label}</span>
                              {m.accountId === account.id && <Check size={13} className="ua-tick" />}
                            </button>
                          );
                        })}
                      </>
                    )}
                    {/* Instantly becoming someone else with no password was
                        always a demo-only convenience — makes no sense once
                        real auth is wired, so it's gone the moment it is. */}
                    {!supabaseEnabled && (
                      <>
                        <div className="user-menu-label">Switch user</div>
                        {users.map((u) => {
                          // Role lives on the membership, not the (now global)
                          // user record — a user with no membership in this
                          // account at all shouldn't appear in this list.
                          const um = memberships.find((m) => m.userId === u.id && m.accountId === account.id);
                          if (!um) return null;
                          return (
                            <button key={u.id} className={u.id === currentUserId ? "on" : ""}
                              onClick={() => {
                                setCurrentUserId(u.id);
                                setUserMenu(false);
                                setTab(ROLES[um.role].can[0]);
                              }}>
                              <span className="um-name">{u.name}</span>
                              <span className="um-role">{ROLES[um.role].label}</span>
                            </button>
                          );
                        })}
                      </>
                    )}
                    <button className="um-signout" onClick={() => { setUserMenu(false); clearAuth(); setLoggedIn(false); }}>
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
        <nav className={`tabs ${mobileNav ? "open" : ""}`} onClick={(e) => { if (e.target.closest("button")) setMobileNav(false); }}>
          <div className="drawer-user">
            <span className="user-avatar">{me.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
            {/* The company name is the page heading and the footer already;
                here it only cost the role the room to be read. */}
            <span className="drawer-user-txt"><b>{me.name}</b><span>{roleLabel}</span></span>
          </div>
          {can("dashboard") && (
            <button className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>
              Dashboard
            </button>
          )}
          {can("contractors") && (
            <button className={tab === "network" ? "on" : ""} onClick={() => setTab("network")}>
              Contractors <span className="count">{subs.length}</span>
            </button>
          )}
          {can("calendar") && (
            <button className={tab === "calendar" ? "on" : ""} onClick={() => setTab("calendar")}>
              Availability
            </button>
          )}
          {can("jobs") && (
            <button className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")}>
              Jobs <span className="count">{jobs.length}</span>
            </button>
          )}
          {can("properties") && accountProperties.length >= 0 && (
            <button className={tab === "properties" ? "on" : ""} onClick={() => setTab("properties")}>
              Properties{accountProperties.length > 0 && <span className="count">{accountProperties.length}</span>}
            </button>
          )}
          {can("uniforms") && (
            <button className={tab === "uniforms" ? "on" : ""} onClick={() => setTab("uniforms")}>
              Uniforms{uniformOrders.filter((o) => o.status === "pending").length > 0 &&
                <span className="count amber">{uniformOrders.filter((o) => o.status === "pending").length}</span>}
            </button>
          )}
          {can("portal") && [
            ["jobs", "My Jobs"], ["settings", "Job Settings"],
            ["crews", "My Crews"], ["docs", "My Documents"], ["uniforms", "Uniforms"],
          ].map(([id, label]) => (
            <button key={id} className={tab === "portal" && pane === id ? "on" : ""}
              onClick={() => { setPane(id); setTab("portal"); }}>
              {label}
              {id === "jobs" && pendingCount > 0 && <span className="count amber">{pendingCount}</span>}
              {id === "docs" && mySub && !docsComplete(mySub) && (
                <span className="count red">{missingDocs(mySub).length}</span>
              )}
            </button>
          ))}
          <div className="drawer-actions">
            <button onClick={() => setTab("account")}><UserCog size={15} /> My account</button>
            {myMemberships.length > 1 && myMemberships.filter((m) => m.accountId !== account.id).map((m) => {
              const a = accounts.find((x) => x.id === m.accountId);
              return a ? (
                <button key={m.accountId} onClick={() => { setCurrentAccountId(m.accountId); setSelected(null); setPane("jobs"); }}>
                  <ArrowUpDown size={15} /> Switch to {a.name}
                </button>
              ) : null;
            })}
            <button className="drawer-out" onClick={() => setLoggedIn(false)}><LogOut size={15} /> Sign out</button>
          </div>
        </nav>
      </header>

      {tab === "dashboard" && can("dashboard") && (
        <AdminDashboard subs={subs} jobs={jobs} role={role} me={me} now={now}
          accountId={account.id} trades={account.trades} subLimit={PLANS[plan].limit}
          onGoAccount={() => setTab("account")}
          onInvite={() => setInviteOpen(true)}
          onAddSub={() => tryAddContractor()}
          onGoJobs={() => setTab("jobs")} onGoContractors={() => setTab("network")}
          onNewJob={() => tryAddJob()}
          properties={can("properties") ? accountProperties : null}
          onGoProperties={() => setTab("properties")} onAddProperty={tryAddProperty}
          onAssign={(job, trade, replacing) => setAssigning({ job, trade, replacing })}
          onRequestDocs={requestDocs} onOpenSub={(sb) => setSelected(sb)}
          onReviewDoc={(sb, kind) => setReviewing({ sub: sb, kind })}
          onVerifyLicense={(sb) => verifyLicense(sb.id)}
          onApproveJob={approveJob} users={accountUsers}
          runsAccount={runsTheAccount(role, membership)} />
      )}

      {tab === "network" && can("contractors") && (
        <main className="ss-main">
          <div className="searchbar">
            <div className="search-input">
              <Search size={18} />
              <input placeholder="Search name, contact, capability, notes, or rating (e.g. 4.5)…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && <button className="clear-x" onClick={() => setQuery("")}><X size={15} /></button>}
            </div>
          </div>

          <div className="filter-bar">
            <button className="filter-toggle" onClick={() => setFiltersOpen((v) => !v)}>
              <Filter size={14} /> Filters
              {activeCount > 0 && <span className="ft-count">{activeCount}</span>}
              <ChevronDown size={14} className={`ft-chev ${filtersOpen ? "open" : ""}`} />
            </button>
            <label className="sort-ctl">
              <ArrowUpDown size={13} />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {SORTS.filter((o) => o.id !== "distance" || jobZip).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            {activeCount > 0 && <button className="clear-filters" onClick={clearFilters}>Clear all</button>}
          </div>

          {filtersOpen && (
          <div className="filters">
            <MultiSelect label="Category" icon={Filter} options={CATEGORIES} selected={fCats}
              onChange={(v) => { setFCats(v); setFCaps([]); }} />
            <MultiSelect label="Capability" options={capOptions} selected={fCaps} onChange={setFCaps} />
            <MultiSelect label="Service area" options={AREAS} selected={fAreas} onChange={setFAreas} />
            <div className="ms">
              <label><Target size={13} /> Job-site ZIP</label>
              <div className="zip-filter">
                <input placeholder="98101" value={jobZip}
                  onChange={(e) => setJobZip(e.target.value.trim())} />
                {jobZip && <button className="zip-x" onClick={() => { setJobZip(""); setInRangeOnly(false); }}><X size={13} /></button>}
              </div>
            </div>
            {jobZip && (
              <label className="ready-toggle">
                <input type="checkbox" checked={inRangeOnly} onChange={(e) => setInRangeOnly(e.target.checked)} />
                In-range only
              </label>
            )}
            <MultiSelect label="Min rating" icon={Star} options={RATING_TIERS} selected={fRatings}
              onChange={setFRatings} renderOpt={(r) => `${r.toFixed(1)}+`} />
            <MultiSelect label="Crew size" icon={Users} options={CREW_TIERS} selected={fCrew} onChange={setFCrew} />
            <MultiSelect label="Earnings" icon={Target} options={EARN_TIERS} selected={fEarn} onChange={setFEarn} />
            <MultiSelect label="Jobs completed" icon={CheckCircle2} options={DONE_TIERS} selected={fDone} onChange={setFDone} />
            <MultiSelect label="Availability" icon={Clock}
              options={[{ id: "available", label: "Available" }, { id: "unavailable", label: "Not available" }]}
              selected={fAvail} onChange={setFAvail} />
            <label className="ready-toggle">
              <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} />
              <Shield size={13} /> Docs complete
            </label>
            <label className="ready-toggle">
              <input type="checkbox" checked={autoOnly} onChange={(e) => setAutoOnly(e.target.checked)} />
              <Zap size={13} /> Auto-schedule
            </label>
          </div>
          )}

          {jobZip && <div className="zip-note"><Target size={12} /> Ranking contractors by distance from {jobZip}</div>}

          <div className="result-meta">{filtered.length} {filtered.length === 1 ? "contractor" : "contractors"} match</div>

          {filtered.length === 0 ? (
            <div className="empty"><Search size={28} /><p>No contractors match these filters.</p>
              <button onClick={clearFilters}>Reset filters</button></div>
          ) : (
            <div className="grid">
              {filtered.map((s) => {
                const ready = s.bond && s.insurance && s.contract;
                return (
                  <div key={s.id} className="card" onClick={() => setSelected(s)}>
                    <div className="card-top">
                      <div className="cat-row">
                        {s.categories.map((c) => {
                          const M = catMeta(c);
                          return <span key={c} className={`cat-badge cat-${c}`}><M.icon size={12} /> {M.label}</span>;
                        })}
                      </div>
                      <span className={`avail-dot ${s.available ? "up" : "down"}`} title={s.available ? "Available" : "Not available"} />
                    </div>
                    <div className="name-row">
                      <h3>{s.company}</h3>
                      {s.rating > 0 && <Stars value={s.rating} />}
                    </div>
                    <p className="contact">{s.contact} · <Users size={11} /> {crewCount(s)} {crewCount(s) === 1 ? "crew" : "crews"} · {headCount(s)} ppl</p>
                    <div className="caps">
                      {s.caps.slice(0, 3).map((c) => <span key={c} className="cap">{c}</span>)}
                      {s.caps.length > 3 && <span className="cap more">+{s.caps.length - 3}</span>}
                    </div>
                    <div className="areas"><MapPin size={12} /> {coverageLabel(s.coverage)}</div>
                    {jobZip && s._prox && (
                      <div className={`prox-badge ${s._prox.inRange ? "in" : "out"}`}>
                        <Target size={12} />
                        {s._prox.distance != null
                          ? `${s._prox.distance} mi · ${s._prox.inRange ? "in range" : "out of range"}`
                          : "distance unknown"}
                      </div>
                    )}
                    {s.autoSchedule && <div className="auto-badge card"><Zap size={11} /> Auto-schedule enabled</div>}
                    {(() => { const st = contractorStats(s, jobs); return (
                      <div className="stat-strip">
                        <span className="stat ok"><CheckCircle2 size={12} /> {st.completed} done</span>
                        <span className="stat earn">{st.earned ? formatMoney(st.earned) : "$0"}</span>
                        <span className="stat rate">{acceptRate(s)}% accept</span>
                      </div>
                    ); })()}
                    <div className="card-docs">
                      <DocPill ok={s.bond} label="Bond" />
                      <DocPill ok={s.insurance} label="Insurance" />
                      <DocPill ok={s.contract} label="Contract" />
                    </div>
                    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="mini primary" onClick={() => setAssignSub({ sub: s })}><Calendar size={13} /> Assign</button>
                    </div>
                    {!ready && (
                      <div className="req-docs-bar" onClick={(e) => e.stopPropagation()}>
                        <span className="rd-text"><AlertTriangle size={12} /> {complianceGaps(s).length} compliance gap{complianceGaps(s).length > 1 ? "s" : ""}</span>
                        <button className="rd-btn" onClick={() => requestDocs(s)}><Mail size={12} /> Request docs</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {tab === "properties" && can("properties") && (
        <PropertiesView properties={accountProperties} subs={subs} jobs={jobs}
          onScopeVendor={(sub, propertyId, on) => patchSub(sub.id, {
            propertyIds: on
              ? [...new Set([...(sub.propertyIds || []), propertyId])]
              : (sub.propertyIds || []).filter((x) => x !== propertyId),
          })}
          onAdd={addProperty} onPatch={patchProperty} onRemove={removeProperty}
          onOpenSub={(s) => { setSelected(s); setTab("contractors"); }}
          onNewJob={(p) => tryAddJob(null, p)} newAt={newPropertyAt}
          canManage={runsTheAccount(role, membership)} asOwner={role === "owner"} />
      )}

      {tab === "calendar" && can("calendar") && (
        <AvailabilityView subs={subs} jobs={jobs} allJobs={allJobs} accountId={account.id}
          onSchedule={(sub, date) => {
            if (!(sub.bond && sub.insurance && sub.contract)) return;
            setAssignSub({ sub, date });
          }}
          onRequestDocs={requestDocs} />
      )}

      {tab === "jobs" && can("jobs") && (
        <main className="ss-main">
          {jobs.length === 0 ? (
            <div className="empty"><ClipboardList size={28} /><p>No jobs yet.</p>
              <button onClick={() => tryAddJob()}>Create a job</button></div>
          ) : (
            <div className="jobs-list">
              <div className="jobs-head">
                <div className="seg-tabs sm">
                  {[["active", "Active"], ["completed", "Completed"], ["all", "All"]].map(([id, l]) => {
                    const n = id === "all" ? jobs.length : jobs.filter((x) => (x.status === "completed") === (id === "completed")).length;
                    return (
                      <button key={id} className={jobPhase === id ? "on" : ""} onClick={() => setJobPhase(id)}>
                        {l} <span className="seg-n">{n}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="add-btn small" onClick={() => tryAddJob()}><Plus size={14} /> New job</button>
              </div>
              {jobs.filter((j) => jobPhase === "all" || (j.status === "completed") === (jobPhase === "completed")).length === 0 && (
                <div className="dash-empty"><ClipboardList size={24} />
                  <p>No {jobPhase === "all" ? "" : jobPhase} jobs.</p></div>
              )}
              {jobs.filter((j) => jobPhase === "all" || (j.status === "completed") === (jobPhase === "completed")).map((j) => {
                const filled = j.trades.filter((t) => j.assignments[t]).length;
                const allAssigned = filled === j.trades.length;
                const done = j.status === "completed";
                return (
                  <div key={j.id} className={`job-card ${done ? "done" : ""}`}>
                    <div className="job-card-head">
                      <div>
                        <div className="job-title-row">
                          <h3>{j.title}</h3>
                          <span className={`job-phase ${done ? "done" : ""}`}>{done ? "completed" : "active"}</span>
                        </div>
                        <div className="job-meta">
                          <span><Calendar size={12} /> {formatWhen(j.date, j.time) || j.date || "No date"}</span>
                          <span><MapPin size={12} /> {[j.address, j.area, j.zip].filter(Boolean).join(", ") || "No address"}</span>
                          {j.sqft && <span><Ruler size={12} /> {Number(j.sqft).toLocaleString()} sq ft</span>}
                          {j.materialSource && <span><Layers size={12} /> {j.materialSource}</span>}
                        </div>
                      </div>
                      <span className={`fill-badge ${allAssigned ? "full" : ""}`}>{filled}/{j.trades.length} trades</span>
                    </div>
                    {j.scope && <p className="job-scope">{j.scope}</p>}
                    {(j.measurementDocs || []).length > 0 && (
                      <div className="job-meas">
                        {j.measurementDocs.map((d) => (
                          <span key={d} className="meas-chip"><FileText size={11} /> {d}</span>
                        ))}
                      </div>
                    )}

                    <div className="trade-rows">
                      {j.trades.map((t) => {
                        const M = catMeta(t);
                        const a = j.assignments[t];
                        const sub = a && subs.find((s) => s.id === a.subId);
                        return (
                          <div key={t} className={`trade-row ${a ? "filled" : "open"}`}>
                            <div className={`trade-icon cat-${t}`}><M.icon size={15} /></div>
                            <div className="trade-main">
                              <span className="trade-name">{M.label}</span>
                              {a ? (
                                <div className="trade-assigned">
                                  <span className="ta-company">{a.company}</span>
                                  {sub && sub.crews?.length > 1 ? (
                                    <select className="ta-crew" value={a.crewName || ""}
                                      onChange={(e) => setTradeCrew(j.id, t, e.target.value)}>
                                      {sub.crews.map((c) => {
                                        const ok = crewFreeOn(c, j.date);
                                        return <option key={c.id} value={c.name}>
                                          {c.name}{ok ? "" : " (off that day)"}
                                        </option>;
                                      })}
                                    </select>
                                  ) : a.crewName ? <span className="ta-crew-flat"><Users size={11} /> {a.crewName}</span> : null}
                                  {a.value && <span className="ta-val">{formatMoney(a.value)}
                                    <RevisedValue a={a} cos={changeOrders} jobId={j.id} trade={t} /></span>}
                                  <button className="ta-wo-link" onClick={() => setViewWO({ job: j, trade: t, a })}>
                                    <ScrollText size={11} /> {a.wo}
                                  </button>
                                  {a.signedWO && <span className="ta-signed"><CheckCircle2 size={11} /> signed</span>}
                                </div>
                              ) : <span className="trade-open-note">No contractor · no work order issued</span>}
                            </div>
                            {a ? (
                              <div className="trade-side">
                                {a.auto ? (
                                  <div className="trade-actions">
                                    <span className="job-final accepted"><Zap size={14} /> Auto-scheduled</span>
                                    {!done && <button className="trade-swap" onClick={() => unassignTrade(j.id, t)}>Replace</button>}
                                  </div>
                                ) : a.status === "pending" && isExpired(a, now) ? (
                                  <div className="trade-actions">
                                    <span className="job-status st-expired">
                                      <XCircle size={12} /> no reply — expired
                                    </span>
                                    <button className="trade-rematch"
                                      onClick={() => setAssigning({ job: j, trade: t, replacing: a.subId })}>
                                      <Zap size={12} /> Find alternatives
                                    </button>
                                    <button className="trade-swap" onClick={() => unassignTrade(j.id, t)}>Withdraw</button>
                                  </div>
                                ) : a.status === "pending" ? (
                                  <div className="trade-actions">
                                    <span className={`job-status st-pending ddl-chip u-${urgencyOf(msLeft(a, now))}`}>
                                      <Clock size={12} /> {countdown(msLeft(a, now))} to reply
                                    </span>
                                    <button className="trade-swap" onClick={() => unassignTrade(j.id, t)}>Withdraw</button>
                                  </div>
                                ) : (
                                  <div className="trade-actions">
                                    <span className={`job-final ${a.status}`}>
                                      {a.status === "accepted" ? <><CheckCircle2 size={14} /> Accepted</> : <><XCircle size={14} /> Declined</>}
                                    </span>
                                    {!done && <button className="trade-swap" onClick={() => unassignTrade(j.id, t)}>Replace</button>}
                                  </div>
                                )}
                                {canRate && done && a.status !== "declined" && (
                                  <StarRate value={a.rating} onRate={(n) => rateAssignment(j.id, t, n)}
                                    label={a.crewName ? `Rate ${a.crewName}` : "Rate crew"} />
                                )}
                                {(a.status === "accepted" || a.auto) && (
                                  <button className="trade-issue" onClick={() => setCoForm({ job: j, trade: t, a, origin: "gc" })}>
                                    <FilePlus2 size={12} /> Change order
                                  </button>
                                )}
                                {done && a.status !== "declined" && (() => {
                                  const sb = subs.find((x) => x.id === a.subId);
                                  const cov = coverageFor(sb, j, now);
                                  const open = serviceCalls.filter((c) =>
                                    c.jobId === j.id && c.trade === t && c.status !== "resolved");
                                  return (
                                    <div className="sc-cta">
                                      <button className="trade-issue" onClick={() => setRaising({ job: j, trade: t, a })}>
                                        <Wrench size={12} /> Report an issue
                                      </button>
                                      <span className={`cov-pill cov-${cov.kind}`}>{cov.label}</span>
                                      {open.length > 0 && (
                                        <span className="sc-open-pill">{open.length} open</span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : (
                              <button className="trade-assign" onClick={() => setAssigning({ job: j, trade: t })}>
                                <Plus size={13} /> Assign &amp; issue WO
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {changeOrders.filter((c) => c.jobId === j.id).length > 0 && (
                      <div className="sc-block">
                        <div className="form-sec">Change orders</div>
                        {changeOrders.filter((c) => c.jobId === j.id)
                          .sort((x, y) => x.trade.localeCompare(y.trade) || x.seq - y.seq)
                          .map((c) => (
                            <ChangeOrderRow key={c.id} c={c} now={now} side="gc"
                              onRespond={respondChangeOrder} onVoid={voidChangeOrder} />
                          ))}
                      </div>
                    )}
                    {serviceCalls.filter((c) => c.jobId === j.id).length > 0 && (
                      <div className="sc-block">
                        <div className="form-sec">Callbacks &amp; warranty claims</div>
                        {serviceCalls.filter((c) => c.jobId === j.id).map((c) => (
                          <ServiceCallRow key={c.id} c={c} job={j} onResolve={resolveServiceCall} />
                        ))}
                      </div>
                    )}

                    {canComplete && (
                      <div className="job-footer">
                        {!done ? (
                          <>
                            <span className="jf-note">
                              {allAssigned ? "All trades assigned — mark complete when the work is finished to rate crews."
                                : `${j.trades.length - filled} trade${j.trades.length - filled > 1 ? "s" : ""} still unassigned.`}
                            </span>
                            <button className="btn-solid jf-btn" onClick={() => completeJob(j.id)}>
                              <CheckCircle2 size={15} /> Mark job complete
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="jf-note done"><CheckCircle2 size={13} /> Completed {j.completedAt} — rate crews above</span>
                            <button className="btn-ghost jf-btn" onClick={() => reopenJob(j.id)}>Reopen</button>
                          </>
                        )}
                      </div>
                    )}

                    {done && canComplete && (
                      <div className="job-notes">
                        <label className="fld">Job notes <span className="fld-note">how it went, issues, callbacks</span>
                          <textarea rows={2} value={j.notes || ""}
                            onChange={(e) => setJobNotes(j.id, e.target.value)}
                            placeholder="Add notes about this completed job…" />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {tab === "account" && (
        <AccountView me={me} users={accountUsers} subs={subs} jobs={jobs} brand={brand} plan={plan} role={role}
          properties={accountProperties}
          seatCount={seatCount} atSeatLimit={atSeatLimit}
          jobsThisMonth={jobsThisMonth} canBrand={canBrand}
          billing={billing} onSetBilling={setBilling}
          accountKind={kindOf(account)} onSetAccountKind={setAccountKind}
          accountTrades={account.trades} onSetAccountTrades={setAccountTrades}
          subscriptionStatus={account.subscriptionStatus} currentPeriodEnd={account.currentPeriodEnd}
          comped={account.comped} cancelAtPeriodEnd={account.cancelAtPeriodEnd}
          canManage={can("account") && role === "admin"} mySub={mySub}
          onSaveUser={updateUser} onSaveBrand={setBrand}
          onUpgrade={startCheckout} onManageBilling={openBillingPortal}
          onCancelSubscription={() => changeSubscription("cancel")}
          onResumeSubscription={() => changeSubscription("resume")}
          cancelBusy={cancelBusy}
          billingBusy={billingBusy} billingErr={billingErr}
          onAddUser={addUser} onRemoveUser={removeUser} onEditUser={setEditUser}
          onLoginAs={(id) => {
            const m = memberships.find((x) => x.userId === id && x.accountId === account.id);
            setCurrentUserId(id); setPane("jobs");
            setTab(ROLES[(m && m.role) || "contractor"].can[0]);
          }}
          currentUserId={currentUserId}
          onPatchSub={patchSub} onRequestDocs={requestDocs}
          onSeatLimit={() => setUpgradePrompt({ kind: "user" })}
          hostnameStatus={account.hostnameStatus}
          // Re-reads the account and folds the answer back in, so the panel
          // can go green by itself while somebody is still on the page.
          onRefreshHostname={async () => {
            const fresh = await api.getAccount();
            setAccounts((prev) => prev.map((a) => a.id === fresh.id
              ? { ...a, hostnameStatus: fresh.hostnameStatus, hostnameCheckedAt: fresh.hostnameCheckedAt }
              : a));
            return fresh.hostnameStatus;
          }} />
      )}

      {tab === "uniforms" && can("uniforms") && (
        <UniformAdmin orders={uniformOrders} subs={subs}
          onDecide={(id, status) => {
            persist("decideUniformOrder", api.decideUniformOrder(id, status));
            setUniformOrders((os) => os.map((o) => o.id === id ? { ...o, status } : o));
          }} />
      )}

      {can("tenant") && tab !== "account" && (
        <TenantPortal me={me} brand={brand} jobs={jobs} properties={accountProperties}
          unit={membership.unit} accountKind={kindOf(account)}
          onReport={(r) => createJob({ ...r, trades: r.trades || [] })} />
      )}

      {can("portal") && tab !== "account" && (
        mySub ? (
          <ContractorPortal sub={mySub} jobs={jobs} pane={pane} mine={myAssignments} brand={brand} me={me} onGoDocs={() => setPane("docs")} onViewWO={setViewWO}
            serviceCalls={serviceCalls.filter((c) => c.subId === mySub.id && c.accountId === account.id)}
            onConfirmCall={confirmServiceCall}
            changeOrders={changeOrders.filter((c) => c.subId === mySub.id && c.accountId === account.id)}
            onRespondCO={respondChangeOrder} onVoidCO={voidChangeOrder}
            onRequestChange={(job, trade, a) => setCoForm({ job, trade, a, origin: "sub" })}
            orders={uniformOrders.filter((o) => o.subId === mySub.id)}
            onOrderUniform={(order) => {
              persist("createUniformOrder", api.createUniformOrder(order));
              setUniformOrders((os) => [{
                ...order, id: Date.now(), subId: mySub.id, company: mySub.company,
                status: "pending", createdAt: new Date().toISOString().slice(0, 10),
              }, ...os]);
            }}
            onSetAutoSchedule={(v) => patchSub(mySub.id, { autoSchedule: v })}
            onSetCrews={(crews) => patchSub(mySub.id, { crews })}
            onSetCoverage={(coverage) => patchSub(mySub.id, { coverage })}
            onToggleCrewDay={(crewId, day) => patchSub(mySub.id, {
              crews: (mySub.crews || []).map((c) => c.id !== crewId ? c : {
                ...c,
                unavailableDays: crewOffDays(c).includes(day)
                  ? crewOffDays(c).filter((d) => d !== day)
                  : [...crewOffDays(c), day],
              }),
            })}
            onToggleCrewAvailable={(crewId, v) => patchSub(mySub.id, {
              crews: (mySub.crews || []).map((c) => c.id !== crewId ? c : { ...c, available: v }),
            })}
            onSetWarranty={(w) => patchSub(mySub.id, { warranty: w })}
            onSetCategories={(cats) => patchSub(mySub.id, {
              categories: cats,
              caps: mySub.caps.filter((c) => cats.some((cat) => (CAP_LIBRARY[cat] || []).includes(c))),
            })}
            onSetCaps={(caps) => patchSub(mySub.id, { caps })}
            onUploadDoc={(k, fn) => uploadSubDoc(mySub.id, k, fn)}
            onDeleteDoc={(k) => deleteSubDoc(mySub.id, k)}
            onRespond={(jobId, trade, status) => respondTrade(jobId, trade, status)} now={now} />
        ) : (
          <main className="ss-main">
            <div className="empty"><AlertTriangle size={28} />
              <p>This contractor login isn't linked to a contractor record yet.</p></div>
          </main>
        )
      )}

      {selected && (
        <Modal onClose={() => setSelected(null)} wide>
          <SubDetail sub={selected} jobs={jobs} onSaveNotes={saveNotes} onRequestDocs={requestDocs}
            onEdit={() => { setEditing(selected); setSelected(null); }}
            onReviewDoc={(sb, kind) => { setSelected(null); setReviewing({ sub: sb, kind }); }}
            onVerifyLicense={(sb) => verifyLicense(sb.id)}
            onSchedule={() => { setAssignSub({ sub: selected }); setSelected(null); }} />
        </Modal>
      )}
      {jobForm && <Modal onClose={() => setJobForm(null)} wide>
        <JobForm allJobs={allJobs} accountId={account.id} properties={accountProperties} forProperty={jobForm.forProperty} forSub={jobForm.forSub} jobs={jobs} asOwner={role === "owner"}
          onSubmit={(job) => createJob(job, jobForm.forSub)}
          onCancel={() => setJobForm(null)} /></Modal>}
      {assigning && <Modal onClose={() => setAssigning(null)} wide>
        <PickContractor allJobs={allJobs} accountId={account.id} job={assigning.job} trade={assigning.trade}
          replacing={assigning.replacing} subs={subs} jobs={jobs}
          onPick={(sub, details) => assignContractor(assigning.job.id, assigning.trade, sub, details)}
          onNotify={(sub) => requestDocs(sub, assigning.job, assigning.trade)}
          onCancel={() => setAssigning(null)} /></Modal>}
      {assignSub && <Modal onClose={() => setAssignSub(null)} wide>
        <PickJobSlot allJobs={allJobs} accountId={account.id} sub={assignSub.sub} jobs={jobs}
          onPick={(job, trade) => assignContractor(job.id, trade, assignSub.sub)}
          onNewJob={() => { const s0 = assignSub.sub; setAssignSub(null); tryAddJob(s0); }}
          onNotify={(job, trade) => requestDocs(assignSub.sub, job, trade)}
          onRequestDocs={requestDocs}
          onCancel={() => setAssignSub(null)} /></Modal>}
      {viewWO && <Modal onClose={() => setViewWO(null)} wide>
        <WorkOrderDoc job={viewWO.job} trade={viewWO.trade} cos={cosFor(changeOrders, viewWO.job.id, viewWO.trade)}
          a={(jobs.find((j) => j.id === viewWO.job.id)?.assignments || {})[viewWO.trade] || viewWO.a}
          canUpload={role !== "contractor"} brand={brand}
          onUploadSigned={(file) => uploadSignedWO(viewWO.job.id, viewWO.trade, file)}
          onClose={() => setViewWO(null)} /></Modal>}
      {notifying && <Modal onClose={() => setNotifying(null)} wide>
        <NotifyForm data={notifying} brand={brand} onClose={() => setNotifying(null)} /></Modal>}
      {coForm && <Modal onClose={() => setCoForm(null)}>
        <ChangeOrderForm job={coForm.job} trade={coForm.trade} a={coForm.a} origin={coForm.origin}
          existing={cosFor(changeOrders, coForm.job.id, coForm.trade)}
          onSubmit={(data) => raiseChangeOrder(coForm.job, coForm.trade, coForm.a,
            { ...data, origin: coForm.origin, raisedBy: coForm.origin === "sub" ? (mySub?.contact || me.name) : me.name })}
          onCancel={() => setCoForm(null)} /></Modal>}
      {raising && <Modal onClose={() => setRaising(null)}>
        <ServiceCallForm job={raising.job} trade={raising.trade} a={raising.a}
          sub={subs.find((x) => x.id === raising.a.subId)} now={now}
          onSubmit={(data) => raiseServiceCall(raising.job, raising.trade, raising.a, data)}
          onCancel={() => setRaising(null)} /></Modal>}
      {reviewing && <Modal onClose={() => setReviewing(null)} wide>
        <DocReview sub={subs.find((x) => x.id === reviewing.sub.id) || reviewing.sub}
          kind={reviewing.kind} brand={brand}
          onVerify={(kind, data) => verifySubDoc(reviewing.sub.id, kind, data)}
          onReject={(kind, data) => rejectSubDoc(reviewing.sub.id, kind, data)}
          onClose={() => setReviewing(null)} /></Modal>}
      {upgradePrompt && <Modal onClose={() => setUpgradePrompt(null)}>
        <UpgradePrompt kind={upgradePrompt.kind} plan={plan} billing={billing} onSetBilling={setBilling}
          count={upgradePrompt.kind === "contractor" ? subs.length
            : upgradePrompt.kind === "job" ? jobsThisMonth : seatCount}
          // No optimistic switch and no queued follow-up action: the browser
          // is about to leave for Stripe, and whether they come back on Scale
          // is Stripe's answer to give, not ours to assume.
          busy={billingBusy} err={billingErr}
          onUpgrade={() => startCheckout(billing)}
          onDecline={() => setUpgradePrompt(null)} /></Modal>}
      {userForm && <Modal onClose={() => setUserForm(false)}>
        <UserForm subs={subs} properties={accountProperties} accountKind={kindOf(account)} onSubmit={addUser}
          onCancel={() => setUserForm(false)} /></Modal>}
      {editUser && <Modal onClose={() => setEditUser(null)}>
        <UserForm subs={subs} properties={accountProperties} accountKind={kindOf(account)}
          existing={editUser} isSelf={editUser.id === currentUserId}
          canChangeRole={can("users") && editUser.id !== currentUserId}
          onSubmit={updateUser} onCancel={() => setEditUser(null)} /></Modal>}
      {adding && <Modal onClose={() => setAdding(false)} wide>
        <SubForm properties={accountProperties} onSubmit={addSub} onCancel={() => setAdding(false)} /></Modal>}

      {inviteOpen && <Modal onClose={() => setInviteOpen(false)}>
        <InviteLinks canRevoke={role === "admin"} onClose={() => setInviteOpen(false)} /></Modal>}
      {editing && <Modal onClose={() => setEditing(null)} wide>
        <SubForm properties={accountProperties} existing={editing} onSubmit={updateSub} onCancel={() => setEditing(null)} /></Modal>}

      {checkoutSecret && (
        <CheckoutPanel clientSecret={checkoutSecret} onClose={() => setCheckoutSecret(null)} />
      )}

      {billingNote && (
        <div className="billing-note" role="status">
          {billingNote}
          <button onClick={() => setBillingNote("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <footer className="ss-footer">
        <span>{brand.name} · {portalUrl(brand)}</span>
        <PoweredBy className="ss-foot-by" height={13} />
      </footer>
    </div>
  );
}

// ---- Change order form (either side can raise one) ----------------------
function ChangeOrderForm({ job, trade, a, origin, existing, onSubmit, onCancel }) {
  const M = catMeta(trade);
  const [kind, setKind] = useState("add");
  const [scope, setScope] = useState("");
  const [value, setValue] = useState("");
  const [respWindow, setRespWindow] = useState(DEFAULT_WINDOW);
  const isGC = origin === "gc";
  const base = Number(moneyRaw(a.value) || 0);
  const accepted = existing.filter((c) => c.status === "accepted")
    .reduce((n, c) => n + c.valueDelta, 0);
  const current = base + accepted;
  const delta = kind === "nocost" ? 0
    : (kind === "deduct" ? -1 : 1) * Math.abs(Number(moneyRaw(value) || 0));
  const ok = scope.trim() && (kind === "nocost" || Number(moneyRaw(value) || 0) > 0);

  return (
    <div className="form">
      <h2>{isGC ? "Issue a change order" : "Request a change"}</h2>
      <p className="form-sub">{a.wo} · {M.label} · {job.title}</p>

      <div className="co-context">
        <div><span>Original</span><b>{formatMoney(base)}</b></div>
        {accepted !== 0 && (
          <div><span>{existing.filter((c) => c.status === "accepted").length} accepted change order{existing.filter((c) => c.status === "accepted").length === 1 ? "" : "s"}</span>
            <b>{accepted > 0 ? "+" : "−"}{formatMoney(Math.abs(accepted))}</b></div>
        )}
        <div className="co-cur"><span>Current value</span><b>{formatMoney(current)}</b></div>
      </div>

      <div className="form-sec">What's changing?</div>
      <div className="roles">
        {CO_KINDS.map((k) => (
          <label key={k.id} className={`role ${kind === k.id ? "on" : ""}`}>
            <input type="radio" name="cokind" checked={kind === k.id} onChange={() => setKind(k.id)} />
            <span>{k.label}<em>{k.hint}</em></span>
          </label>
        ))}
      </div>

      <label className="fld">Describe the change
        <span className="fld-note">this becomes {coSeq(existing.length + 1)} on the work order</span>
        <textarea rows={3} value={scope} onChange={(e) => setScope(e.target.value)}
          placeholder={kind === "add" ? "e.g. replace 6 sheets of rotten sheathing found on tear-off, north slope"
            : kind === "deduct" ? "e.g. skylight replacement removed from scope at homeowner's request"
            : "e.g. start moved from Mon 21st to Wed 23rd, homeowner travel"} />
      </label>

      {kind !== "nocost" && (
        <label className="fld">{kind === "add" ? "Added value" : "Deducted value"}
          <span className="fld-note">the change only, not the new total</span>
          <MoneyInput value={value} onChange={setValue} />
        </label>
      )}

      {isGC && (
        <label className="fld">Response deadline
          <span className="fld-note">{a.company} has this long to accept</span>
          <select value={respWindow} onChange={(e) => setRespWindow(e.target.value)}>
            {RESPONSE_WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
      )}

      <div className="co-preview">
        <span>Revised value if accepted</span>
        <b>{formatMoney(current + delta)}</b>
        {delta !== 0 && <em>{delta > 0 ? "+" : "−"}{formatMoney(Math.abs(delta))}</em>}
      </div>

      <p className="cov-hint">
        {isGC
          ? `${a.company} is notified by ${notifyLabel({ notify: a.notify || { email: true } }).toLowerCase()} and accepts or declines from their dashboard. The original work order is unchanged either way.`
          : "Your property manager reviews this and accepts or declines. Don't start the extra work until it's accepted."}
      </p>

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-solid" disabled={!ok}
          onClick={() => onSubmit({ kind, scope: scope.trim(), value, responseWindow: respWindow })}>
          <Send size={15} /> {isGC ? `Send ${coSeq(existing.length + 1)}` : "Send request"}
        </button>
      </div>
    </div>
  );
}

// ---- One change order as a row ------------------------------------------
function ChangeOrderRow({ c, now, side, onRespond, onVoid }) {
  // side: "gc" | "sub" — who is looking at it
  const expired = coExpired(c, now);
  const left = c.origin === "gc" && c.status === "pending" && c.respondBy
    ? new Date(c.respondBy).getTime() - now : null;
  const mine = c.origin === side;                 // I raised it
  const canRespond = c.status === "pending" && !mine && !expired;
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  return (
    <div className={`co-row co-${c.status} ${expired ? "co-expired" : ""}`}>
      <span className="co-seq">{coSeq(c.seq)}</span>
      <div className="co-main">
        <span className="co-scope">{c.scope}</span>
        <span className="co-meta">
          {CO_KINDS.find((k) => k.id === c.kind)?.label} · raised by {c.raisedBy}
          {c.origin === "sub" ? " (subcontractor)" : ""} · {c.raisedAt.slice(0, 10)}
          {c.status === "pending" && c.origin === "gc" && left !== null && !expired &&
            <> · <Clock size={11} /> {countdown(left)} to respond</>}
        </span>
        {c.note && <span className="co-note">“{c.note}”</span>}
      </div>
      <div className="co-side">
        <b className={`co-delta ${c.valueDelta > 0 ? "up" : c.valueDelta < 0 ? "down" : ""}`}>
          {c.valueDelta === 0 ? "No cost" : (c.valueDelta > 0 ? "+" : "−") + formatMoney(Math.abs(c.valueDelta))}
        </b>
        <span className={`co-status s-${expired ? "expired" : c.status}`}>
          {expired ? "Expired" : c.status === "pending"
            ? (mine ? `Awaiting ${side === "gc" ? "subcontractor" : "approval"}` : "Needs your response")
            : c.status === "accepted" ? "Accepted" : c.status === "declined" ? "Declined" : "Void"}
        </span>
        {canRespond && !declining && (
          <div className="trade-actions">
            <button className="resp accept" onClick={() => onRespond(c.id, "accepted")}><Check size={12} /> Accept</button>
            <button className="resp decline" onClick={() => setDeclining(true)}><X size={12} /> Decline</button>
          </div>
        )}
        {canRespond && declining && (
          <div className="sc-propose">
            <input placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="resp decline" onClick={() => { onRespond(c.id, "declined", note); setDeclining(false); }}>Confirm</button>
          </div>
        )}
        {mine && c.status === "pending" && onVoid && (
          <button className="trade-swap" onClick={() => onVoid(c.id)}>Withdraw</button>
        )}
      </div>
    </div>
  );
}

// ---- The revised total, shown under a work order that has change orders --
function RevisedValue({ a, cos, jobId, trade }) {
  const list = cosFor(cos, jobId, trade);
  const accepted = list.filter((c) => c.status === "accepted");
  const pending = list.filter((c) => c.status === "pending");
  if (!list.length) return null;
  const rev = revisedValue(a, cos, jobId, trade);
  return (
    <span className="co-revised">
      <b>{formatMoney(rev)}</b> revised
      {accepted.length > 0 && <> · {accepted.length} CO{accepted.length === 1 ? "" : "s"} accepted</>}
      {pending.length > 0 && <> · <em>{pending.length} pending</em></>}
    </span>
  );
}

// ---- Raise a callback or warranty claim ---------------------------------
function ServiceCallForm({ job, trade, a, sub, now, onSubmit, onCancel }) {
  const cov = coverageFor(sub, job, now);
  const [kind, setKind] = useState(cov.kind === "warranty" ? "warranty" : "callback");
  const [issue, setIssue] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const M = catMeta(trade);
  const blocked = cov.kind === "expired" || cov.kind === "none";

  return (
    <div className="form">
      <h2>Report an issue</h2>
      <p className="form-sub">{job.title} · {M.label} · {a.company}</p>

      <div className={`cov-banner cov-${cov.kind}`}>
        {cov.kind === "callback" ? <Wrench size={15} />
          : cov.kind === "warranty" ? <ShieldCheck size={15} />
          : <AlertTriangle size={15} />}
        <div>
          <strong>{cov.label}</strong>
          <span className="cov-sub">
            Completed {job.completedAt} · {warrantyLabel(sub)}
          </span>
        </div>
      </div>

      {blocked ? (
        <>
          <p className="cov-hint">
            This job is outside both the {CALLBACK_DAYS}-day callback window and
            {warrantyYears(sub) === null ? " they have no warranty on file" : " their stated warranty"}.
            You can still send them back, but it's chargeable work rather than a claim —
            create it as a new job instead.
          </p>
          <div className="form-actions">
            <button className="btn-ghost" onClick={onCancel}>Close</button>
          </div>
        </>
      ) : (
        <>
          <div className="form-sec">What kind of return is this?</div>
          <div className="roles two-up-roles">
            <label className={`role ${kind === "callback" ? "on" : ""}`}>
              <input type="radio" name="sckind" checked={kind === "callback"}
                onChange={() => setKind("callback")} />
              <span>Callback<em>Defect or snag from the original work</em></span>
            </label>
            <label className={`role ${kind === "warranty" ? "on" : ""} ${cov.kind !== "warranty" ? "dim" : ""}`}>
              <input type="radio" name="sckind" checked={kind === "warranty"}
                onChange={() => setKind("warranty")} />
              <span>Warranty claim<em>Failure covered by their labor warranty</em></span>
            </label>
          </div>

          <label className="fld">What's wrong?
            <textarea rows={3} value={issue} onChange={(e) => setIssue(e.target.value)}
              placeholder="e.g. two ridge caps lifted on the north slope, homeowner reports a drip in the upstairs hall" />
          </label>

          <label className="fld">Requested return date
            <span className="fld-note">they can confirm or propose another</span>
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </label>

          <div className="notify-note">
            <Bell size={13} />
            {a.company} is notified by {notifyLabel(sub).toLowerCase()} and has to confirm the
            visit from their own dashboard before it shows as scheduled.
          </div>

          <div className="form-actions">
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn-solid" disabled={!issue.trim()}
              onClick={() => onSubmit({ kind, issue: issue.trim(), returnDate })}>
              <Send size={15} /> Send to {a.company.split(" ")[0]}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- One service call, as a row ----------------------------------------
function ServiceCallRow({ c, job, showSubActions, onConfirm, onResolve, onReschedule }) {
  const [alt, setAlt] = useState("");
  const [proposing, setProposing] = useState(false);
  return (
    <div className={`sc-row sc-${c.status}`}>
      <span className={`sc-kind k-${c.kind}`}>
        {c.kind === "callback" ? <Wrench size={11} /> : <ShieldCheck size={11} />}
        {c.kind === "callback" ? "Callback" : "Warranty"}
      </span>
      <div className="sc-main">
        <span className="sc-job">{job ? job.title : "Job"} · {catMeta(c.trade).label}</span>
        <span className="sc-issue">{c.issue}</span>
        <span className="sc-meta">
          {c.company}{c.crewName ? ` · ${c.crewName}` : ""} · raised {c.raisedAt.slice(0, 10)} by {c.raisedBy}
          {c.returnDate ? ` · return ${formatDay(c.returnDate)}` : ""}
        </span>
        {c.subNote && <span className="sc-note">“{c.subNote}”</span>}
      </div>
      <div className="sc-side">
        <span className={`sc-status s-${c.status}`}>
          {c.status === "awaiting-confirmation" ? "Awaiting confirmation"
            : c.status === "scheduled" ? "Confirmed" : "Resolved"}
        </span>
        {showSubActions && c.status === "awaiting-confirmation" && !proposing && (
          <div className="trade-actions">
            <button className="resp accept" onClick={() => onConfirm(c.id)}>
              <Check size={12} /> Confirm {c.returnDate ? formatDay(c.returnDate) : "visit"}
            </button>
            <button className="resp decline" onClick={() => setProposing(true)}>Propose another date</button>
          </div>
        )}
        {showSubActions && proposing && (
          <div className="sc-propose">
            <input type="date" value={alt} onChange={(e) => setAlt(e.target.value)} />
            <button className="resp accept" disabled={!alt}
              onClick={() => { onConfirm(c.id, { returnDate: alt, subNote: "Proposed a different date" }); setProposing(false); }}>
              <Check size={12} /> Send
            </button>
          </div>
        )}
        {!showSubActions && c.status === "scheduled" && (
          <button className="trade-swap" onClick={() => onResolve(c.id)}>Mark resolved</button>
        )}
      </div>
    </div>
  );
}

// ---- Document review (admin / PM verifies each document) ----------------
function DocReview({ sub, kind, brand, onVerify, onReject, onClose }) {
  const r = docReview(sub, kind);
  const isIns = kind === "insurance";
  const checks = isIns ? [] : DOC_CHECKS[kind](brand.name);

  const [ticked, setTicked] = useState(() => {
    const init = {};
    (isIns ? INSURANCE_ATTEST : checks).forEach((c) => { init[c.id] = !!r?.checks?.[c.id]; });
    return init;
  });
  const [limits, setLimits] = useState(() => {
    const init = {};
    INSURANCE_LINES.forEach((l) => { init[l.id] = r?.limits?.[l.id] || ""; });
    return init;
  });
  const [amount, setAmount] = useState(r?.amount || "");
  // A reviewer can accept a limit that falls short, as long as they say why.
  const [overrides, setOverrides] = useState(() => ({ ...(r?.overrides || {}) }));
  const setOverride = (id, val) => setOverrides((o) => {
    const next = { ...o };
    if (val === null) delete next[id]; else next[id] = val;
    return next;
  });
  const [expires, setExpires] = useState(r?.expires || "");
  const [note, setNote] = useState(r?.status === "rejected" ? "" : (r?.note || ""));
  const [rejecting, setRejecting] = useState(false);

  const file = (sub.docFiles || {})[kind] || "document.pdf";
  const lineShort = (l) => {
    const v = Number(moneyRaw(limits[l.id]) || 0);
    return !!limits[l.id] && v < l.min;
  };
  const lineOk = (l) => {
    if (!limits[l.id]) return l.optional;      // optional lines may be blank
    if (!lineShort(l)) return true;
    return !!(overrides[l.id] && overrides[l.id].trim()); // accepted with a reason
  };
  const allLinesOk = INSURANCE_LINES.every(lineOk);
  const requiredLinesFilled = INSURANCE_LINES.filter((l) => !l.optional).every((l) => limits[l.id]);
  const attestOk = (isIns ? INSURANCE_ATTEST : checks).every((c) => ticked[c.id]);
  const bondAmt = Number(moneyRaw(amount) || 0);
  const bondShort = kind === "bond" && !!amount && bondAmt < BOND_MIN;
  const bondOk = kind !== "bond" || (!!amount && (!bondShort
    || !!(overrides.bond && overrides.bond.trim())));
  const canVerify = isIns
    ? attestOk && allLinesOk && requiredLinesFilled && expires
    : attestOk && bondOk;

  const openFile = () => {
    const lines = [
      DOC_LABELS[kind].toUpperCase(),
      `File: ${file}`,
      `Contractor: ${sub.company}`,
      "",
      "Placeholder preview — wired to object storage in production.",
      "",
      isIns ? "REQUIRED COVERAGE" : "REVIEWER CHECKS",
      ...(isIns
        ? INSURANCE_LINES.map((l) => `  ${l.label}${l.sub ? ` (${l.sub})` : ""}: ${formatMoney(l.min)}${l.optional ? " — if applicable" : ""}`)
            .concat(["", ...INSURANCE_ATTEST.map((a) => `  - ${a.label(brand.name)}`)])
        : checks.map((c) => `  - ${c.label}`)),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.download = file.replace(/\.\w+$/, "") + "-preview.txt";
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="form">
      <h2>Review {DOC_LABELS_INLINE[kind]}</h2>
      <p className="form-sub">{sub.company} · {sub.contact}</p>

      <div className="rv-file">
        <FileText size={20} />
        <div className="rv-file-main">
          <span className="rv-name">{file}</span>
          <span className="rv-meta">
            {r?.status === "verified" ? `Verified ${r.verifiedAt} by ${r.verifiedBy}`
              : r?.status === "rejected" ? `Rejected ${r.verifiedAt} by ${r.verifiedBy}`
              : "Uploaded by contractor · not yet reviewed"}
          </span>
        </div>
        <div className="rv-file-actions">
          <button className="btn-ghost rv-btn" onClick={openFile}><FileText size={13} /> Open</button>
          <button className="btn-ghost rv-btn" onClick={openFile}><Download size={13} /> Download</button>
        </div>
      </div>

      {r?.status === "rejected" && r.note && (
        <div className="doc-block"><AlertTriangle size={15} />
          <div><strong>Previously rejected.</strong> {r.note}</div></div>
      )}

      {isIns ? (
        <>
          <div className="form-sec">Coverage limits <span className="fld-note">WA subcontractor requirements</span></div>
          <div className="cov-table">
            {INSURANCE_LINES.map((l) => {
              const v = limits[l.id];
              const short = lineShort(l);
              const ok = lineOk(l);
              const ovr = overrides[l.id];
              return (
                <div key={l.id} className={`cov-line ${short ? (ovr ? "waived" : "short") : v ? "ok" : ""}`}>
                  <div className="cov-line-top">
                    <div className="cl-label">
                      <span className="cl-name">{l.label}{l.optional && <span className="cl-opt">if applicable</span>}</span>
                      <span className="cl-req">{l.sub ? `${l.sub} · ` : ""}min {formatMoney(l.min)}</span>
                    </div>
                    <div className="cl-input">
                      <MoneyInput value={v} onChange={(x) => setLimits((z) => ({ ...z, [l.id]: x }))} />
                      {v && (ok
                        ? <CheckCircle2 size={15} className={ovr ? "cl-waived" : "cl-ok"} />
                        : <AlertTriangle size={15} className="cl-bad" />)}
                    </div>
                  </div>
                  {short && (
                    <div className="cl-override">
                      <label className="cl-ovr-toggle">
                        <input type="checkbox" checked={ovr !== undefined}
                          onChange={(e) => setOverride(l.id, e.target.checked ? "" : null)} />
                        Accept {formatMoney(v)} anyway — below the {formatMoney(l.min)} requirement
                      </label>
                      {ovr !== undefined && (
                        <input className="cl-ovr-reason" value={ovr}
                          onChange={(e) => setOverride(l.id, e.target.value)}
                          placeholder="Why is this acceptable? (required)" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {INSURANCE_LINES.some((l) => !lineOk(l) && limits[l.id]) && (
            <p className="fld-err"><AlertTriangle size={12} /> Limits below requirement — either accept them with a reason above, or reject and ask for more.</p>
          )}
          {Object.keys(overrides).filter((k) => overrides[k]?.trim()).length > 0 && (
            <p className="ovr-summary">
              <Shield size={12} /> {Object.keys(overrides).filter((k) => overrides[k]?.trim()).length} limit
              {Object.keys(overrides).filter((k) => overrides[k]?.trim()).length === 1 ? "" : "s"} accepted below
              requirement — recorded against your name.
            </p>
          )}

          <div className="form-sec">Confirm on the certificate</div>
          <div className="rv-checks">
            {INSURANCE_ATTEST.map((c) => (
              <label key={c.id} className={`rv-check ${ticked[c.id] ? "on" : ""}`}>
                <input type="checkbox" checked={!!ticked[c.id]}
                  onChange={(e) => setTicked((t) => ({ ...t, [c.id]: e.target.checked }))} />
                <span>{c.label(brand.name)}</span>
              </label>
            ))}
          </div>
          <label className="fld" style={{ marginTop: 14 }}>Policy expires
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="form-sec">Confirm on the document</div>
          <div className="rv-checks">
            {checks.map((c) => (
              <label key={c.id} className={`rv-check ${ticked[c.id] ? "on" : ""}`}>
                <input type="checkbox" checked={!!ticked[c.id]}
                  onChange={(e) => setTicked((t) => ({ ...t, [c.id]: e.target.checked }))} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          {kind === "bond" && (
            <>
              <label className="fld" style={{ marginTop: 14 }}>Bond amount
                <span className="fld-note">min {formatMoney(BOND_MIN)}</span>
                <MoneyInput value={amount} onChange={setAmount} />
              </label>
              {bondShort && (
                <div className="cl-override standalone">
                  <label className="cl-ovr-toggle">
                    <input type="checkbox" checked={overrides.bond !== undefined}
                      onChange={(e) => setOverride("bond", e.target.checked ? "" : null)} />
                    Accept {formatMoney(amount)} anyway — below the {formatMoney(BOND_MIN)} requirement
                  </label>
                  {overrides.bond !== undefined && (
                    <input className="cl-ovr-reason" value={overrides.bond}
                      onChange={(e) => setOverride("bond", e.target.value)}
                      placeholder="Why is this acceptable? (required)" />
                  )}
                  {overrides.bond === undefined && (
                    <p className="fld-err" style={{ margin: "8px 0 0" }}>
                      <AlertTriangle size={12} /> Below the {formatMoney(BOND_MIN)} requirement.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <label className="fld">Reviewer note {rejecting && <span className="fld-note">required when rejecting</span>}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={rejecting ? "What needs fixing? This goes to the contractor." : "Optional — anything worth recording"} />
      </label>

      {!rejecting ? (
        <>
          {!canVerify && (
            <p className="cov-hint">
              {isIns
                ? "Enter every required limit, tick each confirmation, and set the expiry to verify."
                : "Tick each confirmation" + (kind === "bond" ? " and enter the bond amount" : "") + " to verify."}
            </p>
          )}
          <div className="form-actions">
            <button className="btn-warn" onClick={() => setRejecting(true)}><XCircle size={15} /> Reject</button>
            <button className="btn-solid" disabled={!canVerify}
              onClick={() => onVerify(kind, isIns
                ? { checks: ticked, limits, expires, note, overrides }
                : { checks: ticked, amount, note, overrides })}>
              <CheckCircle2 size={15} /> Verify document
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button className="btn-ghost" onClick={() => setRejecting(false)}>Back</button>
          <button className="btn-warn" disabled={!note.trim()}
            onClick={() => onReject(kind, { note: note.trim() })}>
            <XCircle size={15} /> Reject &amp; notify contractor
          </button>
        </div>
      )}
      <button className="rv-close" onClick={onClose}>Close without deciding</button>
    </div>
  );
}

// ---- Superadmin sign-in — SubSub's own, never the customer's white label ----
// In production this lives on its own hostname (admin.subsub.work). Here it's
// reached with #superadmin on the URL.
const STAFF_DOMAIN = import.meta.env.VITE_STAFF_EMAIL_DOMAIN || "";
const STAFF_ERRORS = {
  sso_required: "Staff sign-in goes through Google Workspace. Use the Google button.",
  wrong_domain: "That Google account is outside the SubSub Workspace.",
  forbidden: "That account is not a SubSub staff account.",
  auth_not_configured: "This console has no authentication configured.",
};

function SuperadminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  // A valid session is not staff membership. The server re-reads the
  // superadmins table, and refuses anything that did not come through Google
  // Workspace or is outside the staff domain.
  const finish = async () => {
    try {
      const me = await api.platform.me();
      setBusy(false);
      onLogin(me);
      return true;
    } catch (e2) {
      // Only drop a Supabase session we actually established. Under Access
      // there is none, and signing out of nothing would throw.
      if (supabaseEnabled) await supabase.auth.signOut().catch(() => {});
      setBusy(false);
      setErr(STAFF_ERRORS[e2?.body?.error] || STAFF_ERRORS[e2?.message]
        || "Could not verify staff access. Try again.");
      return false;
    }
  };

  const signInWithGoogle = async () => {
    if (!supabaseEnabled) {
      setErr("This build has no authentication configured, so nobody can sign in.");
      return;
    }
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        // A hint to Google's account chooser, not a control: the Workspace
        // domain is enforced by the API, which is where it cannot be skipped.
        ...(STAFF_DOMAIN ? { queryParams: { hd: STAFF_DOMAIN } } : {}),
      },
    });
    if (error) { setBusy(false); setErr("Could not start Google sign-in."); }
    // On success the browser leaves for Google and comes back to this origin,
    // where the effect below picks the session up.
  };

  // Ask the API who we are before drawing a sign-in screen, because under
  // Cloudflare Access we are already signed in: reaching this page at all
  // means Access let the request through and stamped it with an identity.
  // Only if that comes back unauthorized is there anything to ask for.
  //
  // It also covers coming back from Google in the Supabase flow, where the
  // session is in place by the time this runs.
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const me = await api.platform.me();
        if (live) onLogin(me);
        return;
      } catch (e2) {
        // 401 means nobody has identified us, which is the one case where a
        // sign-in screen is the right answer. 403 is a real refusal — known,
        // and not staff — and saying so beats offering a button that will
        // fail the same way.
        if (live && e2?.status && e2.status !== 401) {
          setErr(STAFF_ERRORS[e2?.body?.error] || "Could not verify staff access.");
        }
      }
      if (live) setChecking(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div className="sa-page">
        <div className="sa-card">
          <div className="sa-brand"><SubSubLogo height={26} /><span className="pf-tag">Platform</span></div>
          <p className="sa-lede">Checking your access…</p>
        </div>
      </div>
    );
  }

  // Break-glass only, and refused by the API unless STAFF_ALLOW_PASSWORD is set.
  const submit = async (e) => {
    e.preventDefault();
    if (!supabaseEnabled) {
      setErr("This build has no authentication configured, so nobody can sign in.");
      return;
    }
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setBusy(false); setErr("Wrong email or password."); return; }
    await finish();
  };

  // No Supabase and no Access identity either: there is nothing to offer, so
  // do not draw a form that cannot work. Without this, a console built with
  // neither would present a password box that signs nobody in.
  if (!supabaseEnabled) {
    return (
      <div className="sa-page">
        <div className="sa-card">
          <div className="sa-brand"><SubSubLogo height={26} /><span className="pf-tag">Platform</span></div>
          <h1>Not signed in</h1>
          <p className="sa-lede">
            {err || "This console expects Cloudflare Access in front of it. Reaching this "
              + "page without an identity means Access is not covering this hostname."}
          </p>
        </div>
        <p className="sa-foot">SubSub, LLC · internal use only</p>
      </div>
    );
  }
  return (
    <div className="sa-page">
      <div className="sa-card">
        <div className="sa-brand"><SubSubLogo height={26} /><span className="pf-tag">Platform</span></div>
        <h1>Sign in</h1>
        <p className="sa-lede">
          SubSub internal console{STAFF_DOMAIN ? ` — ${STAFF_DOMAIN} accounts only` : ""}.
        </p>

        <button className="sa-btn sa-google" type="button" onClick={signInWithGoogle} disabled={busy}>
          <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.1h12c-.2 1.9-1.5 4.7-4.4 6.6l6.7 5.2C42.2 35.5 45 30.3 45 24z"/>
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.4-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z"/>
            <path fill="#FBBC05" d="M11.6 28.4c-.5-1.3-.7-2.8-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.5 9.9l7.1-5.5z"/>
            <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.1 5.5C13.3 14.4 18.2 10.6 24 10.6z"/>
          </svg>
          {busy ? "Checking…" : "Continue with Google"}
        </button>
        {err && <p className="wl-err">{err}</p>}

        <button className="sa-alt" type="button" onClick={() => setPwOpen((v) => !v)}>
          {pwOpen ? "Hide password sign-in" : "Use a password instead"}
        </button>

        {pwOpen && (
        <form onSubmit={submit}>
          <p className="sa-note">
            Break-glass only. The API refuses a password unless it has been
            deliberately re-enabled.
          </p>
          <label className="wl-fld">Email
            <input type="email" autoComplete="username" value={email}
              onChange={(e) => { setEmail(e.target.value); setErr(""); }} placeholder="you@subsub.work" />
          </label>
          <label className="wl-fld">Password
            <input type="password" autoComplete="current-password" value={pw}
              onChange={(e) => { setPw(e.target.value); setErr(""); }} />
          </label>
          <button className="sa-btn" type="submit" disabled={busy}>
            <LogIn size={15} /> {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
        )}
      </div>
      <p className="sa-foot">SubSub, LLC · internal use only · every action is recorded</p>
    </div>
  );
}

// ---- Superadmin console (SubSub staff only) --------------------------------
// A separate surface, not a role inside the tenant app. Five screens:
// Accounts, Account detail, Companies, Revenue, Health.
const fmtC = (cents) => "$" + (Math.round(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
const monthKey = (iso) => (iso || "").slice(0, 7);

function SuperadminConsole({ me, admin, accounts, users, memberships, companies, engagements,
  jobs, subEvents, activity, smsDaily = [], err, onPatchAccount, onAddUser, onImpersonate, onSignOut,
  onCreateAccount, onCreateCompany, onEditCompany, onDeleteAccount, onDeleteCompany,
  onResetPassword, onSyncHostname, onCheckHostnameSetup, onMailLog, onSetupCheck }) {
  const [screen, setScreen] = useState("dashboard");
  const [openId, setOpenId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [actFilter, setActFilter] = useState("all");
  const [addUser, setAddUser] = useState(null);
  const [newAccount, setNewAccount] = useState(null);   // form data while open
  const [newCompany, setNewCompany] = useState(null);
  const [editCompanyId, setEditCompanyId] = useState(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState(null);
  const [expandedAccountId, setExpandedAccountId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind: "account"|"company", id, name }
  const [resetFor, setResetFor] = useState(null);        // { userId, name, email }
  const [resetLink, setResetLink] = useState(null);      // { email } once the API confirms it sent
  const [resetErr, setResetErr] = useState("");          // and why, when it did not
  const [sending, setSending] = useState(false);
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // ---- derived, per account ----
  const rows = accounts.map((a) => {
    const mems = memberships.filter((m) => m.accountId === a.id && m.role !== "contractor");
    const engs = engagements.filter((e) => e.accountId === a.id);
    const js = jobs.filter((j) => j.accountId === a.id);
    const jobsMo = js.filter((j) => monthKey(j.createdAt) === thisMonth).length;
    const gmv = js.reduce((n, j) => n + Object.values(j.assignments || {})
      .filter((x) => x.status === "accepted" || x.auto)
      .reduce((m, x) => m + Number(moneyRaw(x.value) || 0) * 100, 0), 0);
    const cur = PLANS[a.plan] || PLANS.basic;
    const atLimit = a.plan === "basic" && (engs.length >= cur.limit || jobsMo >= cur.jobsPerMonth);
    return { a, users: mems.length, subs: engs.length, jobsMo, gmv, mrr: mrrOf(a), atLimit,
      pendingDocs: engs.reduce((n, e) => n + DOC_KINDS.filter((k) =>
        e.docReview?.[k]?.status === "pending").length, 0) };
  });
  const live = rows.filter((r) => r.a.status !== "canceled");
  const mrr = live.reduce((n, r) => n + r.mrr, 0);
  const gmvTotal = rows.reduce((n, r) => n + r.gmv, 0);

  // ---- revenue movement by month, from the append-only event log ----
  const months = [...new Set(subEvents.map((e) => monthKey(e.at)))].sort();
  const movement = months.map((m) => {
    const ev = subEvents.filter((e) => monthKey(e.at) === m);
    const sum = (f) => ev.filter(f).reduce((n, e) => n + e.mrrDelta, 0);
    return {
      m,
      newMrr: sum((e) => e.kind === "upgraded" && e.fromPlan === "basic"),
      churn: sum((e) => e.kind === "canceled"),
      // A move back to Basic is logged as "downgraded", and counting only
      // "cycle" here dropped it from every total -- so the log's ending MRR
      // drifted above the real one and never came back.
      contraction: sum((e) => (e.kind === "cycle" && e.mrrDelta < 0) || e.kind === "downgraded"),
      expansion: sum((e) => e.kind === "cycle" && e.mrrDelta > 0),
      signups: ev.filter((e) => e.kind === "created").length,
      conversions: ev.filter((e) => e.kind === "upgraded").length,
    };
  });
  const running = movement.reduce((acc, r) => {
    const prev = acc.length ? acc[acc.length - 1].mrr : 0;
    return [...acc, { ...r, mrr: prev + r.newMrr + r.expansion + r.contraction + r.churn }];
  }, []);
  const conv = subEvents.filter((e) => e.kind === "created").length
    ? Math.round(subEvents.filter((e) => e.kind === "upgraded").length /
        subEvents.filter((e) => e.kind === "created").length * 100) : 0;
  const daysToConvert = (() => {
    const pairs = subEvents.filter((e) => e.kind === "upgraded").map((u) => {
      const c = subEvents.find((e) => e.accountId === u.accountId && e.kind === "created");
      return c ? daysSince(c.at, new Date(u.at).getTime()) : null;
    }).filter((x) => x !== null).sort((x, y) => x - y);
    return pairs.length ? pairs[Math.floor(pairs.length / 2)] : null;
  })();

  // ---- companies across the whole platform ----
  const compRows = companies.map((c) => {
    const engs = engagements.filter((e) => e.companyId === c.id);
    const accts = engs.map((e) => accounts.find((a) => a.id === e.accountId)).filter(Boolean);
    const lic = c.licenseCheck;
    return { c, accts, lic, licOk: !lic || String(lic.status).toLowerCase() === "active",
      dup: companies.filter((x) => x.license && x.license.toUpperCase().trim() === (c.license || "").toUpperCase().trim()).length > 1 };
  });

  // ---- health counters ----
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const health = {
    signups7d: accounts.filter((a) => (a.createdAt || "") >= weekAgo).length,
    atLimit: live.filter((r) => r.atLimit).length,
    docsStale: rows.reduce((n, r) => n + r.pendingDocs, 0),
    expired: jobs.reduce((n, j) => n + Object.values(j.assignments || {})
      .filter((a) => isExpired(a, now.getTime())).length, 0),
    licFail: compRows.filter((r) => !r.licOk).length,
    dups: compRows.filter((r) => r.dup).length,
    inactive14: live.filter((r) => daysSince(r.a.lastActive, now.getTime()) > 14).length,
  };

  // ---- one walk of the event log, and everything reads from it ----------
  //
  // MRR and the paying-account count are both cumulative: what they are on a
  // given day is every event up to that day, not a snapshot anyone stored.
  // Deriving them twice -- once for a tile, once for the chart -- is how a
  // dashboard ends up showing two numbers for the same thing, so this walks
  // the log once and hands out days.
  const today = now.toISOString().slice(0, 10);
  const dailySeries = useMemo(() => {
    const evs = [...subEvents].filter((e) => e.at).sort((x, y) => (x.at < y.at ? -1 : 1));
    if (!evs.length) return [];

    // Per-account paying state, not a running +1/-1: a comp moves an account
    // onto Scale without paying, and counting the plan change would report a
    // free account as revenue.
    const paying = {};
    const paidNow = () => Object.values(paying).filter(Boolean).length;

    const out = [];
    let mrr = 0, i = 0;
    const start = new Date(evs[0].at.slice(0, 10) + "T00:00:00Z");
    const end = new Date(today + "T00:00:00Z");
    for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
      const day = d.toISOString().slice(0, 10);
      let newAccounts = 0, conversions = 0, churned = 0;
      while (i < evs.length && evs[i].at.slice(0, 10) <= day) {
        const e = evs[i++];
        mrr += e.mrrDelta || 0;
        if (e.kind === "created") newAccounts++;
        if (e.kind === "upgraded" || e.kind === "reactivated") { paying[e.accountId] = true; conversions++; }
        else if (e.kind === "comped") paying[e.accountId] = false;
        else if (e.kind === "downgraded" || e.kind === "canceled") {
          if (paying[e.accountId]) churned++;
          paying[e.accountId] = false;
        }
      }
      out.push({ day, mrr, paid: paidNow(), newAccounts, conversions, churned });
    }
    return out;
  }, [subEvents, today]);

  const seriesAt = (day) => {
    // The last point on or before `day` -- the level carries forward on a
    // day nothing happened, which is most days.
    let found = null;
    for (const p of dailySeries) { if (p.day <= day) found = p; else break; }
    return found;
  };

  // GMV is per job, not per subscription event, so it is filtered rather
  // than accumulated. Same acceptance rule the per-account figure uses.
  const jobGmv = (j) => Object.values(j.assignments || {})
    .filter((x) => x.status === "accepted" || x.auto)
    .reduce((m, x) => m + Number(moneyRaw(x.value) || 0) * 100, 0);

  // Everything a period is judged on, for any window. Both sections of the
  // dashboard call this, which is what makes them comparable.
  const metricsFor = (from, to) => {
    const within = (iso) => { const d = (iso || "").slice(0, 10); return d && d >= from && d <= to; };
    const ev = subEvents.filter((e) => within(e.at));
    const sum = (f) => ev.filter(f).reduce((n, e) => n + e.mrrDelta, 0);

    const signups = accounts.filter((a) => within(a.createdAt)).length;
    const conversions = ev.filter((e) => e.kind === "upgraded").length;
    const canceled = ev.filter((e) => e.kind === "canceled").length;
    const downgraded = ev.filter((e) => e.kind === "downgraded").length;

    const newMrr = sum((e) => e.kind === "upgraded" && e.fromPlan === "basic");
    const expansion = sum((e) => e.kind === "cycle" && e.mrrDelta > 0);
    const contraction = sum((e) => (e.kind === "cycle" && e.mrrDelta < 0) || e.kind === "downgraded");
    const churnMrr = sum((e) => e.kind === "canceled");

    // The denominator is who was paying when the window opened. Dividing by
    // today's count instead flatters every month in which anyone joined.
    const dayBefore = new Date(new Date(from + "T00:00:00Z").getTime() - 86400000)
      .toISOString().slice(0, 10);
    const paidAtStart = seriesAt(dayBefore)?.paid || 0;
    const lost = canceled + downgraded;

    const sms = smsDaily.filter((r) => within(r.day)).reduce((acc, r) => ({
      sent: acc.sent + (r.sent || 0), segments: acc.segments + (r.segments || 0),
      cost: acc.cost + (r.cost || 0), billed: acc.billed + (r.billed || 0),
    }), { sent: 0, segments: 0, cost: 0, billed: 0 });

    return {
      from, to, signups, conversions, canceled, downgraded, lost, paidAtStart,
      newMrr, expansion, contraction, churnMrr,
      netMrr: newMrr + expansion + contraction + churnMrr,
      gmv: jobs.filter((j) => within(j.createdAt)).reduce((n, j) => n + jobGmv(j), 0),
      // Conversions over signups in the same window. Not a cohort rate --
      // somebody who signed up in March can convert in April -- so it is
      // labelled by what it is rather than presented as one.
      convRate: signups ? conversions / signups : null,
      churnRate: paidAtStart ? lost / paidAtStart : null,
      sms,
    };
  };

  // ---- this month, kept apart from all time ------------------------------
  // The dashboard answers two questions -- "what moved this month" and "how
  // big is the platform" -- and they were sharing one row of tiles. Numbers
  // that mean different things do not belong in the same group.
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const monthStart = thisMonth + "-01";
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  const thisMonthM = metricsFor(monthStart, today);
  const moNow = running.find((r) => r.m === thisMonth)
    || { signups: 0, conversions: 0, newMrr: 0, expansion: 0, contraction: 0, churn: 0 };
  const lostMrr = moNow.contraction + moNow.churn;            // already negative
  const netNewMrr = moNow.newMrr + moNow.expansion + lostMrr;
  const jobsMoTotal = rows.reduce((n, r) => n + r.jobsMo, 0);
  const attention = health.atLimit + health.licFail + health.dups + health.expired;

  // ---- the window the second half of the dashboard is scoped to ---------
  const [range, setRange] = useState(() => defaultRange());
  const rangeM = metricsFor(range.from, range.to);
  // What the append-only log says MRR should be, versus what the accounts
  // actually bill. They agree unless a plan was changed outside the webhook.
  const loggedMrr = running.length ? running[running.length - 1].mrr : 0;

  // ---- ranked lists ------------------------------------------------------
  // Six rows, one hue, sorted. Past six it stops being a picture and wants to
  // be a table, so the tail is counted rather than drawn.
  const rank = (counts, n = 6) => {
    const all = Object.entries(counts).filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return { rows: all.slice(0, n), max: all.length ? all[0][1] : 0, total: all.length };
  };
  const topLocations = rank(companies.reduce((m, c) => {
    const k = [c.city, c.state].filter(Boolean).join(", ").trim();
    if (k) m[k] = (m[k] || 0) + 1;
    return m;
  }, {}));
  // Demand, not supply: what the hiring accounts say they put out to bid.
  // It is the only trade signal that exists before anyone engages a sub.
  const topTrades = rank(accounts.reduce((m, a) => {
    (a.trades || []).forEach((t) => { m[t] = (m[t] || 0) + 1; });
    return m;
  }, {}));

  const open = rows.find((r) => r.a.id === openId);

  const isSuper = admin.role === "superadmin";
  const NAV = [
    ["dashboard", "Dashboard", LayoutGrid],
    ["accounts", "Accounts", Building2],
    ["companies", "Companies", Users],
    ...(admin.finance ? [["revenue", "Revenue", TrendingUp]] : []),
    ...(isSuper ? [["health", "Health", Activity]] : []),
  ];
  const [navOpen, setNavOpen] = useState(false);
  const go = (id) => { setScreen(id); setOpenId(null); setNavOpen(false); setMenu(false); };

  return (
    <div className="pf-root">
      {confirmDelete && (
        <DeleteConfirmModal item={confirmDelete}
          // The typed name travels to the server, which checks it against the
          // row it is about to delete. A browser-side comparison alone would
          // stop a slip of the finger but not a stale id.
          onConfirm={async (confirmName) => {
            const go = confirmDelete.kind === "account" ? onDeleteAccount : onDeleteCompany;
            await go(confirmDelete.id, confirmName);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)} />
      )}
      <header className="pf-top">
        {/* Same rule as the customer header: the mark goes back to the top
            of the console. Staff live on the accounts list and end up deep in
            a drawer; this is the way out they already expect. */}
        <button className="pf-brand" onClick={() => go("dashboard")} title="Back to the dashboard">
          <SubSubLogo height={20} /><span className="pf-tag">Platform</span>
        </button>
        <button className="pf-burger" aria-expanded={navOpen} aria-label="Menu"
          onClick={() => setNavOpen((o) => !o)}><span /></button>
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
        <nav className={`pf-nav ${navOpen ? "open" : ""}`}>
          <div className="pf-drawer-user">
            <span className="user-avatar pf-avatar">{me.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
            <span className="pf-drawer-txt"><b>{me.name}</b><span>{STAFF_ROLE_LABEL[admin.role] || "Standard"} · {me.email}</span></span>
          </div>
          {NAV.map(([id, label, Icon]) => (
            <button key={id} className={screen === id && !openId ? "on" : ""} onClick={() => go(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
          <div className="pf-drawer-actions">
            {admin.impersonate && <button onClick={() => go("accounts")}><LogIn size={14} /> Sign in as an account…</button>}
            <button className="pf-drawer-out" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
          </div>
        </nav>
        <div className="pf-me">
          <button className="pf-user" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <span className="user-avatar pf-avatar">{me.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
            <span className="pf-user-txt"><b>{me.name}</b><span>{STAFF_ROLE_LABEL[admin.role] || "Standard"}</span></span>
            <ChevronDown size={14} />
          </button>
          {menu && (
            <div className="pf-menu">
              <div className="pf-menu-hd">
                <b>{me.name}</b><span>{me.email}</span>
                <em>{STAFF_ROLE_LABEL[admin.role] || "Standard"}{isSuper ? " · full access" : " · support"}</em>
              </div>
              <button onClick={() => go("accounts")}><Building2 size={14} /> Accounts</button>
              <button onClick={() => go("companies")}><Users size={14} /> Companies</button>
              {admin.finance && <button onClick={() => go("revenue")}><TrendingUp size={14} /> Revenue</button>}
              {isSuper && <button onClick={() => go("health")}><Activity size={14} /> Health</button>}
              {admin.impersonate && (
                <button onClick={() => go("accounts")}><LogIn size={14} /> Sign in as an account…</button>
              )}
              <button className="pf-menu-out" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
            </div>
          )}
        </div>
      </header>

      <main className="pf-main">
        {/* Whatever the last write said went wrong. Above the screen rather
            than beside the button, because by the time it fails the button
            may well have been dismissed with the form it sat in. */}
        {err && <p className="pf-write-err" role="alert">{err}</p>}
        {/* ===== DASHBOARD ===== */}
        {screen === "dashboard" && !openId && (
          <>
            <div className="pf-head">
              <div>
                <h2>Dashboard</h2>
                <span className="pf-sub">Every account, every subcontractor company, and what needs attention right now.</span>
              </div>
            </div>

            {/* What moved this month. Kept apart from the window below,
                because a number that resets on the 1st and one measured over
                an arbitrary window are not comparable at a glance. */}
            <section className="pf-section">
              <div className="pf-section-hd">
                <h3>This month</h3>
                <span>{monthLabel} · day {Number(today.slice(8))} of {Number(monthEnd.slice(8))}</span>
              </div>
              <PeriodStats m={thisMonthM} finance={admin.finance} showSms />
            </section>

            {/* One picker, above everything it scopes -- the chart and the
                tiles under it are the same window, so the two cannot
                disagree about what period is being read. */}
            <section className="pf-section">
              <div className="pf-section-hd">
                <h3>Range</h3>
                <RangePicker value={range} onChange={setRange} />
                <span>{niceDay(range.from)} — {niceDay(range.to)}</span>
              </div>

              {/* The only place a projection belongs: a level over time is
                  the shape a tile cannot show. */}
              {admin.finance && (
                <TrendChart series={dailySeries} from={range.from} to={range.to}
                  projectTo={range.to >= today ? monthEnd : null} />
              )}

              <PeriodStats m={rangeM} finance={admin.finance} showSms />
            </section>

            {/* Where things stand right now, which is a different question
                from what moved. These four are also the way in to each
                screen, so they carry the totals the tiles above do not. */}
            <section className="pf-section">
              <div className="pf-section-hd"><h3>Right now</h3><span>current state</span></div>
              <div className="pf-dash-grid">
                <div className="pf-panel pf-dash-card" onClick={() => go("accounts")}>
                  <h3><Building2 size={15} /> Accounts</h3>
                  <div className="pf-dash-stat"><b>{live.length}</b><span>live</span></div>
                  <p className="pf-note">
                    {live.filter((r) => r.a.plan === "scale").length} on Scale ·{" "}
                    {live.filter((r) => r.a.plan === "basic").length} on Basic
                    {rows.length > live.length ? ` · ${rows.length - live.length} canceled` : ""}
                  </p>
                  {health.atLimit > 0 && <p className="pf-dash-flag">● {health.atLimit} at a plan limit — upgrade candidates</p>}
                </div>

                <div className="pf-panel pf-dash-card" onClick={() => go("companies")}>
                  <h3><Users size={15} /> Companies</h3>
                  <div className="pf-dash-stat"><b>{companies.length}</b><span>on the platform</span></div>
                  <p className="pf-note">
                    {compRows.filter((r) => r.accts.length > 1).length} serving 2+ accounts ·{" "}
                    {compRows.filter((r) => (r.c.status || "active") !== "active").length} inactive
                  </p>
                  {health.licFail > 0 && <p className="pf-dash-flag">● {health.licFail} with a failing license check</p>}
                  {health.dups > 0 && <p className="pf-dash-flag">● {health.dups} possible duplicate{health.dups === 1 ? "" : "s"}</p>}
                </div>

                {admin.finance && (
                  <div className="pf-panel pf-dash-card" onClick={() => go("revenue")}>
                    <h3><TrendingUp size={15} /> Revenue</h3>
                    <div className="pf-dash-stat"><b>{fmtC(mrr)}</b><span>MRR</span></div>
                    <p className="pf-note">
                      {fmtC(mrr * 12)} ARR ·{" "}
                      {live.filter((r) => r.mrr > 0).length} paying account{live.filter((r) => r.mrr > 0).length === 1 ? "" : "s"} ·{" "}
                      {fmtC(gmvTotal)} GMV to date
                    </p>
                  </div>
                )}

                <div className="pf-panel pf-dash-card" onClick={() => go("health")}>
                  <h3><Activity size={15} /> Health</h3>
                  <div className="pf-dash-stat"><b>{attention}</b><span>needing attention</span></div>
                  <p className="pf-note">
                    {health.signups7d} signup{health.signups7d === 1 ? "" : "s"} in 7 days ·{" "}
                    {health.inactive14} inactive 14+ days
                  </p>
                </div>
              </div>

              <div className="pf-split">
                <div className="pf-panel">
                  <h3><MapPin size={15} /> Top locations</h3>
                  <p className="pf-note pf-rank-sub">Subcontractor companies, by city.</p>
                  <RankList {...topLocations} empty="No company addresses on file yet." />
                </div>
                <div className="pf-panel">
                  <h3><Hammer size={15} /> Top trades</h3>
                  <p className="pf-note pf-rank-sub">Accounts hiring each trade.</p>
                  <RankList {...topTrades} label={(id) => TRADE_LABEL[id] || id}
                    empty="No account has chosen its trades yet." />
                </div>
              </div>
            </section>

            {attention > 0 && (
              <div className="pf-panel">
                <h3>What needs attention</h3>
                {health.atLimit > 0 && <p className="pf-act">▸ {health.atLimit} Basic account{health.atLimit === 1 ? "" : "s"} at a plan limit — <a onClick={() => go("accounts")}>view accounts</a></p>}
                {health.licFail > 0 && <p className="pf-act">▸ {health.licFail} compan{health.licFail === 1 ? "y" : "ies"} with a failing license check — <a onClick={() => go("companies")}>view companies</a></p>}
                {health.dups > 0 && <p className="pf-act">▸ {health.dups} possible duplicate compan{health.dups === 1 ? "y" : "ies"} — <a onClick={() => go("companies")}>view companies</a></p>}
                {health.expired > 0 && <p className="pf-act">▸ {health.expired} expired work-order offer{health.expired === 1 ? "" : "s"} with no reply</p>}
              </div>
            )}
          </>
        )}

        {/* ===== ACCOUNTS ===== */}
        {screen === "accounts" && !openId && (
          <>
            <div className="pf-head">
              <div><h2>Accounts</h2></div>
              {isSuper && (
                <button className="btn-solid" onClick={() => setNewAccount({
                  name: "", subdomain: "", kind: "general_contractor", plan: "basic", billing: "monthly",
                  ownerName: "", ownerEmail: "", ownerPhone: "", trades: [],
                })}>
                  <Plus size={14} /> New account
                </button>
              )}
            </div>
            <div className="pf-kpis pf-kpis-wrap">
              <Kpi label="Live accounts" value={live.length} />
              <Kpi label="Scale" value={live.filter((r) => r.a.plan === "scale").length} />
              <Kpi label="Basic" value={live.filter((r) => r.a.plan === "basic").length} />
              {admin.finance && <Kpi label="MRR" value={fmtC(mrr)} accent />}
              {isSuper && <Kpi label="Subs on platform" value={companies.length} />}
            </div>
            {newAccount && (
              <div className="pf-panel pf-newform">
                <h3>New account</h3>
                <div className="pf-form-grid">
                  <label className="pf-fld"><span>Company name</span>
                    <input placeholder="Cascade Exteriors" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} /></label>
                  <label className="pf-fld"><span>Subdomain</span>
                    <input placeholder="cascadeexteriors" value={newAccount.subdomain}
                      onChange={(e) => setNewAccount({ ...newAccount, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
                    {newAccount.subdomain && <em className="pf-fld-hint">{newAccount.subdomain}.subsub.work</em>}</label>
                  <label className="pf-fld"><span>Account type</span>
                    <select value={newAccount.kind} onChange={(e) => setNewAccount({ ...newAccount, kind: e.target.value })}>
                      {Object.entries(ACCOUNT_KINDS).map(([id, k]) => <option key={id} value={id}>{k.label}</option>)}
                    </select>
                    <em className="pf-fld-hint">Anything but a general contractor manages a standing property list.</em></label>
                  <label className="pf-fld"><span>Plan</span>
                    <select value={newAccount.plan} onChange={(e) => setNewAccount({ ...newAccount, plan: e.target.value })}>
                      <option value="basic">Basic</option><option value="scale">Scale</option>
                    </select>
                    <em className="pf-fld-hint">Scale here grants the features and bills nothing — comp it afterwards so the reason is recorded.</em></label>
                  <label className="pf-fld"><span>Billing cycle</span>
                    <select value={newAccount.billing} onChange={(e) => setNewAccount({ ...newAccount, billing: e.target.value })}>
                      <option value="monthly">Monthly</option><option value="annual">Annual</option>
                    </select></label>
                  <label className="pf-fld"><span>Owner's full name</span>
                    <input placeholder="Dana Reyes" value={newAccount.ownerName} onChange={(e) => setNewAccount({ ...newAccount, ownerName: e.target.value })} /></label>
                  <label className="pf-fld"><span>Owner's work email</span>
                    <input placeholder="dana@example.com" type="email" value={newAccount.ownerEmail} onChange={(e) => setNewAccount({ ...newAccount, ownerEmail: e.target.value })} /></label>
                  <label className="pf-fld"><span>Owner's mobile <em className="pf-opt">optional</em></span>
                    <input placeholder="(206) 555-0100" inputMode="tel" maxLength={13} value={newAccount.ownerPhone}
                      onChange={(e) => setNewAccount({ ...newAccount, ownerPhone: formatPhone(e.target.value) })} /></label>
                </div>

                {/* Signup asks for these and the console did not, so an account
                    created here arrived with no trades and the app had nothing
                    to decide what to ask their subcontractors to prove. */}
                <div className="pf-trades">
                  <span className="pf-trades-hd">Trades they hire out <em className="pf-opt">optional — they can choose later</em></span>
                  {TRADE_GROUPS.map(([heading, ids]) => (
                    <div key={heading} className="pf-trade-group">
                      <h5>{heading}</h5>
                      <div className="picks">
                        {ids.map((id) => (
                          <button key={id} type="button"
                            className={`pick ${newAccount.trades.includes(id) ? "on" : ""}`}
                            onClick={() => setNewAccount({
                              ...newAccount,
                              trades: newAccount.trades.includes(id)
                                ? newAccount.trades.filter((x) => x !== id)
                                : [...newAccount.trades, id],
                            })}>{TRADE_LABEL[id]}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="pf-note">
                  Creates the account and an admin membership for the owner. Nobody is signed in and no
                  password is set: open the new account and send a reset link, which is how they get in.
                  {newAccount.plan === "basic"
                    ? " They sign in at app.subsub.work — a Basic account reserves its subdomain but does not serve it."
                    : " Their own subdomain only answers once it is added as a custom domain in Cloudflare; until then they sign in at app.subsub.work."}
                </p>
                <div className="form-actions">
                  <button className="btn-ghost" onClick={() => setNewAccount(null)}>Cancel</button>
                  <button className="btn-solid"
                    disabled={!newAccount.name.trim() || !newAccount.subdomain.trim() || !newAccount.ownerName.trim() || !newAccount.ownerEmail.trim()}
                    onClick={async () => {
                      try { await onCreateAccount(newAccount); setNewAccount(null); }
                      catch { /* the console has already said why; keep the form */ }
                    }}>Create account</button>
                </div>
              </div>
            )}
            <div className="pf-account-grid">
              {rows.sort((x, y) => y.mrr - x.mrr || y.gmv - x.gmv).map((r) => {
                const isExpanded = expandedAccountId === r.a.id;
                const status = r.a.status || "active";
                return (
                  <div key={r.a.id} className={`pf-company-card pf-account-card ${status === "canceled" ? "muted" : ""} ${isExpanded ? "is-open" : ""}`}>
                    <div className="pfc-top" onClick={() => setOpenId(r.a.id)}>
                      <div className="pfc-name">
                        <b>{r.a.name}</b>
                        <span className="pf-sub">{r.a.subdomain}.subsub.work</span>
                      </div>
                      <div className="pfc-summary">
                        <span className={`plan-pill ${r.a.plan}`}>{PLANS[r.a.plan].name}</span>
                        {/* Otherwise a Scale account with no revenue reads as
                            a billing fault rather than a decision. */}
                        {r.a.comped && <span className="pf-comp-tag" title={r.a.compNote || ""}>Comped</span>}
                        {/* A Scale account whose address is not live is the
                            one failure a customer notices before we do. */}
                        {r.a.plan === "scale" && r.a.hostnameStatus !== "active" && (
                          <span className={`pf-host-pill t-${r.a.hostnameStatus === "failed" ? "bad" : "wait"}`}
                            title={r.a.hostnameError || "Branded address is not live yet"}>
                            {r.a.hostnameStatus === "failed" ? "Address failed" : "Address setting up"}
                          </span>
                        )}
                        <span className={`pf-status ${status}`}>{status}</span>
                        {r.atLimit && <span className="pf-flag" title="At a Basic plan limit">●</span>}
                      </div>
                      <div className="pfc-actions" onClick={(e) => e.stopPropagation()}>
                        {isSuper && (
                          <>
                            <button className="pf-mini" title="Edit account"
                              onClick={() => setOpenId(r.a.id)}><Pencil size={13} /></button>
                            <button className="pf-mini pf-mini-danger" title="Delete account"
                              onClick={() => setConfirmDelete({ kind: "account", id: r.a.id, name: r.a.name })}>
                              <Trash2 size={13} /></button>
                          </>
                        )}
                        <button className="pf-mini" title={isExpanded ? "Collapse" : "Expand"}
                          onClick={() => setExpandedAccountId(isExpanded ? null : r.a.id)}>
                          <ChevronDown size={13} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="pfc-rows">
                        <div className="pfc-row"><span>Billing</span><span>{r.a.billing}</span></div>
                        <div className="pfc-row"><span>Users</span><span>{r.users}</span></div>
                        <div className="pfc-row"><span>Subs</span>
                          <span>{r.subs}{r.atLimit && <span className="pf-flag" title="At a Basic plan limit"> ●</span>}</span></div>
                        <div className="pfc-row"><span>Jobs / mo</span><span>{r.jobsMo}</span></div>
                        {admin.finance && <div className="pfc-row"><span>MRR</span><span>{r.mrr ? fmtC(r.mrr) : "—"}</span></div>}
                        {admin.finance && <div className="pfc-row"><span>GMV</span><span>{r.gmv ? fmtC(r.gmv) : "—"}</span></div>}
                        <div className="pfc-row"><span>Last active</span><span>{r.a.lastActive || "—"}</span></div>
                      </div>
                    )}
                  </div>
                );
              })}
              {rows.length === 0 && <p className="pf-note">No accounts yet.</p>}
            </div>
            <p className="pf-note">● = Basic account at its subcontractor or monthly-job limit. That's an upgrade conversation.</p>
          </>
        )}

        {/* ===== ACCOUNT DETAIL ===== */}
        {open && (
          <>
            <button className="pf-back" onClick={() => setOpenId(null)}>‹ All accounts</button>
            <div className="pf-head">
              <div>
                <h2>{open.a.name}</h2>
                <p className="pf-sub">{open.a.subdomain}.subsub.work · created {open.a.createdAt || "—"} · last active {open.a.lastActive || "—"}</p>
                <p className="pf-signin">Signs in at <b>app.subsub.work</b>, and at their own address once it is live.</p>
              </div>
              <div className="pf-hd-actions">
                {admin.impersonate && open.a.status !== "canceled" && (
                  <button className="btn-solid" onClick={() => onImpersonate(open.a)}>
                    <LogIn size={14} /> Sign in as this account
                  </button>
                )}
              </div>
            </div>
            <div className="pf-kpis">
              <Kpi label="Plan" value={PLANS[open.a.plan].name} sub={open.a.billing} />
              {admin.finance && <Kpi label="MRR" value={open.mrr ? fmtC(open.mrr) : "—"} accent />}
              <Kpi label="Team users" value={open.users} />
              <Kpi label="Subcontractors" value={open.subs} />
              <Kpi label="Jobs this month" value={open.jobsMo} />
              {admin.finance && <Kpi label="GMV to date" value={open.gmv ? fmtC(open.gmv) : "—"} />}
              <Kpi label="Docs pending review" value={open.pendingDocs} warn={open.pendingDocs > 0} />
            </div>

            <div className="pf-panel">
              <h3>Plan</h3>
              <div className="pf-plan-row">
                <label>Plan
                  <select value={open.a.plan} onChange={(e) => onPatchAccount(open.a.id, { plan: e.target.value })}>
                    <option value="basic">Basic</option><option value="scale">Scale</option>
                  </select></label>
                <label>Billing
                  <select value={open.a.billing} onChange={(e) => onPatchAccount(open.a.id, { billing: e.target.value })}>
                    <option value="monthly">Monthly</option><option value="annual">Annual</option>
                  </select></label>
                {/* The differences are small but they decide whether the
                    account keeps a building list, and one chosen wrongly at
                    signup could only be corrected in the database. */}
                <label>Account type
                  <select value={kindOf(open.a)} onChange={(e) => onPatchAccount(open.a.id, { kind: e.target.value })}>
                    {Object.entries(ACCOUNT_KINDS).map(([id, k]) => (
                      <option key={id} value={id}>{k.label}</option>
                    ))}
                  </select></label>
              </div>
              <p className="pf-note">
                {ACCOUNT_KINDS[kindOf(open.a)].properties
                  ? "Keeps a building list: vendors are scoped to specific properties."
                  : "No building list: vendors are matched by trade and coverage area, job by job."}
              </p>
              <p className="pf-note">
                {open.a.subscriptionStatus
                  ? `Stripe says ${open.a.subscriptionStatus}${open.a.currentPeriodEnd ? `, through ${niceDay(open.a.currentPeriodEnd)}` : ""}. Changing the plan here does not change what they are billed.`
                  : "No Stripe subscription. Changing the plan here grants the features and bills nothing — use the comp below if that is what you mean."}
              </p>
            </div>

            <HostnamePanel account={open.a} onSync={() => onSyncHostname(open.a.id)}
              onCheckSetup={onCheckHostnameSetup} />

            <CompPanel account={open.a} onSave={(patch) => onPatchAccount(open.a.id, patch)} />

            <div className="pf-panel">
              <div className="pf-panel-hd">
                <h3>Team</h3>
                <button className="pf-mini" onClick={() => setAddUser(addUser ? null : { name: "", email: "", role: "pm" })}>
                  <Plus size={13} /> Add user
                </button>
              </div>
              {addUser && (
                <div className="pf-adduser">
                  <input placeholder="Full name" value={addUser.name} onChange={(e) => setAddUser({ ...addUser, name: e.target.value })} />
                  <input placeholder="Work email" type="email" value={addUser.email} onChange={(e) => setAddUser({ ...addUser, email: e.target.value })} />
                  <select value={addUser.role} onChange={(e) => setAddUser({ ...addUser, role: e.target.value })}>
                    <option value="admin">Admin</option><option value="pm">Property manager</option>
                  </select>
                  <button className="btn-solid small" disabled={!addUser.name.trim() || !addUser.email.trim()}
                    onClick={async () => {
                      try { await onAddUser(open.a.id, addUser); setAddUser(null); }
                      catch { /* keep the row so the address is not retyped */ }
                    }}>Add</button>
                  <button className="pf-mini" onClick={() => setAddUser(null)}>Cancel</button>
                </div>
              )}
              {resetFor && resetFor.accountId === open.a.id && (
                <div className="pf-reset">
                  {!resetLink || resetLink.email !== resetFor.email ? (
                    <>
                      <p>Send a password reset link to <b>{resetFor.name}</b> ({resetFor.email})?
                        You will not see or set their password — only they can choose a new one, from a
                        link that expires and can be used once.</p>
                      {resetErr && <p className="pf-host-err">{resetErr}</p>}
                      <div className="form-actions">
                        <button className="btn-ghost" onClick={() => { setResetFor(null); setResetErr(""); }}>Cancel</button>
                        <button className="btn-solid" disabled={sending}
                          onClick={async () => {
                            setSending(true); setResetErr("");
                            try { setResetLink(await onResetPassword(resetFor.userId, resetFor.accountId)); }
                            catch (err) {
                              // The console-wide banner for this sits at the
                              // top of the page, which is nowhere near the
                              // button that was pressed -- so a failed send
                              // read as a button that did nothing at all.
                              setResetErr(resetFailureText(err));
                            }
                            finally { setSending(false); }
                          }}>
                          <Key size={14} /> {sending ? "Sending…" : "Send reset link"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* No link is shown, because none comes back. The token
                          exists only inside the email -- which is exactly what
                          makes sending one on somebody's behalf safe. */}
                      <p><Check size={14} style={{ display: "inline", verticalAlign: -2 }} /> Reset email sent to <b>{resetLink.email}</b>.
                        The link is in that email, expires, and works once.</p>
                      {resetLink.created && (
                        <p className="pf-note">They had no sign-in yet, so one was created first — they may
                          also get a "confirm your email" message. The reset link is the one that lets them
                          choose a password.</p>
                      )}
                      <div className="form-actions">
                        <button className="btn-ghost" onClick={() => { setResetFor(null); setResetLink(null); }}>Done</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {memberships.filter((m) => m.accountId === open.a.id && m.role !== "contractor").map((m) => {
                const u = users.find((x) => x.id === m.userId);
                return u ? (
                  <div key={m.userId} className="pf-line">
                    <span className="user-avatar">{u.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                    <span className="pf-line-main"><b>{u.name}</b><span className="pf-sub">{u.email}</span></span>
                    <span className={`role-badge r-${m.role}`}>{ROLES[m.role].label}</span>
                    <button className="pf-mini" onClick={() => { setResetErr(""); setResetLink(null); setResetFor({ userId: u.id, name: u.name, email: u.email, accountId: open.a.id }); }}>
                      <Key size={12} /> Reset password
                    </button>
                  </div>
                ) : null;
              })}
            </div>

            <MailLog accountId={open.a.id} load={onMailLog} />

            <div className="pf-panel">
              <div className="pf-panel-hd">
                <h3>User activity</h3>
                <select value={actFilter} onChange={(e) => setActFilter(e.target.value)}>
                  <option value="all">Everyone</option>
                  {memberships.filter((m) => m.accountId === open.a.id).map((m) => {
                    const u = users.find((x) => x.id === m.userId);
                    return u ? <option key={u.id} value={u.id}>{u.name}</option> : null;
                  })}
                  <option value="system">System</option>
                </select>
              </div>
              {(() => {
                const list = (activity || [])
                  .filter((e) => e.accountId === open.a.id)
                  .filter((e) => actFilter === "all" ? true : actFilter === "system" ? !e.userId : e.userId === actFilter)
                  .sort((x, y) => y.at.localeCompare(x.at));
                if (!list.length) return <p className="pf-note">No activity recorded{actFilter !== "all" ? " for this filter" : ""}.</p>;
                return list.slice(0, 40).map((e) => {
                  const u = e.userId ? users.find((x) => x.id === e.userId) : null;
                  return (
                    <div key={e.id} className="pf-act-row">
                      <span className="pf-act-when">{e.at.slice(0, 10)}<em>{e.at.slice(11, 16)}</em></span>
                      <span className={`pf-act-kind k-${e.kind}`}>{ACTIVITY_LABEL[e.kind] || e.kind}</span>
                      <span className="pf-act-txt">{e.text}</span>
                      <span className="pf-act-who">{u ? u.name : "System"}</span>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="pf-panel">
              <h3>Subscription history</h3>
              {subEvents.filter((e) => e.accountId === open.a.id).sort((x, y) => x.at.localeCompare(y.at)).map((e) => (
                <div key={e.id} className="pf-line">
                  <span className="pf-date">{e.at}</span>
                  <span className="pf-line-main">
                    {e.kind === "created" ? "Signed up on Basic"
                      : e.kind === "upgraded" ? `Upgraded ${e.fromPlan} → ${e.toPlan}`
                      : e.kind === "cycle" ? `Switched to ${e.cycle} billing`
                      : e.kind === "canceled" ? "Canceled" : e.kind}
                  </span>
                  {admin.finance && e.mrrDelta !== 0 && (
                    <b className={e.mrrDelta > 0 ? "up" : "down"}>{e.mrrDelta > 0 ? "+" : "−"}{fmtC(Math.abs(e.mrrDelta))}/mo</b>
                  )}
                </div>
              ))}
              {!subEvents.some((e) => e.accountId === open.a.id) && <p className="pf-note">No events recorded.</p>}
            </div>

            {isSuper && (
              <div className="pf-panel pf-danger-zone">
                <h3><AlertTriangle size={15} /> Danger zone</h3>
                <div className="pf-danger-row">
                  <div>
                    <b>Delete this account</b>
                    <p className="pf-note">Removes the account, its team memberships, and its subcontractor
                      engagements. Job history and documents already on file are not recoverable from here.
                      This cannot be undone.</p>
                  </div>
                  <button className="btn-danger-outline"
                    onClick={() => setConfirmDelete({ kind: "account", id: open.a.id, name: open.a.name })}>
                    <Trash2 size={14} /> Delete account
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== COMPANIES ===== */}
        {screen === "companies" && !openId && (
          <>
            <div className="pf-head">
              <div><h2>Companies</h2></div>
              {isSuper && (
                <button className="btn-solid" onClick={() => setNewCompany({ company: "", contact: "", email: "", phone: "", license: "", ubi: "", city: "", zip: "" })}>
                  <Plus size={14} /> New company
                </button>
              )}
            </div>
            <div className="pf-kpis pf-kpis-wrap">
              <Kpi label="Subcontractor companies" value={companies.length} />
              <Kpi label="Serving 2+ accounts" value={compRows.filter((r) => r.accts.length > 1).length} accent />
              <Kpi label="License issues" value={health.licFail} warn={health.licFail > 0} />
              <Kpi label="Possible duplicates" value={health.dups} warn={health.dups > 0} />
            </div>
            {newCompany && (
              <div className="pf-panel pf-newform">
                <h3>New company</h3>
                <div className="pf-form-grid">
                  <label className="pf-fld"><span>Company name</span>
                    <input placeholder="Rainier Roofing" value={newCompany.company} onChange={(e) => setNewCompany({ ...newCompany, company: e.target.value })} /></label>
                  <label className="pf-fld"><span>Contact name</span>
                    <input placeholder="Sam Ortiz" value={newCompany.contact} onChange={(e) => setNewCompany({ ...newCompany, contact: e.target.value })} /></label>
                  <label className="pf-fld"><span>Email</span>
                    <input placeholder="sam@example.com" type="email" value={newCompany.email} onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })} /></label>
                  <label className="pf-fld"><span>Phone</span>
                    <input placeholder="(206) 555-0100" inputMode="tel" value={newCompany.phone}
                      onChange={(e) => setNewCompany({ ...newCompany, phone: formatPhone(e.target.value) })} /></label>
                  <label className="pf-fld"><span>WA L&amp;I license #</span>
                    <input placeholder="RAINIRR891QZ" value={newCompany.license} onChange={(e) => setNewCompany({ ...newCompany, license: e.target.value })} /></label>
                  <label className="pf-fld"><span>UBI</span>
                    <input placeholder="601 234 567" value={newCompany.ubi} onChange={(e) => setNewCompany({ ...newCompany, ubi: e.target.value })} /></label>
                  <label className="pf-fld"><span>City</span>
                    <input placeholder="Seattle" value={newCompany.city} onChange={(e) => setNewCompany({ ...newCompany, city: e.target.value })} /></label>
                  <label className="pf-fld"><span>ZIP</span>
                    <input placeholder="98101" inputMode="numeric" value={newCompany.zip} onChange={(e) => setNewCompany({ ...newCompany, zip: e.target.value })} /></label>
                </div>
                <p className="pf-note">Creates a company record with no engagements yet — a hiring account still needs to invite or add them to actually work a job.</p>
                <div className="form-actions">
                  <button className="btn-ghost" onClick={() => setNewCompany(null)}>Cancel</button>
                  <button className="btn-solid" disabled={!newCompany.company.trim() || !newCompany.license.trim()}
                    onClick={async () => {
                      try { await onCreateCompany(newCompany); setNewCompany(null); }
                      catch { /* keep the form, and what is in it */ }
                    }}>Create company</button>
                </div>
              </div>
            )}
            <p className="pf-note">One company can serve many hiring accounts. A lapsed license here affects every account engaging them — this is the only place that's visible.</p>
            <div className="pf-company-grid">
              {compRows.sort((x, y) => y.accts.length - x.accts.length).map((r) => {
                const isExpanded = expandedCompanyId === r.c.id;
                const coStatus = r.c.status || "active";
                return (
                  <div key={r.c.id} className={`pf-company-card ${r.licOk ? "" : "warn"} ${coStatus !== "active" ? "muted" : ""} ${isExpanded ? "is-open" : ""}`}>
                    <div className="pfc-top" onClick={() => setEditCompanyId(r.c.id)}>
                      <div className="pfc-name">
                        <b>{r.c.company}</b>
                        <span className="pf-sub">{r.c.contact} · {r.c.city}, {r.c.state}</span>
                      </div>
                      <div className="pfc-summary">
                        <span className={`pf-status ${coStatus === "active" ? "active" : "canceled"}`}>{coStatus}</span>
                        {r.lic && String(r.lic.status).toLowerCase() !== "active" &&
                          <span className="pf-status suspended" title="State license status">{r.lic.status}</span>}
                        {r.accts.length > 1 && <span className="pf-multi">×{r.accts.length}</span>}
                        {r.dup && <span className="pf-flag" title="Same license number on another record">dup</span>}
                      </div>
                      <div className="pfc-actions" onClick={(e) => e.stopPropagation()}>
                        {isSuper && (
                          <>
                            <button className="pf-mini" title="Edit company"
                              onClick={() => setEditCompanyId(r.c.id)}><Pencil size={13} /></button>
                            <button className="pf-mini pf-mini-danger" title="Delete company"
                              onClick={() => setConfirmDelete({ kind: "company", id: r.c.id, name: r.c.company })}>
                              <Trash2 size={13} /></button>
                          </>
                        )}
                        <button className="pf-mini" title={isExpanded ? "Collapse" : "Expand"}
                          onClick={() => setExpandedCompanyId(isExpanded ? null : r.c.id)}>
                          <ChevronDown size={13} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="pfc-rows">
                        <div className="pfc-row">
                          <span>License</span>
                          <span><code>{r.c.license || "—"}</code></span>
                        </div>
                        <div className="pfc-row">
                          <span>State status</span>
                          <span>{r.lic
                            ? <span className={`pf-status ${String(r.lic.status).toLowerCase() === "active" ? "active" : "suspended"}`}>{r.lic.status}</span>
                            : <span className="pf-sub">not checked</span>}</span>
                        </div>
                        <div className="pfc-row">
                          <span>Engaged by</span>
                          <span>{r.accts.map((a) => a.name).join(", ") || "—"}</span>
                        </div>
                        <div className="pfc-row">
                          <span>Warranty</span>
                          <span>{warrantyLabel(r.c).replace(" labor warranty", "")}</span>
                        </div>
                        {isSuper && (
                          <div className="pfc-row">
                            <span>Account status</span>
                            <button className="pf-mini"
                              onClick={() => onEditCompany(r.c.id, { status: coStatus === "active" ? "inactive" : "active" })}>
                              {coStatus === "active" ? "Deactivate" : "Reactivate"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {compRows.length === 0 && <p className="pf-note">No companies yet.</p>}
            </div>
            {editCompanyId && (() => {
              const co = companies.find((c) => c.id === editCompanyId);
              if (!co) return null;
              return (
                <div className="pf-panel pf-newform">
                  <div className="pf-panel-hd">
                    <h3>Edit {co.company}</h3>
                    {isSuper && (
                      <button className="pf-mini pf-mini-danger"
                        onClick={() => setConfirmDelete({ kind: "company", id: co.id, name: co.company })}>
                        <Trash2 size={12} /> Delete company
                      </button>
                    )}
                  </div>
                  <CompanyEditFields co={co} onSave={(patch) => onEditCompany(co.id, patch)} onCancel={() => setEditCompanyId(null)} />
                </div>
              );
            })()}
          </>
        )}

        {/* ===== REVENUE ===== */}
        {screen === "revenue" && !openId && admin.finance && (
          <>
            <div className="pf-head">
              <div>
                <h2>Revenue</h2>
                <span className="pf-sub">Recurring revenue, normalized to a month — an annual plan counts as a twelfth of its price.</span>
              </div>
            </div>

            <section className="pf-section">
              <div className="pf-section-hd"><h3>This month</h3><span>{monthLabel}</span></div>
              <div className="pf-kpis">
                <Kpi label="Net new MRR" value={(netNewMrr >= 0 ? "+" : "−") + fmtC(Math.abs(netNewMrr))} accent />
                <Kpi label="ARR contribution" value={(netNewMrr >= 0 ? "+" : "−") + fmtC(Math.abs(netNewMrr * 12))} sub="net new MRR × 12" />
                <Kpi label="New MRR" value={moNow.newMrr ? "+" + fmtC(moNow.newMrr) : "—"} />
                <Kpi label="Lost MRR" value={lostMrr ? "−" + fmtC(Math.abs(lostMrr)) : "—"} warn={lostMrr < 0} sub="churn + downgrades" />
                <Kpi label="Conversions to paid" value={moNow.conversions} />
              </div>
            </section>

            <section className="pf-section">
              <div className="pf-section-hd"><h3>All time</h3><span>through {monthLabel}</span></div>
              <div className="pf-kpis">
                <Kpi label="MRR (normalized)" value={fmtC(mrr)} accent />
                <Kpi label="ARR" value={fmtC(mrr * 12)} />
                <Kpi label="Paying accounts" value={live.filter((r) => r.mrr > 0).length} />
                <Kpi label="Free → paid" value={`${conv}%`} sub={daysToConvert !== null ? `median ${daysToConvert}d` : ""} />
                <Kpi label="Annual mix" value={`${live.filter((r) => r.mrr > 0).length
                  ? Math.round(live.filter((r) => r.mrr > 0 && r.a.billing === "annual").length / live.filter((r) => r.mrr > 0).length * 100) : 0}%`} />
              </div>

              <div className="pf-panel">
                <h3>MRR movement by month</h3>
                <p className="pf-note">From the append-only subscription log, not current account state — which is why months don't drift.</p>
                <div className="pf-table-wrap">
                  <table className="pf-table pf-num pf-table-responsive">
                    <thead><tr><th>Month</th><th>Signups</th><th>Conversions</th><th>New</th><th>Expansion</th><th>Contraction</th><th>Churn</th><th>Net new</th><th>Ending MRR</th></tr></thead>
                    <tbody>
                      {running.map((r) => (
                        <tr key={r.m}>
                          <td data-label="Month"><b>{r.m}</b></td>
                          <td data-label="Signups">{r.signups}</td>
                          <td data-label="Conversions">{r.conversions}</td>
                          <td data-label="New" className="up">{r.newMrr ? "+" + fmtC(r.newMrr) : "—"}</td>
                          <td data-label="Expansion" className="up">{r.expansion ? "+" + fmtC(r.expansion) : "—"}</td>
                          <td data-label="Contraction" className="down">{r.contraction ? "−" + fmtC(Math.abs(r.contraction)) : "—"}</td>
                          <td data-label="Churn" className="down">{r.churn ? "−" + fmtC(Math.abs(r.churn)) : "—"}</td>
                          <td data-label="Net new"><b className={(r.newMrr + r.expansion + r.contraction + r.churn) >= 0 ? "up" : "down"}>
                            {(r.newMrr + r.expansion + r.contraction + r.churn) >= 0 ? "+" : "−"}{fmtC(Math.abs(r.newMrr + r.expansion + r.contraction + r.churn))}</b></td>
                          <td data-label="Ending MRR"><b>{fmtC(r.mrr)}</b></td>
                        </tr>
                      ))}
                      {running.length === 0 && (
                        <tr><td data-label="" colSpan={9}>No subscription activity yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {/* The log and the accounts should agree. When they don't, a plan
                    was changed somewhere the webhook never saw, and the table
                    above is the number that is wrong -- say so rather than
                    letting two figures quietly disagree across the page. */}
                {running.length > 0 && loggedMrr !== mrr && (
                  <p className="pf-note pf-reconcile">
                    Ending MRR above is {fmtC(loggedMrr)}, but the accounts currently bill {fmtC(mrr)}.
                    A plan was changed without a subscription event — usually an edit made directly
                    in the database, or a Stripe change that arrived before the webhook was connected.
                  </p>
                )}
              </div>

              <div className="pf-panel">
                <h3>GMV through the platform</h3>
                <p className="pf-note">Work-order value accepted across all accounts. Not revenue — the denominator for a future take rate, and an early signal of account health.</p>
                <div className="pf-kpis pf-kpis-top">
                  <Kpi label="Accepted work-order value" value={fmtC(gmvTotal)} />
                  <Kpi label="Per paying account" value={live.filter((r) => r.mrr > 0).length ? fmtC(gmvTotal / live.filter((r) => r.mrr > 0).length) : "—"} />
                  <Kpi label="Upgrade pipeline" value={health.atLimit} sub="Basic at limit" warn={health.atLimit > 0} />
                </div>
              </div>
            </section>
          </>
        )}

        {/* ===== HEALTH ===== */}
        {screen === "health" && !openId && isSuper && (
          <>
            <div className="pf-head"><h2>Health</h2></div>
            <div className="pf-kpis pf-kpis-wrap">
              <Kpi label="Signups, last 7 days" value={health.signups7d} />
              <Kpi label="Basic at a limit" value={health.atLimit} warn={health.atLimit > 0} sub="upgrade candidates" />
              <Kpi label="Docs pending review" value={health.docsStale} warn={health.docsStale > 5} />
              <Kpi label="Expired offers" value={health.expired} warn={health.expired > 0} sub="no reply by deadline" />
              <Kpi label="License checks failing" value={health.licFail} warn={health.licFail > 0} />
              <Kpi label="Duplicate companies" value={health.dups} warn={health.dups > 0} />
              <Kpi label="Inactive 14+ days" value={health.inactive14} warn={health.inactive14 > 0} sub="churn risk" />
            </div>
            <SetupCheck load={onSetupCheck} />

            <div className="pf-panel">
              <h3>What to act on</h3>
              {health.atLimit > 0 && <p className="pf-act">▸ {health.atLimit} Basic account{health.atLimit === 1 ? "" : "s"} sitting at a plan limit — they've hit the wall and haven't upgraded. Worth a call.</p>}
              {health.licFail > 0 && <p className="pf-act">▸ {health.licFail} compan{health.licFail === 1 ? "y" : "ies"} with a failing state license check, affecting every account that engages them.</p>}
              {health.inactive14 > 0 && <p className="pf-act">▸ {health.inactive14} live account{health.inactive14 === 1 ? "" : "s"} with no activity in two weeks.</p>}
              {health.dups > 0 && <p className="pf-act">▸ {health.dups} company record{health.dups === 1 ? "" : "s"} sharing a license number — merge before documents attach to both.</p>}
              {!health.atLimit && !health.licFail && !health.inactive14 && !health.dups && <p className="pf-note">Nothing needs attention.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}


// The page a confirmation or password-reset link lands on.
//
// Both kinds end the same way -- somebody choosing a password -- so they are
// one screen. A confirmation link is the only way a person added from the
// console can ever set one: the account was created for them with a password
// nobody knows, and confirming the address is the moment they hold a session
// long enough to replace it.
//
// The failure case is a screen too. "Email link is invalid or has expired"
// was arriving as a fragment on the sign-in page and being shown to nobody,
// so a link that did not work looked exactly like a link that did.
function AuthLanding({ flow, brand, onDone, onCancel }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const failed = flow.kind === "link_failed";
  const expired = /expired|invalid/i.test(flow.code || "") || /expired|invalid/i.test(flow.message || "");

  const save = async () => {
    if (pw.length < 8) { setErr("Use at least 8 characters."); return; }
    if (pw !== again) { setErr("Those two do not match."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      // The commonest one by far: the link's session is gone, so there is
      // nothing to attach the new password to.
      setErr(/session|jwt|expired/i.test(error.message)
        ? "That link has expired. Ask for a new one below."
        : error.message);
      return;
    }
    // They hold a valid session now, so there is no reason to make them sign
    // in again with the password they just typed.
    onDone();
  };

  const resend = async () => {
    if (!email.trim()) { setErr("Enter your email first."); return; }
    setBusy(true); setErr("");
    // Back to the address they are standing on, so somebody who started at
    // their own company's address ends up there rather than at the shared one.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(),
      { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  };

  return (
    <div className="login-wrap wl-themed">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap"><BrandMark brand={brand} height={38} /></div>
          <h1>{brand.name}</h1>
          <p>{failed ? "Link problem" : flow.reason === "confirmed" ? "Email confirmed" : "Choose a new password"}</p>
        </div>

        {failed ? (
          <>
            <div className="login-err"><AlertTriangle size={13} />
              {expired
                ? "That link has already been used or has expired. They only work once, and email scanners sometimes open them before you do."
                : (flow.message || "That link did not work.")}
            </div>
            {sent ? (
              <div className="login-err" style={{ color: "var(--forest-lift)" }}>
                <CheckCircle2 size={13} /> Sent. Check {email} — open the new link on this device.
              </div>
            ) : (
              <>
                <p className="login-note">Send yourself a fresh one:</p>
                <label className="fld">Email
                  <input type="email" inputMode="email" autoComplete="username" value={email}
                    onChange={(e) => { setEmail(e.target.value); setErr(""); }}
                    placeholder="you@company.com"
                    onKeyDown={(e) => e.key === "Enter" && resend()} />
                </label>
                {err && <div className="login-err"><AlertTriangle size={13} /> {err}</div>}
                <button className="btn-solid login-btn" onClick={resend} disabled={busy}>
                  <Mail size={15} /> {busy ? "Sending…" : "Send a new link"}
                </button>
              </>
            )}
            <button className="login-forgot" onClick={onCancel}>Back to sign in</button>
          </>
        ) : (
          <>
            <p className="login-note">
              {flow.reason === "confirmed"
                ? "Your email address is confirmed. Pick a password and you are in."
                : "Pick a new password. You will be signed in straight away."}
            </p>
            <label className="fld">New password
              <input type="password" autoComplete="new-password" value={pw}
                onChange={(e) => { setPw(e.target.value); setErr(""); }}
                placeholder="At least 8 characters"
                onKeyDown={(e) => e.key === "Enter" && save()} />
            </label>
            <label className="fld">Type it again
              <input type="password" autoComplete="new-password" value={again}
                onChange={(e) => { setAgain(e.target.value); setErr(""); }}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === "Enter" && save()} />
            </label>
            {err && <div className="login-err"><AlertTriangle size={13} /> {err}</div>}
            <button className="btn-solid login-btn" onClick={save} disabled={busy}>
              <Lock size={15} /> {busy ? "Saving…" : "Save password and continue"}
            </button>
          </>
        )}
      </div>
      <p className="login-foot"><PoweredBy height={12} /></p>
    </div>
  );
}

// ---- dashboard: date range -----------------------------------------------
// Presets as rows, because nobody fights a calendar grid for "last 30 days".
// Custom sits behind a rule at the bottom, where it does not compete.
const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

const RANGE_PRESETS = [
  ["30d", "Last 30 days", () => ({ from: daysAgo(29), to: isoDay(new Date()) })],
  ["90d", "Last 90 days", () => ({ from: daysAgo(89), to: isoDay(new Date()) })],
  ["ytd", "Year to date", () => ({ from: `${new Date().getUTCFullYear()}-01-01`, to: isoDay(new Date()) })],
  ["12m", "Last 12 months", () => ({ from: daysAgo(364), to: isoDay(new Date()) })],
  ["all", "All time", () => ({ from: "2000-01-01", to: isoDay(new Date()) })],
];
function defaultRange() {
  const p = RANGE_PRESETS.find(([id]) => id === "90d");
  return { id: "90d", ...p[2]() };
}
const rangeLabel = (r) => {
  const preset = RANGE_PRESETS.find(([id]) => id === r.id);
  if (preset) return preset[1];
  return `${niceDay(r.from)} — ${niceDay(r.to)}`;
};

function RangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  useEffect(() => { setFrom(value.from); setTo(value.to); }, [value.from, value.to]);

  const pick = (id, make) => { onChange({ id, ...make() }); setOpen(false); };

  return (
    <div className="pf-range">
      <button className="pf-range-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Calendar size={13} /> {rangeLabel(value)} <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div className="pf-range-scrim" onClick={() => setOpen(false)} />
          <div className="pf-range-menu">
            {RANGE_PRESETS.map(([id, label, make]) => (
              <button key={id} className={value.id === id ? "on" : ""} onClick={() => pick(id, make)}>
                <span className="pf-range-tick">{value.id === id ? "✓" : ""}</span>{label}
              </button>
            ))}
            <div className="pf-range-custom">
              <label><span>From</span>
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
              <label><span>To</span>
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
              <button className="pf-mini" disabled={!from || !to || from > to}
                onClick={() => { onChange({ id: "custom", from, to }); setOpen(false); }}>Apply</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- dashboard: the trend, with the rest of the period projected ---------
//
// Least squares over the window that is already drawn, extended to the end of
// the period. It is a straight line through what happened, not a forecast
// with a model behind it, so it is drawn dashed and labelled "projected" and
// never given the same weight as the measured part.
function projectLine(points, steps) {
  const n = points.length;
  if (n < 3 || steps < 1) return [];
  const xs = points.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, b) => a + b.v, 0) / n;
  let num = 0, den = 0;
  points.forEach((p, i) => { num += (i - mx) * (p.v - my); den += (i - mx) ** 2; });
  const slope = den ? num / den : 0;
  const out = [];
  for (let k = 1; k <= steps; k++) {
    // A projection below zero is arithmetic, not a prediction: nobody has
    // negative MRR or minus two customers.
    out.push(Math.max(0, my + slope * (n - 1 + k - mx)));
  }
  return out;
}

const CHART_METRICS = [
  { id: "mrr",  label: "MRR",           money: true,  pick: (p) => p.mrr },
  { id: "paid", label: "Paying accounts", money: false, pick: (p) => p.paid },
];

function TrendChart({ series, from, to, projectTo, money }) {
  const [metric, setMetric] = useState("mrr");
  const [hover, setHover] = useState(null);
  const wrap = useRef(null);
  const [w, setW] = useState(760);

  // Real pixels, measured. A viewBox stretched to fit would distort the
  // stroke weight, which is the one thing the mark spec fixes.
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    setW(Math.max(280, el.clientWidth || 760));
    return () => ro.disconnect();
  }, []);

  const m = CHART_METRICS.find((x) => x.id === metric) || CHART_METRICS[0];
  const fmt = (v) => (m.money ? fmtC(v) : Math.round(v).toLocaleString());

  const pts = series.filter((p) => p.day >= from && p.day <= to).map((p) => ({ day: p.day, v: m.pick(p) }));

  const H = 210, padL = 54, padR = 58, padT = 14, padB = 26;
  const plotW = Math.max(40, w - padL - padR), plotH = H - padT - padB;

  // How many days are left to project, and how far along the period we are.
  const steps = projectTo && pts.length
    ? Math.max(0, Math.round((new Date(projectTo + "T00:00:00Z") - new Date(pts[pts.length - 1].day + "T00:00:00Z")) / 86400000))
    : 0;
  const proj = projectLine(pts, steps);

  const all = [...pts.map((p) => p.v), ...proj];
  const peak = Math.max(1, ...all);
  const lo = 0;                               // a value axis that does not start at zero lies about proportion
  const total = pts.length + proj.length;
  const x = (i) => padL + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);

  // Four ticks, rounded to something a person would say out loud, and the
  // top of the scale raised to the last of them -- otherwise the highest
  // point sits on the frame with no gridline above it to read against.
  const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
  const nice = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((t) => peak / t <= 4) || peak;
  const hi = Math.ceil(peak / nice) * nice;
  const ticks = [];
  for (let t = 0; t <= hi + 1e-9; t += nice) ticks.push(t);

  const y = (v) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const path = (vals, i0) => vals.map((v, k) => `${k ? "L" : "M"}${x(i0 + k).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const last = pts.length ? pts[pts.length - 1].v : 0;
  const end = proj.length ? proj[proj.length - 1] : last;

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    if (!total) return;
    const i = Math.max(0, Math.min(total - 1, Math.round(((px - padL) / plotW) * (total - 1))));
    const projected = i >= pts.length;
    setHover({
      i, projected,
      day: projected
        ? isoDay(new Date(new Date(pts[pts.length - 1].day + "T00:00:00Z").getTime() + (i - pts.length + 1) * 86400000))
        : pts[i].day,
      v: projected ? proj[i - pts.length] : pts[i].v,
    });
  };

  return (
    <div className="pf-panel pf-chart">
      <div className="pf-panel-hd">
        <h3>{m.label} over time</h3>
        <div className="pf-chart-tabs" role="tablist">
          {CHART_METRICS.map((c) => (
            <button key={c.id} role="tab" aria-selected={metric === c.id}
              className={metric === c.id ? "on" : ""} onClick={() => { setMetric(c.id); setHover(null); }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {pts.length < 2 ? (
        <p className="pf-note">Not enough history in this range to draw a line yet.</p>
      ) : (
        <>
          <div className="pf-chart-wrap" ref={wrap}>
            <svg width={w} height={H} role="img"
              aria-label={`${m.label} from ${from} to ${to}${proj.length ? ", with the rest of the period projected" : ""}`}
              onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
              {ticks.map((t) => (
                <g key={t}>
                  {/* Hairline, solid. Dashing a gridline reads as a
                      projection, which here is a thing that actually exists. */}
                  <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
                  <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="pf-chart-tick">{fmt(t)}</text>
                </g>
              ))}

              {proj.length > 0 && (
                <>
                  <path d={path([last, ...proj], pts.length - 1)} fill="none" stroke="var(--brand)"
                    strokeWidth="2" strokeLinecap="round" strokeDasharray="5 5" opacity=".45" />
                  {/* Only where it fits. On a phone this label lands on the
                      measured line, and a label that collides is worse than
                      none -- the caption below carries the same number. */}
                  {w >= 560 && (
                    <text x={x(total - 1)} y={y(end) - 9} textAnchor="end" className="pf-chart-proj">
                      {fmt(end)} projected
                    </text>
                  )}
                </>
              )}

              <path d={path(pts.map((p) => p.v), 0)} fill="none" stroke="var(--brand)"
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {/* The measured end, ringed in the surface colour so it stays
                  legible where the projection leaves it. */}
              <circle cx={x(pts.length - 1)} cy={y(last)} r="4.5" fill="var(--brand)"
                stroke="var(--card)" strokeWidth="2" />

              {hover && (
                <>
                  <line x1={x(hover.i)} x2={x(hover.i)} y1={padT} y2={padT + plotH}
                    stroke="var(--ink-soft)" strokeWidth="1" opacity=".45" />
                  <circle cx={x(hover.i)} cy={y(hover.v)} r="4.5"
                    fill={hover.projected ? "var(--card)" : "var(--brand)"}
                    stroke="var(--brand)" strokeWidth="2" />
                </>
              )}
            </svg>

            {hover && (
              <div className="pf-chart-tip" style={{ left: Math.min(Math.max(x(hover.i), 70), w - 70) }}>
                <b>{fmt(hover.v)}</b>
                <span>{niceDay(hover.day)}{hover.projected ? " · projected" : ""}</span>
              </div>
            )}
          </div>

          <p className="pf-note">
            {fmt(last)} today.
            {proj.length > 0 && ` On the last ${pts.length} days' trend, ${fmt(end)} by ${niceDay(projectTo)} — a straight line through what has happened, not a forecast.`}
          </p>
        </>
      )}
    </div>
  );
}

// ---- dashboard: one period's numbers -------------------------------------
// Both sections render through this, which is what makes them comparable:
// the same metric means the same thing in both, computed the same way.
function PeriodStats({ m, finance, showSms }) {
  const signed = (c) => (c >= 0 ? "+" : "−") + fmtC(Math.abs(c));
  const pct = (r) => (r === null ? "—" : `${Math.round(r * 100)}%`);
  return (
    <div className="pf-kpis pf-kpis-period">
      <Kpi label="New accounts" value={m.signups} />
      <Kpi label="Free → paid" value={m.conversions} sub={`${pct(m.convRate)} of ${m.signups} signup${m.signups === 1 ? "" : "s"}`} />
      <Kpi label="Churned" value={m.lost} warn={m.lost > 0}
        sub={`${pct(m.churnRate)} of ${m.paidAtStart} paying at start`} />
      {finance && <Kpi label="Net new MRR" value={signed(m.netMrr)} accent />}
      {finance && <Kpi label="ARR contribution" value={signed(m.netMrr * 12)} sub="net new MRR × 12" />}
      <Kpi label="GMV" value={fmtC(m.gmv)} sub="work-order value accepted" />
      {showSms && (
        <Kpi label="SMS sent" value={m.sms.sent.toLocaleString()}
          sub={finance
            ? (m.sms.billed || m.sms.cost
              ? `${fmtC(m.sms.billed)} billed · ${fmtC(m.sms.cost)} cost`
              : "not billing for SMS yet")
            : `${m.sms.segments.toLocaleString()} segments`} />
      )}
    </div>
  );
}

// A ranked magnitude list: one hue, sorted, value in a column of its own so
// the numbers line up. Six rows at most -- past that it stops being a picture
// and wants to be a table, so the tail is counted rather than drawn.
function RankList({ rows, max, total, empty, label }) {
  if (!rows.length) return <p className="pf-note">{empty}</p>;
  const name = label || ((k) => k);
  return (
    <>
      <ol className="pf-rank">
        {rows.map(([k, n]) => (
          <li key={k}>
            <span className="pf-rank-k" title={name(k)}>{name(k)}</span>
            {/* A floor of 3% so a count of one is still a visible mark rather
                than a sliver that reads as zero. */}
            <span className="pf-rank-track"><i style={{ width: `${Math.max(3, (n / max) * 100)}%` }} /></span>
            <b className="pf-rank-n">{n}</b>
          </li>
        ))}
      </ol>
      {total > rows.length && <p className="pf-note">+{total - rows.length} more</p>}
    </>
  );
}

// Why a reset did not send, in terms of the thing to go and fix.
//
// The first version of this ended with "check the Worker log for the reason",
// which is not something the person reading it can do -- they are in a
// browser on an iPad. An error message that names a tool the reader does not
// have is the same as no message. Every branch below either says what to
// change or hands over the code and status, which is enough to identify it
// without reading a log at all.
function resetFailureText(err) {
  const code = err?.body?.error;
  const detail = err?.body?.detail;

  if (err?.body?.rateLimited) {
    return "Supabase is limiting how many of these it will send in an hour. "
      + "Wait a few minutes and try again — nothing is broken.";
  }
  if (code === "auth_not_configured") {
    return "The API has no sign-in service configured, so there is nothing to send the reset through. "
      + "SUPABASE_URL and SUPABASE_ANON_KEY need to be set on the subsub-api Worker.";
  }
  if (code === "not_found") return "That person's record no longer exists on this account.";
  if (err?.status === 403) return "This staff account is not allowed to send password resets.";
  if (err?.status === 401) return "Your console session has expired. Reload the page and sign in again.";
  if (detail) return `Supabase refused: ${detail}`;
  // Nothing useful came back, so hand over what did. A code and a status are
  // enough to identify any of these without guessing.
  return `That did not send (${code || "no error code"}${err?.status ? `, HTTP ${err.status}` : ""}).`;
}

// Every mail this account has been sent, and whether it went.
//
// email_log has recorded this since the schema was written and nothing ever
// showed it, so "did they get the email?" -- the first question support ever
// asks -- was answered by guessing. Accepted is not delivered, and the row
// says so: what it records is that the provider took it.
const MAIL_KIND = {
  password_reset: "Password reset",
  doc_request: "Document request",
  wo_issued: "Work order",
  application_received: "Application received",
};

function MailLog({ accountId, load }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { setRows(null); setOpen(false); setErr(""); }, [accountId]);

  const fetchRows = async () => {
    setErr("");
    try { setRows(await load(accountId)); }
    catch (e) { setErr(e?.body?.detail || "Could not load the mail log."); }
  };

  return (
    <div className="pf-panel">
      <div className="pf-panel-hd">
        <h3><Mail size={15} /> Email sent to this account</h3>
        <button className="pf-mini" onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && rows === null) fetchRows();
        }}>
          <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          {err && <p className="pf-host-err">{err}</p>}
          {rows === null && !err && <p className="pf-note">Loading…</p>}
          {rows && rows.length === 0 && <p className="pf-note">Nothing has been sent to this account yet.</p>}
          {rows && rows.length > 0 && (
            <>
              <div className="pf-maillog">
                {rows.map((r) => (
                  <div key={r.id} className={`pf-mail-row ${r.status === "sent" ? "" : "bad"}`}>
                    <span className="pf-mail-when">{niceWhen(r.at)}</span>
                    <span className="pf-mail-main">
                      <b>{MAIL_KIND[r.kind] || r.kind}</b>
                      <span>{r.to}</span>
                      {r.error && <em>{r.error}</em>}
                    </span>
                    <span className={`pf-host-pill t-${r.status === "sent" ? "ok" : "bad"}`}>
                      {r.status === "sent" ? "Accepted" : "Failed"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="pf-note">
                "Accepted" means the provider took it, not that it landed in an inbox — a bounce or a
                spam filter happens after this point and is not visible here.
              </p>
            </>
          )}
          <div className="form-actions">
            <button className="pf-mini" onClick={fetchRows}><RefreshCw size={13} /> Refresh</button>
          </div>
        </>
      )}
    </div>
  );
}

// What the API can actually see.
//
// The half-configured state is the one worth showing: a missing
// SUPABASE_URL breaks password resets and nothing else, because staff sign
// in through Access and the console keeps working either way. There was no
// way to tell from inside SubSub whether a setting was really there, and
// comparing a dashboard screenshot against a list of names by eye is how an
// afternoon goes -- a name one letter wrong looks exactly like a name that
// is right.
const SETUP_STATE = {
  ok: { tone: "ok", label: "Configured" },
  partial: { tone: "bad", label: "Half configured" },
  off: { tone: "off", label: "Not set up" },
};

function SetupCheck({ load }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setErr("");
    try { setData(await load()); }
    catch (e) { setErr(e?.body?.detail || e?.message || "Could not read the settings."); }
    finally { setBusy(false); }
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="pf-panel">
      <div className="pf-panel-hd">
        <h3><Shield size={15} /> API settings</h3>
        <button className="pf-mini" onClick={run} disabled={busy}>
          <RefreshCw size={13} /> {busy ? "Checking…" : "Re-check"}
        </button>
      </div>
      <p className="pf-note pf-rank-sub">
        Whether each integration is configured on the API. Names only — no values are ever read back.
      </p>

      {err && <p className="pf-host-err">{err}</p>}
      {!data && !err && <p className="pf-note">Checking…</p>}

      {data && data.groups.map((g) => {
        const st = SETUP_STATE[g.state] || SETUP_STATE.off;
        return (
          <div key={g.id} className="pf-setup">
            <div className="pf-setup-hd">
              <b>{g.label}</b>
              <span className={`pf-host-pill t-${st.tone}`}>{st.label}</span>
            </div>
            <div className="pf-setup-vars">
              {g.vars.map((v) => (
                <span key={v.name} className={v.set ? "on" : "off"}>
                  {v.set ? "✓" : "✕"} {v.name}
                </span>
              ))}
            </div>
            {/* The whole reason this screen exists. */}
            {g.vars.filter((v) => v.suggestion).map((v) => (
              <p key={v.name} className="pf-setup-hint">
                <b>{v.name}</b> is missing, but <b>{v.suggestion.name}</b> is set —
                {" "}that looks like the same name misspelled. Rename it and redeploy.
              </p>
            ))}
            {g.state !== "ok" && <p className="pf-note">{g.matters}</p>}
          </div>
        );
      })}

      {data && data.unused.length > 0 && (
        <p className="pf-note">
          Set but unread by the API: {data.unused.join(", ")}. Usually a rename left behind.
        </p>
      )}
    </div>
  );
}

// The branded address, and whether it actually answers.
//
// Nobody opens Cloudflare for this: the Worker provisions the hostname when
// an account reaches Scale and re-checks every ten minutes until the
// certificate is issued. What this panel is for is the two minutes in
// between, and the case where Cloudflare said no -- because "it's a dead
// link" reaching support before it reaches the console is how the manual
// version failed.
const HOSTNAME_STATE = {
  active:  { label: "Live",        tone: "ok",   say: "Answering, with a valid certificate." },
  pending: { label: "Setting up",  tone: "wait", say: "Registered. The certificate is usually issued within a couple of minutes." },
  failed:  { label: "Failed",      tone: "bad",  say: "Cloudflare refused. Nothing is answering at this address." },
  removed: { label: "Taken down",  tone: "off",  say: "Removed — this account is not on Scale." },
  unconfigured: { label: "Not wired up", tone: "off",
    say: "This Worker has no Cloudflare API credentials, so no hostname can be provisioned." },
};

function HostnamePanel({ account, onSync, onCheckSetup }) {
  const [busy, setBusy] = useState(false);
  const [justRan, setJustRan] = useState(null);
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);

  useEffect(() => { setJustRan(null); setDiag(null); }, [account.id]);

  const scale = account.plan === "scale";
  const status = justRan?.status || account.hostnameStatus || null;
  const err = justRan ? justRan.error : account.hostnameError;
  const state = HOSTNAME_STATE[status];
  const host = `${account.subdomain}.subsub.work`;

  const run = async () => {
    setBusy(true);
    try { setJustRan(await onSync()); }
    catch { /* the console has already said why */ }
    finally { setBusy(false); }
  };

  return (
    <div className="pf-panel pf-host">
      <div className="pf-panel-hd">
        <h3><Globe size={15} /> Branded address</h3>
        {state && <span className={`pf-host-pill t-${state.tone}`}>{state.label}</span>}
      </div>

      <p className="pf-host-url">
        {status === "active"
          ? <a href={`https://${host}`} target="_blank" rel="noreferrer">{host}</a>
          : host}
      </p>

      <p className="pf-note">
        {!scale
          ? "Reserved, not served — a branded address is a Scale feature. Moving this account to Scale sets it up automatically."
          : state
            ? state.say
            : "Not set up yet. It is created automatically within ten minutes of reaching Scale, or immediately with the button below."}
      </p>

      {/* Cloudflare's own words. A paraphrase is not something anyone can
          search for, and this is the line support will be reading out. */}
      {err && <p className="pf-host-err">{err}</p>}

      {account.hostnameCheckedAt && !justRan && (
        <p className="pf-host-when">Last checked {niceWhen(account.hostnameCheckedAt)}</p>
      )}

      {/* One message -- "Authentication failed" -- is true of four different
          mistakes, so offer the thing that tells them apart rather than
          leaving somebody to try each in turn. */}
      {diag && (
        <ul className="pf-diag">
          {diag.checks.map((ch) => (
            <li key={ch.id} className={ch.ok ? "ok" : "bad"}>
              <span className="pf-diag-mark">{ch.ok ? "✓" : "✕"}</span>
              <span className="pf-diag-body">
                <b>{ch.label}</b>
                {ch.detail && <em>{ch.detail}</em>}
              </span>
            </li>
          ))}
          {diag.checks.every((ch) => ch.ok) && (
            <li className="ok"><span className="pf-diag-mark">✓</span>
              <span className="pf-diag-body"><b>All four settings are good.</b>
                <em>Whatever failed was not the credentials — try setting it up again.</em></span></li>
          )}
        </ul>
      )}

      {scale && (
        <div className="form-actions">
          {(status === "failed" || status === "unconfigured") && (
            <button className="pf-mini" onClick={async () => {
              setDiagBusy(true);
              try { setDiag(await onCheckSetup()); }
              catch { /* the console has already said why */ }
              finally { setDiagBusy(false); }
            }} disabled={diagBusy}>
              <Shield size={13} /> {diagBusy ? "Checking…" : "Check the Cloudflare setup"}
            </button>
          )}
          <button className="pf-mini" onClick={run} disabled={busy}>
            <RefreshCw size={13} /> {busy ? "Checking…" : status === "active" ? "Re-check" : "Set it up now"}
          </button>
        </div>
      )}
    </div>
  );
}

// Scale, on the house. Distinct from simply setting the plan, because the
// two mean different things a month later: a comp survives Stripe, says who
// granted it and why, and adds nothing to MRR. Setting the plan by hand
// looks identical today and is indistinguishable from a billing fault by the
// time anyone asks.
function CompPanel({ account, onSave }) {
  const [note, setNote] = useState(account.compNote || "");
  const [busy, setBusy] = useState(false);
  const on = !!account.comped;

  // Reflect a comp granted from another browser rather than keeping ours.
  useEffect(() => { setNote(account.compNote || ""); }, [account.id, account.compNote]);

  const run = async (patch) => {
    setBusy(true);
    try { await onSave(patch); } catch { /* the console says why */ }
    finally { setBusy(false); }
  };

  return (
    <div className={`pf-panel pf-comp ${on ? "on" : ""}`}>
      <h3>{on ? "Complimentary account" : "Give this account Scale for free"}</h3>
      <p className="pf-note">
        {on
          ? "Scale features, nothing billed. This outranks Stripe: a failed card or a cancelled trial will not take it away."
          : "Grants every Scale feature and charges nothing. It survives Stripe, adds nothing to MRR, and is recorded against your name."}
      </p>

      {on ? (
        <>
          <p className="pf-comp-note"><b>Reason:</b> {account.compNote || "none recorded"}</p>
          <button className="btn-danger-outline" disabled={busy}
            onClick={() => run({ comped: false })}>
            {busy ? "Working…" : "End the comp"}
          </button>
          <p className="pf-note">
            They return to whatever they are actually paying for — Basic, unless a
            live subscription says otherwise.
          </p>
        </>
      ) : (
        <>
          <label className="fld">Why, and who agreed to it
            <input value={note} maxLength={300} disabled={busy}
              placeholder="Design partner through Q1 — agreed with RB"
              onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="btn-solid" disabled={busy || !note.trim()}
            onClick={() => run({ comped: true, compNote: note.trim() })}>
            <Zap size={15} /> {busy ? "Working…" : "Comp this account"}
          </button>
          {!note.trim() && <p className="cov-hint">A reason is required — a comp nobody can explain becomes permanent.</p>}
        </>
      )}
    </div>
  );
}

function CompanyEditFields({ co, onSave, onCancel }) {
  const [f, setF] = useState({ company: co.company, contact: co.contact, email: co.email || "",
    phone: co.phone || "", license: co.license || "", ubi: co.ubi || "", city: co.city || "", zip: co.zip || "" });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      <div className="pf-adduser pf-adduser-grid">
        <input placeholder="Company name" value={f.company} onChange={(e) => set("company", e.target.value)} />
        <input placeholder="Contact name" value={f.contact} onChange={(e) => set("contact", e.target.value)} />
        <input placeholder="Email" value={f.email} onChange={(e) => set("email", e.target.value)} />
        <input placeholder="Phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        <input placeholder="License #" value={f.license} onChange={(e) => set("license", e.target.value)} />
        <input placeholder="UBI" value={f.ubi} onChange={(e) => set("ubi", e.target.value)} />
        <input placeholder="City" value={f.city} onChange={(e) => set("city", e.target.value)} />
        <input placeholder="ZIP" value={f.zip} onChange={(e) => set("zip", e.target.value)} />
      </div>
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-solid" disabled={!f.company.trim() || !f.license.trim()} onClick={() => onSave(f)}>Save changes</button>
      </div>
    </>
  );
}

// Deleting an account or company is destructive and cross-references other
// records (memberships, engagements). Require the name typed back, the same
// pattern as most infra consoles, so it can't happen from a stray click.
function DeleteConfirmModal({ item, onConfirm, onCancel }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const match = typed.trim() === item.name;
  const noun = item.kind === "account" ? "account" : "company";
  return (
    <Modal onClose={onCancel}>
      <div className="form">
        <h2><AlertTriangle size={19} style={{ color: "var(--red)", verticalAlign: -3, marginRight: 8 }} />
          Delete this {noun}?</h2>
        <p className="form-sub">
          {item.kind === "account"
            ? "This removes the account, its team memberships, and its subcontractor engagements. Job history and documents already on file are not recoverable from here."
            : "This removes the company record and every hiring account's engagement with them. Any account currently working with this company loses that relationship."}
          {" "}This cannot be undone.
        </p>
        <label className="fld">Type <b>{item.name}</b> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        <div className="form-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-danger" disabled={!match || busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(typed.trim()); }
              catch { setBusy(false); }   // the console has already said why
            }}>
            <Trash2 size={15} /> {busy ? "Deleting…" : `Delete ${noun}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Kpi({ label, value, sub, accent, warn }) {
  return (
    <div className={`kpi ${accent ? "accent" : ""} ${warn ? "warn" : ""}`}>
      <span className="kpi-v">{value}</span>
      {/* The qualifier goes on its own line: inline, it wrapped mid-phrase
          and left the separator dangling at the end of the label. */}
      <span className="kpi-l">{label}</span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </div>
  );
}

// ---- Tenants ------------------------------------------------------------
// The first version of this handed out links for the account to send itself,
// which is fine for a handful of subcontractors and useless here: a managing
// agent has three hundred apartments and an existing list of who lives in
// them. Nobody is pasting three hundred links.
//
// So: type in who lives where, or upload the list, and SubSub sends the
// invite. Two people in one unit is normal -- a couple, roommates, a business
// and its owner -- so the unit is a label and the email is the key.

// A spreadsheet, without a spreadsheet library.
//
// CSV only, on purpose: every tool a managing agent uses exports it, Excel
// and Sheets are one menu item away from it, and the alternative is several
// hundred kilobytes of parser in the bundle to read a file with five columns
// in it. Handles quoted fields, embedded commas and quoted newlines, which is
// what actually breaks naive splitting on a real export.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const src = String(text).replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" is a literal quote
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "," || ch === "\t") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

// Match the columns somebody actually exported rather than demanding a
// template. "First Name", "first_name", "Tenant First" and "Given name" are
// all the same column, and a managing agent should not have to rename
// headers to use their own data.
const TENANT_COLUMNS = [
  { key: "firstName", match: /^(first|given)[\s_-]*(name)?$|^tenant\s*first/i },
  { key: "lastName", match: /^(last|sur|family)[\s_-]*(name)?$|^tenant\s*last/i },
  { key: "email", match: /e[\s_-]*mail/i },
  { key: "phone", match: /phone|mobile|cell|tel/i },
  { key: "unit", match: /^(unit|apt|apartment|suite|door|#)/i },
  { key: "propertyName", match: /propert|building|address|site/i },
  // One full name in one column is common enough to handle rather than
  // reject; it is split on the last space.
  { key: "fullName", match: /^(name|tenant|resident|full[\s_-]*name)$/i },
];

function mapTenantRows(rows, properties, fallbackPropertyId) {
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => String(h).trim());
  const index = {};
  header.forEach((h, i) => {
    for (const col of TENANT_COLUMNS) {
      if (col.match.test(h) && index[col.key] === undefined) { index[col.key] = i; break; }
    }
  });
  const at = (r, key) => index[key] === undefined ? "" : String(r[index[key]] ?? "").trim();
  const byName = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p.id]));

  const out = rows.slice(1).map((r, n) => {
    let firstName = at(r, "firstName"), lastName = at(r, "lastName");
    if (!firstName && !lastName) {
      const whole = at(r, "fullName");
      if (whole) {
        const bits = whole.split(/\s+/);
        lastName = bits.length > 1 ? bits.pop() : "";
        firstName = bits.join(" ");
      }
    }
    const named = at(r, "propertyName").toLowerCase();
    const propertyId = byName.get(named) || fallbackPropertyId || "";
    const email = at(r, "email").toLowerCase();
    const phone = at(r, "phone");
    const problems = [];
    if (!firstName && !lastName) problems.push("no name");
    if (!email && !phone) problems.push("no email or phone");
    if (email && !validEmail(email)) problems.push("email looks wrong");
    if (!propertyId) problems.push(named ? `no building called "${at(r, "propertyName")}"` : "no building");
    return { line: n + 2, firstName, lastName, email, phone,
      unit: at(r, "unit"), propertyId, problems };
  });
  return { header, rows: out, matched: Object.keys(index) };
}

function TenantsPane({ properties, accountKind }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState("");
  const office = tenantWhere(accountKind) === "office";
  const unitWord = office ? "Suite" : "Unit";

  const load = async () => {
    try { setRows(await api.listTenants()); setErr(""); }
    catch (e) {
      console.error("[tenants] load failed:", e);
      setRows([]);
      // The one failure worth naming precisely. Everything else is "try
      // again"; this one is a migration nobody has run, and saying so is the
      // difference between a five-second fix and an afternoon.
      setErr(/no such table|D1_ERROR/i.test(String(e?.body?.error || e?.message || ""))
        ? "The tenants tables aren't in the database yet — migrations 015 and 017 need running."
        : "Could not load your tenants.");
    }
  };
  useEffect(() => { load(); }, []);

  const shown = (rows || []).filter((t) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [t.name, t.email, t.phone, t.unit, t.propertyName]
      .some((v) => String(v || "").toLowerCase().includes(s));
  });

  const resend = async (t) => {
    setBusyId(t.userId); setNote("");
    try {
      const res = await api.resendTenantInvite(t.userId);
      setNote(sendSummary(res.sent, t.name));
      load();
    } catch (e) { console.error("[tenants] resend failed:", e); setNote("That didn't send."); }
    finally { setBusyId(null); }
  };

  const remove = async (t) => {
    setBusyId(t.userId);
    try { await api.removeTenant(t.userId); setRows((cur) => cur.filter((x) => x.userId !== t.userId)); }
    catch (e) { console.error("[tenants] remove failed:", e); setNote("Could not remove them."); }
    finally { setBusyId(null); }
  };

  if (properties.length === 0) {
    return (
      <div className="dash-empty"><Building2 size={24} />
        <p>Add a building first — a tenant has to be a tenant of something.</p>
      </div>
    );
  }

  if (adding) return (
    <TenantForm properties={properties} unitWord={unitWord}
      onCancel={() => setAdding(false)}
      onDone={(msg) => { setAdding(false); setNote(msg); load(); }} />
  );
  if (importing) return (
    <TenantImport properties={properties} unitWord={unitWord}
      onCancel={() => setImporting(false)}
      onDone={(msg) => { setImporting(false); setNote(msg); load(); }} />
  );

  return (
    <>
      <div className="jobs-head">
        <h3>{(rows || []).length} tenant{(rows || []).length === 1 ? "" : "s"}</h3>
        <div className="tn-head-actions">
          <button className="btn-ghost" onClick={() => setImporting(true)}>
            <ClipboardList size={14} /> Import a spreadsheet
          </button>
          <button className="add-btn small" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add a tenant
          </button>
        </div>
      </div>
      <p className="panel-note">
        Tenants report repairs themselves and follow what happens, on your own branded address.
        What they report lands with you to approve and assign, exactly like a building owner's
        request. They never see costs, your contractors, or anyone else's repairs.
      </p>

      {err && <p className="billing-err" role="alert">{err}</p>}
      {note && <p className="rollup-note" role="status">{note}</p>}

      {(rows || []).length > 8 && (
        <input className="tn-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, unit, building, email or phone" />
      )}

      {rows === null ? <p className="fine">Loading…</p> : rows.length === 0 ? (
        <div className="dash-empty"><Users size={24} />
          <p>No tenants yet. Add one, or import the list you already have.</p>
        </div>
      ) : (
        <div className="user-list">
          {shown.map((t) => (
            <div key={t.userId} className="user-row">
              <span className="user-avatar lg">
                {String(t.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2)}
              </span>
              <div className="user-row-main">
                <div className="user-row-head">
                  <h4>{t.name}</h4>
                  <span className={`tn-chip ${t.status === "active" ? "ok" : "wait"}`}>
                    {t.status === "active" ? "Signed in" : t.lastSentAt ? "Invite sent" : "Not sent yet"}
                  </span>
                </div>
                <p className="user-row-sub">
                  {[t.propertyName, t.unit ? `${unitWord} ${t.unit}` : null,
                    t.email && !t.email.endsWith("@no-email.invalid") ? t.email : null,
                    t.phone].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="user-row-actions">
                {t.status !== "active" && (
                  <button className="btn-notify sm" disabled={busyId === t.userId}
                    onClick={() => resend(t)}>
                    <Mail size={12} /> {busyId === t.userId ? "Sending…" : "Resend invite"}
                  </button>
                )}
                <button className="icon-x" title="Remove this tenant"
                  disabled={busyId === t.userId} onClick={() => remove(t)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// One sentence saying what actually happened to the sending, which is not
// always "sent": a number with no Twilio behind it, an address Resend
// refused. Silence here is how somebody ends up wondering for a week.
function sendSummary(sent, name) {
  const who = name ? `${name}: ` : "";
  const bits = [];
  if (sent?.email === "sent") bits.push("emailed");
  if (sent?.sms === "sent") bits.push("texted");
  if (bits.length) return `${who}invite ${bits.join(" and ")}.`;
  const why = sent?.sms === "sms_not_configured" ? "texting isn't set up yet (Twilio)"
    : sent?.email === "mail_not_configured" ? "email isn't set up yet (Resend)"
    : [sent?.email, sent?.sms].filter((x) => x && x !== "sent").join(", ") || "nothing was sent";
  return `${who}added, but the invite didn't go out — ${why}.`;
}

// Adding one by hand. Six fields, and the building is remembered between
// saves -- somebody entering a floor of apartments should not re-pick it
// fourteen times.
// Why an add failed, in words somebody can act on. "Could not add them" is
// what this said before, which is true of every failure and useful for none
// of them -- and the likeliest cause by far is a migration nobody has run.
function tenantAddError(e) {
  const code = e?.body?.error;
  if (code === "migration_needed") {
    const m = e?.body?.migration;
    return m && m !== "unknown"
      ? `The database isn't migrated yet — run ${m}.sql and try again.`
      : "The database isn't migrated yet — run the pending migrations in app/worker/migrations and try again.";
  }
  return code === "already_a_member" ? "That email address already has a different kind of account here."
    : code === "bad_email" ? "That email address doesn't look right."
    : code === "bad_phone" ? "That phone number needs 10 digits."
    : code === "contact_required" ? "Give an email address — we need somewhere to send the invite."
    : code === "property_not_found" ? "That building isn't on this account any more. Pick another."
    : code === "forbidden" ? "You don't have access to that building."
    : code === "not_a_property_account" ? "This account doesn't keep a building list, so it has no tenants."
    : "Could not add them. Try again.";
}

// Adding one by hand. The building is remembered between saves -- somebody
// entering a floor of apartments should not re-pick it fourteen times.
function TenantForm({ properties, unitWord, onCancel, onDone }) {
  const [f, setF] = useState({
    propertyId: properties.length === 1 ? properties[0].id : "",
    firstName: "", lastName: "", email: "", phone: "", unit: "",
    // Email is how a tenant gets a login at all, so it always goes. A text
    // is the one that actually gets read, and it is opt-in because it costs
    // money and not everybody has given a mobile number.
    sms: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState([]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // formatPhone and phoneDigits already exist for exactly this and are what
  // every other form here uses; a second pair would be a second answer to
  // "what counts as a phone number".
  const digits = phoneDigits(f.phone).length;
  const phoneOk = digits === 10;
  const phoneStarted = digits > 0;
  const ready = f.propertyId && (f.firstName.trim() || f.lastName.trim())
    && validEmail(f.email.trim())
    // Half a phone number is a mistake, not an omission: either give one or
    // leave it blank.
    && (!phoneStarted || phoneOk)
    && (!f.sms || phoneOk);

  const save = async (andAnother) => {
    setBusy(true); setErr("");
    try {
      const res = await api.addTenant({
        propertyId: f.propertyId, firstName: f.firstName.trim(), lastName: f.lastName.trim(),
        email: f.email.trim(), phone: f.phone.trim(), unit: f.unit.trim(),
        channels: ["email", ...(f.sms && phoneOk ? ["sms"] : [])],
      });
      const line = sendSummary(res.sent, res.name);
      if (andAnother) {
        setSaved((s) => [line, ...s]);
        // The building and the unit stay: the next tenant is usually the
        // other person in the same apartment, or the one next door.
        setF((x) => ({ ...x, firstName: "", lastName: "", email: "", phone: "", sms: false }));
      } else onDone(line);
    } catch (e) {
      console.error("[tenants] add failed:", e);
      setErr(tenantAddError(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="form">
      <h2>Add a tenant</h2>
      <p className="form-sub prose">
        They'll get an invite by email, and by text as well if you tick it. Two people in
        one {unitWord.toLowerCase()} is fine: add them one at a time.
      </p>

      <label className="fld">Building
        <select value={f.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
          <option value="">Choose…</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="fld-row">
        <label className="fld">First name
          <input value={f.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Rosa" />
        </label>
        <label className="fld">Last name
          <input value={f.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Lane" />
        </label>
      </div>
      <div className="fld-row">
        <label className="fld">Email
          <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)}
            placeholder="rosa@example.com" />
        </label>
        <label className="fld">Cell phone <span className="fld-note">for texts</span>
          <input type="tel" inputMode="numeric" value={f.phone}
            onChange={(e) => set("phone", formatPhone(e.target.value))}
            placeholder="(206)555-0134" />
          {phoneStarted && !phoneOk && (
            <span className="fld-warn">10 digits — {digits} so far.</span>
          )}
        </label>
      </div>
      <div className="fld-row">
        <label className="fld">{unitWord} number
          <input value={f.unit} onChange={(e) => set("unit", e.target.value)}
            placeholder={unitWord === "Suite" ? "300" : "4B"} />
        </label>
        {/* The other half of the row, so the unit box is the width of a
            field rather than the width of the screen. */}
        <div className="fld fld-spacer" aria-hidden="true" />
      </div>

      <div className="fld">Send the invite by
        <div className="tn-channels">
          <label className="tn-channel is-fixed">
            <input type="checkbox" checked readOnly disabled />
            <span>Email <b>always</b></span>
          </label>
          <label className={`tn-channel ${phoneOk ? "" : "is-off"}`}>
            <input type="checkbox" checked={f.sms && phoneOk} disabled={!phoneOk}
              onChange={(e) => set("sms", e.target.checked)} />
            <span>Text message{phoneOk ? "" : " — needs a cell phone"}</span>
          </label>
        </div>
        <p className="fld-hint">
          Email carries the link they set a password with, so it always goes. A text is the one
          that gets read.
        </p>
      </div>

      {err && <p className="billing-err" role="alert">{err}</p>}
      {saved.length > 0 && (
        <div className="tn-saved">
          {saved.map((line, i) => <p key={i}><Check size={13} /> {line}</p>)}
        </div>
      )}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>
          {saved.length ? "Done" : "Cancel"}
        </button>
        <button className="btn-ghost" onClick={() => save(true)} disabled={!ready || busy}>
          Save &amp; add another
        </button>
        <button className="btn-solid" onClick={() => save(false)} disabled={!ready || busy}>
          <Plus size={15} /> {busy ? "Adding…" : "Add & invite"}
        </button>
      </div>
    </div>
  );
}

// Three hundred of them, from the list the account already keeps.
//
// The file is read and checked in the browser, shown back row by row, and
// only then sent -- in batches, because one request carrying three hundred
// invites is one request that times out halfway and leaves nobody able to say
// which half went.
function TenantImport({ properties, unitWord, onCancel, onDone }) {
  const [parsed, setParsed] = useState(null);
  const [fallback, setFallback] = useState(properties.length === 1 ? properties[0].id : "");
  const [raw, setRaw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [progress, setProgress] = useState(0);

  const take = (text) => {
    const rows = parseCsv(text);
    setRaw(rows);
    setParsed(mapTenantRows(rows, properties, fallback));
  };
  // Re-map when the fallback building changes, so picking one fixes every
  // row that had nothing to match on at once.
  useEffect(() => { if (raw) setParsed(mapTenantRows(raw, properties, fallback)); }, [fallback]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    take(await file.text());
  };

  const good = (parsed?.rows || []).filter((r) => !r.problems.length);
  const bad = (parsed?.rows || []).filter((r) => r.problems.length);

  const send = async () => {
    setBusy(true); setProgress(0);
    const results = [];
    for (let i = 0; i < good.length; i += 25) {
      const batch = good.slice(i, i + 25).map((r) => ({
        propertyId: r.propertyId, firstName: r.firstName, lastName: r.lastName,
        email: r.email, phone: r.phone, unit: r.unit,
      }));
      try {
        const res = await api.addTenantsBulk(batch);
        results.push(...(res.results || []));
      } catch (err) {
        console.error("[tenants] batch failed:", err);
        results.push(...batch.map(() => ({ ok: false, error: "failed" })));
      }
      setProgress(Math.min(good.length, i + 25));
    }
    setBusy(false);
    setDone(results);
  };

  if (done) {
    const added = done.filter((r) => r.ok).length;
    const emailed = done.filter((r) => r.sent?.email === "sent").length;
    const texted = done.filter((r) => r.sent?.sms === "sent").length;
    const failed = done.filter((r) => !r.ok);
    return (
      <div className="form">
        <h2>Imported</h2>
        <p className="form-sub">
          {added} tenant{added === 1 ? "" : "s"} added. {emailed} emailed, {texted} texted.
        </p>
        {failed.length > 0 && (
          <>
            <p className="billing-err">{failed.length} row{failed.length === 1 ? "" : "s"} didn't go in.</p>
            <ul className="fine tn-problems">
              {failed.slice(0, 20).map((r, i) => <li key={i}>{r.error}</li>)}
            </ul>
          </>
        )}
        <div className="form-actions">
          <button className="btn-solid" onClick={() => onDone(
            `Imported ${added} tenant${added === 1 ? "" : "s"}.`)}>Back to tenants</button>
        </div>
      </div>
    );
  }

  return (
    <div className="form">
      <h2>Import tenants</h2>
      <p className="form-sub prose">
        A CSV from whatever you already use. Export it from Excel or Google Sheets with
        <b> Save as CSV</b>. Columns can be named however yours are named — first name, last name,
        email, phone, {unitWord.toLowerCase()}, building — and anything we can't match, you'll see
        before anything is sent.
      </p>

      <label className="fld">The file
        <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} />
      </label>
      {properties.length > 1 && (
        <label className="fld">If a row doesn't name a building, use
          <select value={fallback} onChange={(e) => setFallback(e.target.value)}>
            <option value="">Nothing — flag those rows</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      {parsed && (
        <>
          <p className="rollup-note">
            {good.length} row{good.length === 1 ? "" : "s"} ready
            {bad.length > 0 && `, ${bad.length} need${bad.length === 1 ? "s" : ""} a look`}.
            {parsed.matched?.length
              ? ` Matched columns: ${parsed.matched.join(", ")}.`
              : " No columns matched — check the first row has headers."}
          </p>
          {bad.length > 0 && (
            <ul className="fine tn-problems">
              {bad.slice(0, 12).map((r) => (
                <li key={r.line}>
                  Line {r.line}: {[r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)"}
                  {" — "}{r.problems.join(", ")}
                </li>
              ))}
              {bad.length > 12 && <li>…and {bad.length - 12} more.</li>}
            </ul>
          )}
          {good.length > 0 && (
            <div className="tn-preview">
              {good.slice(0, 6).map((r) => (
                <div key={r.line} className="tn-preview-row">
                  <b>{[r.firstName, r.lastName].filter(Boolean).join(" ")}</b>
                  <span>{[properties.find((p) => p.id === r.propertyId)?.name,
                    r.unit ? `${unitWord} ${r.unit}` : null, r.email || r.phone]
                    .filter(Boolean).join(" · ")}</span>
                </div>
              ))}
              {good.length > 6 && <p className="fine">…and {good.length - 6} more.</p>}
            </div>
          )}
        </>
      )}

      {busy && <p className="rollup-note">Sending… {progress} of {good.length}.</p>}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-solid" onClick={send} disabled={!good.length || busy}>
          <Plus size={15} /> {busy ? "Importing…" : `Add & invite ${good.length || ""}`.trim()}
        </button>
      </div>
    </div>
  );
}

// ---- Tenant sign-up ------------------------------------------------------
// What somebody holding a tenant link sees, before they have any account at
// all. Wears the building manager's branding, because the letter or the
// noticeboard it came from had their name on it and arriving at a stranger's
// login is how a link gets ignored.
//
// Three questions and no more. A tenant is not applying for anything; they
// are being told where to report a broken boiler.
function TenantSignup({ invite, error, onSubmit, onBackToLogin }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");

  // Until the lookup lands there is no branding to wear, so the page stays
  // blank rather than flashing SubSub's own and then repainting.
  if (!invite && !error) {
    return <div className="wl-page"><div className="wl-card wl-done"><p>Loading…</p></div></div>;
  }

  if (error) {
    return (
      <div className="wl-page">
        <div className="wl-card wl-done">
          <div className="wl-tick warn"><AlertTriangle size={30} /></div>
          <h1>This link doesn't work</h1>
          <p>{error}</p>
          <button className="wl-btn" onClick={onBackToLogin}>Go to sign in</button>
        </div>
        <PoweredBy className="wl-foot" height={15} />
      </div>
    );
  }

  const acct = invite.account;
  const brand = {
    id: acct.id, name: acct.name, subdomain: acct.subdomain,
    logoData: acct.logoKey ? logoUrl(acct.id) : null,
    useDefaultMark: acct.useDefaultMark, theme: acct.theme,
  };
  const t = themeOf(brand);
  const office = tenantWhere(acct.kind) === "office";
  const place = [invite.propertyName, invite.unit ? `${office ? "Suite" : "Unit"} ${invite.unit}` : null]
    .filter(Boolean).join(", ");
  const ready = password.length >= 8;

  const go = async () => {
    setBusy(true); setErr("");
    try {
      const res = await onSubmit({ password });
      setDone(res);
    } catch (e) {
      console.error("[tenant-signup] failed:", e);
      const code = e?.body?.error;
      setErr(code === "weak_password" ? "Use at least 8 characters."
        : code === "no_email_on_file" ? "There's no email address on your record, so there's nothing to sign in with. Ask your building manager to add one."
        : code === "rate_limited" ? "Too many attempts from this connection. Wait an hour and try again."
        : "That didn't go through. Try again in a moment.");
    } finally { setBusy(false); }
  };

  if (done) return (
    <div className="wl-page" style={themeVars(t)}>
      <div className="wl-card wl-done">
        <div className="wl-brand"><BrandMark brand={brand} height={30} />
          <span className="wl-brand-name">{brand.name}</span></div>
        <div className="wl-tick"><CheckCircle2 size={34} /></div>
        <h1>{done.existed ? "You already have a login." : "You're all set."}</h1>
        <p>{done.existed
          ? <>This email address already has a password here. Sign in with the one you have — or use <b>Forgot password?</b> on the sign-in page.</>
          : done.needsConfirmation
          ? <>Check <b>{done.email}</b> for a message confirming your address. After that you can sign in and report anything that needs fixing.</>
          : <>Sign in with <b>{done.email}</b> and the password you just chose, and you can report anything that needs fixing at {place || "your building"}.</>}</p>
        <button className="wl-btn" onClick={onBackToLogin}>Go to sign in</button>
      </div>
      <PoweredBy className="wl-foot" height={15} />
    </div>
  );

  return (
    <div className="wl-page" style={themeVars(t)}>
      <div className="wl-card">
        <div className="wl-brand"><BrandMark brand={brand} height={30} />
          <span className="wl-brand-name">{brand.name}</span></div>
        <h1>{invite.firstName ? `Hi ${invite.firstName} — ` : ""}choose a password</h1>
        <p className="wl-sub">
          {brand.name} has set you up to report repairs at {place || "your building"}.
          {needsEmail ? " Give us an email address and pick a password, and you're in." : " Pick a password and you're in."} After that you can report anything that needs fixing
          and see what's happening with it, without calling anybody.
        </p>

        {needsEmail && (
          <label className="wl-fld">Your email address
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email" placeholder="you@example.com" />
            <span className="wl-opt">This is what you'll sign in with.</span>
          </label>
        )}
        <label className="wl-fld">Password
          <input type={show ? "text" : "password"} value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </label>
        <button type="button" className="wl-reveal" onClick={() => setShow((v) => !v)}>
          {show ? "Hide" : "Show"} password
        </button>

        {err && <p className="wl-err" role="alert">{err}</p>}
        <button className="wl-btn" onClick={go} disabled={!ready || busy}>
          {busy ? "Setting you up…" : "Set my password"}
        </button>
        <p className="wl-fine">
          You'll only ever see what you report yourself. Nobody else's repairs, and none of
          {" "}{brand.name}'s own records.
        </p>
      </div>
      <PoweredBy className="wl-foot" height={15} />
    </div>
  );
}

// ---- Tenant portal -------------------------------------------------------
// The whole of what a tenant sees. Not a cut-down version of the account's
// screen: somebody reporting a broken boiler is not managing a portfolio, and
// a dashboard with four of its five panels hidden reads as a thing that is
// missing rather than a thing that is finished.
//
// Two jobs, in this order: report something, and find out what happened to
// what you reported. Everything else is left out on purpose -- no costs, no
// contractor directory, and none of the building's other work.

// What a tenant is told, and when. The account's own vocabulary is not much
// use here: "requested_by set, approved_at null, no work orders issued" is
// four states to somebody running the building and one sentence to the person
// waiting in the apartment.
function tenantStage(job) {
  if (job.status === "completed") return { key: "done", label: "Done", tone: "ok" };
  const assigned = Object.values(job.assignments || {});
  const accepted = assigned.filter((a) => a.status === "accepted" || a.auto);
  if (accepted.length) {
    return { key: "booked", label: job.date ? "Scheduled" : "Contractor assigned", tone: "ok" };
  }
  if (assigned.length) return { key: "arranging", label: "Finding a time", tone: "busy" };
  if (job.requestedBy && !job.approvedAt) return { key: "sent", label: "With the manager", tone: "wait" };
  return { key: "approved", label: "Approved — arranging a contractor", tone: "busy" };
}

// The trades a tenant would actually name, in the words they would use. The
// account's full list runs to thirty and includes excavation and coping,
// which is not a menu to hand somebody whose faucet is dripping.
// What a tenant would actually say, in the words they would say it in.
//
// The first version of this listed trades -- "Plumbing", "HVAC" -- which is
// how the account thinks and not how anybody else does. Nobody standing in a
// apartment with water coming through the ceiling picks "restoration". They say
// the sink is leaking, so that is what the list says, and the trade is
// worked out from it behind the scenes.
//
// `where` splits the two kinds of building: an office tenant has no bath to
// report and an apartment has no server room. "both" covers the things that go
// wrong in either.
//
// `trade` is what gets attached to the job so it can be matched to a
// subcontractor. null means nobody can tell from the description alone, and
// the account picks when they approve it -- better than guessing wrong and
// sending the request to a plumber because the list had to say something.
const TENANT_PROBLEMS = [
  // ---- Water, drains and plumbing ----
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "My sink is leaking" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "There's water under the sink" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "A faucet is dripping" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "A faucet won't shut off" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "My toilet won't stop running" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "My toilet is clogged" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "My toilet won't flush" },
  { g: "Water & plumbing", trade: "plumbing", where: "home", label: "The shower has no water pressure" },
  { g: "Water & plumbing", trade: "plumbing", where: "home", label: "The tub or shower won't drain" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "The sink is draining slowly" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "I have no hot water" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "I have no water at all" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "A pipe is leaking" },
  { g: "Water & plumbing", trade: "plumbing", where: "home", label: "My garbage disposal isn't working" },
  { g: "Water & plumbing", trade: "plumbing", where: "home", label: "My washer hookup is leaking" },
  { g: "Water & plumbing", trade: "plumbing", where: "home", label: "My dishwasher is leaking" },
  { g: "Water & plumbing", trade: "plumbing", where: "both", label: "There's a sewer smell from the drains" },
  { g: "Water & plumbing", trade: "plumbing", where: "office", label: "A restroom needs attention" },
  { g: "Water & plumbing", trade: "plumbing", where: "office", label: "The break room sink is clogged" },

  // ---- Heating and cooling ----
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "I have no heat" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "The heat is on too high and I can't turn it down" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "The AC is on too low — it's freezing" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "The AC isn't working" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "The AC is blowing warm air" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "The thermostat isn't responding" },
  { g: "Heating & cooling", trade: "hvac", where: "home", label: "A radiator or baseboard heater is cold" },
  { g: "Heating & cooling", trade: "hvac", where: "home", label: "A radiator is leaking" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "It's too cold in here" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "It's too warm in here" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "The vents are noisy" },
  { g: "Heating & cooling", trade: "hvac", where: "both", label: "There's a smell when the heat comes on" },
  { g: "Heating & cooling", trade: "hvac", where: "office", label: "The AC runs all night" },
  { g: "Heating & cooling", trade: "hvac", where: "office", label: "The server room is overheating" },

  // ---- Electrical ----
  { g: "Electrical", trade: "electrical", where: "both", label: "An outlet has stopped working" },
  { g: "Electrical", trade: "electrical", where: "both", label: "There's no power in one room" },
  { g: "Electrical", trade: "electrical", where: "both", label: "The breaker keeps tripping" },
  { g: "Electrical", trade: "electrical", where: "both", label: "A light has gone out" },
  { g: "Electrical", trade: "electrical", where: "both", label: "The lights keep flickering" },
  { g: "Electrical", trade: "electrical", where: "both", label: "A light fixture is hanging loose" },
  { g: "Electrical", trade: "electrical", where: "home", label: "The smoke detector keeps chirping" },
  { g: "Electrical", trade: "electrical", where: "home", label: "The buzzer or intercom isn't working" },
  { g: "Electrical", trade: "electrical", where: "home", label: "The exhaust fan isn't working" },
  { g: "Electrical", trade: "electrical", where: "home", label: "The garbage disposal has no power" },
  { g: "Electrical", trade: "electrical", where: "office", label: "The lighting in the open area is out" },
  { g: "Electrical", trade: "electrical", where: "both", label: "There's a burning smell from an outlet" },

  // ---- Doors, windows and locks ----
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "My door won't lock" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "My door won't close properly" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "I'm locked out" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "My key or fob has stopped working" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "A window won't open" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "A window won't close" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "There's broken glass" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "There's a draft around a window" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "home", label: "The screen is torn or missing" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "both", label: "The main entry door isn't closing" },
  { g: "Doors, windows & locks", trade: "windows_doors", where: "office", label: "A conference room door won't lock" },

  // ---- Walls, ceilings and floors ----
  { g: "Walls, ceilings & floors", trade: "roofing", where: "both", label: "Water is dripping from the ceiling" },
  { g: "Walls, ceilings & floors", trade: "drywall", where: "both", label: "There's a water stain on the wall or ceiling" },
  { g: "Walls, ceilings & floors", trade: "restoration", where: "both", label: "There's mold" },
  { g: "Walls, ceilings & floors", trade: "drywall", where: "both", label: "There's a crack in the wall or ceiling" },
  { g: "Walls, ceilings & floors", trade: "drywall", where: "both", label: "There's a hole that needs patching" },
  { g: "Walls, ceilings & floors", trade: "painting", where: "both", label: "The paint is peeling" },
  { g: "Walls, ceilings & floors", trade: "flooring", where: "both", label: "The floor is damaged" },
  { g: "Walls, ceilings & floors", trade: "flooring", where: "both", label: "The carpet is lifting or torn" },
  { g: "Walls, ceilings & floors", trade: "tile_stone", where: "both", label: "A tile is loose or cracked" },
  { g: "Walls, ceilings & floors", trade: "restoration", where: "both", label: "There's damage after a leak" },

  // ---- Cabinets and fixtures ----
  { g: "Cabinets & fixtures", trade: "cabinets_counters", where: "both", label: "A cabinet door has come off" },
  { g: "Cabinets & fixtures", trade: "cabinets_counters", where: "home", label: "The countertop is damaged" },
  { g: "Cabinets & fixtures", trade: "trim_carpentry", where: "home", label: "A closet rod or shelf has pulled out of the wall" },
  { g: "Cabinets & fixtures", trade: "trim_carpentry", where: "both", label: "A door knob or handle has come off" },
  { g: "Cabinets & fixtures", trade: "trim_carpentry", where: "both", label: "Baseboard or trim has come loose" },

  // ---- Outside and common areas ----
  { g: "Outside & common areas", trade: "electrical", where: "both", label: "A light in the hallway or common area is out" },
  { g: "Outside & common areas", trade: "cleaning", where: "both", label: "The common areas need cleaning" },
  { g: "Outside & common areas", trade: "cleaning", where: "home", label: "The trash or recycling area needs attention" },
  { g: "Outside & common areas", trade: "gutters", where: "both", label: "The gutter is overflowing" },
  { g: "Outside & common areas", trade: "roofing", where: "both", label: "The roof is leaking" },
  { g: "Outside & common areas", trade: "landscaping", where: "both", label: "The landscaping needs attention" },
  { g: "Outside & common areas", trade: "garage_doors", where: "both", label: "The parking gate isn't working" },
  { g: "Outside & common areas", trade: "masonry", where: "both", label: "There's damage to the brickwork or siding" },
  { g: "Outside & common areas", trade: null, where: "both", label: "The elevator isn't working" },
  { g: "Outside & common areas", trade: "cleaning", where: "office", label: "The cleaning crew missed an area" },

  // ---- Anything else ----
  // No trade: nobody can tell from "something else" what it needs, and the
  // account works it out when they read it.
  { g: "Something else", trade: null, where: "both", label: "Something else — I'll describe it" },
];

// The groups, in the order they are offered. Derived rather than written out
// twice, so adding a problem to a new group cannot leave the group unlisted.
const tenantGroups = (where) => {
  const seen = [];
  for (const p of TENANT_PROBLEMS) {
    if (p.where !== "both" && p.where !== where) continue;
    if (!seen.includes(p.g)) seen.push(p.g);
  }
  return seen;
};

// An office tenant has no bathtub to report and an apartment has no server room. The
// account type is the only signal there is -- a commercial portfolio is
// offices, everything else is treated as homes -- and it only decides what is
// offered first, never what can be said, since the description is free text.
const tenantWhere = (accountKind) => accountKind === "portfolio_manager" ? "office" : "home";

// When it started. Four answers rather than a date, because "a couple of
// weeks ago" is the true answer and a date picker forces somebody to invent
// a precise one -- and it is the difference between urgent and not.
const TENANT_WHEN = [
  { id: "today", label: "Today" },
  { id: "days", label: "A few days ago" },
  { id: "weeks", label: "A week or two ago" },
  { id: "longer", label: "Longer than that" },
];

function TenantPortal({ me, brand, jobs, properties, unit, accountKind, onReport }) {
  // null until they start. `group` and `query` are how the list of eighty
  // things gets down to the six worth reading: pick the area, or type a word.
  const [form, setForm] = useState(null);
  const [sent, setSent] = useState(false);
  const mine = [...jobs].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const building = properties[0] || null;
  const where = tenantWhere(accountKind);
  const forHere = TENANT_PROBLEMS.filter((x) => x.where === "both" || x.where === where);

  const start = () => setForm({
    propertyId: building?.id || "", group: "", query: "",
    problem: null, title: "", when: "", scope: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // What they picked IS the title. Copying it into the box below as well
  // showed the same sentence twice in a row and made people wonder which one
  // counted; now the box is empty and only used by somebody who wants to say
  // it differently.
  const pick = (problem) => setForm((f) => ({ ...f, problem, query: "" }));
  const titleOf = (f) => (f.title.trim() || f.problem?.label || "");

  const q = (form?.query || "").trim().toLowerCase();
  // Browsing respects the split -- an apartment has no server room to scroll past.
  // Searching does not: one management company's portfolio can hold both an
  // apartment building and a strip of storefronts, and somebody who types
  // "server" has said which one they are in more clearly than the account
  // type ever could.
  const matches = q
    ? TENANT_PROBLEMS.filter((x) => x.label.toLowerCase().includes(q) || x.g.toLowerCase().includes(q))
    : form?.group ? forHere.filter((x) => x.g === form.group)
    : [];

  // Nothing to type: picking something is enough to send it.
  const ready = form && form.propertyId && form.problem;

  const submit = () => {
    const at = properties.find((p) => p.id === form.propertyId);
    const when = TENANT_WHEN.find((w) => w.id === form.when);
    const title = titleOf(form);
    onReport({
      title,
      propertyId: form.propertyId,
      // No trade when it cannot be told from the description; the account
      // decides on approval rather than the list guessing.
      trades: form.problem.trade ? [form.problem.trade] : [],
      address: at?.address || "",
      area: at?.city || "",
      zip: at?.zip || "",
      // Everything the person doing the work needs and nowhere else to put
      // it: which unit, what they picked, when it started, and their own
      // words -- in that order, because that is the order it gets read in.
      scope: [
        unit ? `Unit ${unit}.` : null,
        form.problem.label !== title ? `Reported as: ${form.problem.label}.` : null,
        when ? `Started: ${when.label.toLowerCase()}.` : null,
        form.scope.trim(),
      ].filter(Boolean).join(" "),
    });
    setForm(null);
    setSent(true);
  };

  if (form) return (
    <main className="ss-main tn-main">
      <div className="form tn-form">
        <h2>Report a problem</h2>
        <p className="form-sub prose">
          This goes to {brand.name}. They arrange the repair and you can follow it here.
        </p>

        {properties.length > 1 && (
          <label className="fld">Which building
            <select value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
              <option value="">Choose…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}

        {/* Chosen, and done with -- shown as a line they can change rather
            than eighty buttons they have to scroll past to reach the rest of
            the form. */}
        {form.problem ? (
          <div className="fld">What is it?
            <div className="tn-chosen">
              <span>{form.problem.label}</span>
              <button type="button" className="tn-change"
                onClick={() => setForm((f) => ({ ...f, problem: null, group: "", query: "" }))}>
                Change
              </button>
            </div>
          </div>
        ) : (
          <div className="fld">What is it?
            <input className="tn-search" value={form.query}
              onChange={(e) => set("query", e.target.value)}
              placeholder="Type what's wrong — 'toilet', 'no heat', 'window'" />

            {/* Nothing typed and no area chosen: offer the areas. Six big
                targets beats eighty small ones on a phone. */}
            {!q && !form.group && (
              <div className="tn-groups">
                {tenantGroups(where).map((g) => (
                  <button key={g} type="button" className="tn-group" onClick={() => set("group", g)}>
                    {g}
                  </button>
                ))}
              </div>
            )}

            {(q || form.group) && (
              <>
                {form.group && !q && (
                  <button type="button" className="tn-back" onClick={() => set("group", "")}>
                    ← All areas
                  </button>
                )}
                <div className="tn-picks">
                  {matches.map((x) => (
                    <button key={`${x.g}-${x.label}`} type="button" className="tn-pick"
                      onClick={() => pick(x)}>
                      <span className="tn-pick-l">{x.label}</span>
                      {q && <span className="tn-pick-h">{x.g}</span>}
                    </button>
                  ))}
                </div>
                {matches.length === 0 && (
                  <p className="fine">
                    Nothing matches that. Pick <b>Something else</b> below and describe it in
                    your own words — it goes to the same place.
                  </p>
                )}
                {q && (
                  <button type="button" className="tn-back" onClick={() => set("query", "")}>
                    ← Back to the list
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {form.problem && (
          <>
            <label className="fld">Want to put it differently?
              <input value={form.title} onChange={(e) => set("title", e.target.value)}
                placeholder={form.problem.label} />
              <span className="fld-note">Optional — leave it and we'll use what you picked.</span>
            </label>

            <div className="fld">When did it start?
              <div className="tn-when">
                {TENANT_WHEN.map((w) => (
                  <button key={w.id} type="button"
                    className={`pick ${form.when === w.id ? "on" : ""}`}
                    onClick={() => set("when", form.when === w.id ? "" : w.id)}>{w.label}</button>
                ))}
              </div>
            </div>

            <label className="fld">Tell us more, in your own words
              <textarea rows={5} value={form.scope} onChange={(e) => set("scope", e.target.value)}
                placeholder="Where exactly it is, whether it's getting worse, whether anything has been done about it before, and when someone can get in." />
            </label>
          </>
        )}

        <div className="form-actions">
          <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn-solid" onClick={submit} disabled={!ready}>
            <Plus size={15} /> Send it
          </button>
        </div>
      </div>
    </main>
  );

  return (
    <main className="ss-main tn-main">
      <div className="tn-hello">
        <h2>Hello, {me.name.split(" ")[0]}</h2>
        <p>
          {building ? building.name : "Your building"}
          {unit ? ` · Unit ${unit}` : ""}
        </p>
      </div>

      {sent && (
        <div className="tn-sent" role="status">
          <CheckCircle2 size={16} />
          <span>Sent to {brand.name}. You'll see it below, and it will update as they get on with it.</span>
        </div>
      )}

      <button className="tn-cta" onClick={start}>
        <Plus size={18} /> Report a problem
      </button>

      <h3 className="tn-h3">{mine.length ? "What you've reported" : ""}</h3>
      {mine.length === 0 ? (
        <div className="dash-empty">
          <ClipboardList size={24} />
          <p>Nothing reported yet. When you do, it will show up here with where it has got to.</p>
        </div>
      ) : (
        <div className="tn-list">
          {mine.map((j) => {
            const st = tenantStage(j);
            const who = Object.values(j.assignments || {})
              .map((a) => a.subId).filter(Boolean);
            return (
              <div key={j.id} className="tn-row">
                <div className="tn-row-main">
                  <div className="tn-row-title">{j.title}</div>
                  <span className="tn-row-meta">
                    Reported {j.createdAt ? niceDay(j.createdAt) : "recently"}
                    {j.date ? ` · booked for ${niceDay(j.date)}` : ""}
                    {who.length ? " · a contractor is assigned" : ""}
                  </span>
                </div>
                <span className={`tn-chip ${st.tone}`}>{st.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

// ---- Properties (portfolio / property managers) -------------------------
// Vendors can be scoped to specific properties. A vendor with none listed is
// treated as available across the whole account, which is how a GC uses it.
function PropertiesView({ properties, subs, jobs, onAdd, onPatch, onRemove, onOpenSub, onNewJob, onScopeVendor, newAt, canManage = true, asOwner = false }) {
  const [form, setForm] = useState(null);   // null | {} | property
  const [assigning, setAssigning] = useState(null);   // the property whose vendor list is open
  const vendorsFor = (pid) => subs.filter((s) => (s.propertyIds || []).includes(pid));
  const unscoped = subs.filter((s) => !(s.propertyIds || []).length);
  const jobsFor = (pid) => jobs.filter((j) => j.propertyId === pid);

  // "Add -> Property" in the header lands here. Guarded on 0 so arriving at
  // the tab normally does not spring a form open.
  useEffect(() => { if (newAt) setForm({}); }, [newAt]);

  if (form) return (
    <main className="ss-main">
      <PropertyForm existing={form.id ? form : null}
        onSubmit={(p) => { form.id ? onPatch(form.id, p) : onAdd(p); setForm(null); }}
        onCancel={() => setForm(null)} />
    </main>
  );

  // Attach vendors from the building's side. The same scoping is editable from
  // a vendor's own record; this is the direction someone running a portfolio
  // actually thinks in — "who works this building?"
  if (assigning) {
    const here = (s) => (s.propertyIds || []).includes(assigning.id);
    return (
      <main className="ss-main">
        <div className="portal-panel settings-panel">
          <h4>Vendors at {assigning.name}</h4>
          <p className="panel-note">
            Tick the vendors who work this building. A vendor scoped to nothing is
            available at every property on the account, so leaving everyone
            unticked is the same as leaving it open.
          </p>
          {subs.length === 0 ? (
            <p className="prop-none">No vendors on this account yet.</p>
          ) : (
            <div className="picks">
              {subs.map((s) => (
                <button key={s.id} type="button"
                  className={`pick ${here(s) ? "on" : ""}`}
                  onClick={() => onScopeVendor(s, assigning.id, !here(s))}>
                  {s.company}
                  {!docsComplete(s) && <AlertTriangle size={11} />}
                </button>
              ))}
            </div>
          )}
          <p className="cov-hint">
            {subs.filter(here).length} of {subs.length} scoped here.
          </p>
          <div className="form-actions">
            <button className="btn-solid" onClick={() => setAssigning(null)}>
              <Check size={15} /> Done
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ss-main">
      <div className="dash-hello">
        <div>
          <h2>{canManage ? "Properties" : "Your buildings"}</h2>
          <p>{properties.length === 0
            ? (canManage
                ? "Add the buildings you manage, then scope vendors to them."
                : asOwner
                ? "Nobody has given you access to a building yet."
                : "No buildings have been assigned to you to manage yet.")
            : `${properties.length} propert${properties.length === 1 ? "y" : "ies"} · ${
                properties.reduce((n, p) => n + (Number(p.units) || 0), 0)} units`}</p>
        </div>
        {/* A building owner does not run the portfolio: the buildings are
            added, edited and removed by whoever manages them, and the server
            refuses all three from this seat anyway. */}
        {canManage && (
          <button className="add-btn small" onClick={() => setForm({})}>
            <Plus size={14} /> New property
          </button>
        )}
      </div>

      {canManage && unscoped.length > 0 && properties.length > 0 && (
        <p className="rollup-note">
          {unscoped.length === 1
            ? "1 vendor isn't scoped to a property, so they're available at all of them."
            : `${unscoped.length} vendors aren't scoped to a property, so they're available at all of them.`}
        </p>
      )}

      {properties.length === 0 ? (
        <div className="dash-empty"><Building2 size={24} />
          <p>{canManage
            ? "No properties yet. Add one and you can give it its own vendor list."
            : asOwner
            ? "No buildings have been shared with you. Whoever manages them can grant access."
            : "No buildings have been assigned to you. Whoever owns them can grant access."}</p>
          {canManage && <button className="btn-solid" onClick={() => setForm({})}>Add a property</button>}
        </div>
      ) : (
        <div className="prop-grid">
          {properties.map((p) => {
            const vs = vendorsFor(p.id);
            const js = jobsFor(p.id);
            const open = js.filter((j) => j.status !== "completed").length;
            return (
              <div key={p.id} className="prop-card">
                <div className="prop-top">
                  <div>
                    <h3>{p.name}</h3>
                    <span className="prop-addr">
                      {[p.address, p.city, p.state, p.zip].filter(Boolean).join(", ")}
                    </span>
                  </div>
                  {canManage && (
                    <div className="prop-actions">
                      <button className="edit-btn" onClick={() => setForm(p)}><Pencil size={13} /> Edit</button>
                      <button className="icon-x" title="Remove property"
                        onClick={() => onRemove(p.id)}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>

                <div className="prop-stats">
                  <span><strong>{p.units || "—"}</strong> units</span>
                  {canManage && <span><strong>{vs.length}</strong> assigned vendor{vs.length === 1 ? "" : "s"}</span>}
                  <span><strong>{open}</strong> open job{open === 1 ? "" : "s"}</span>
                </div>

                {/* The vendor list is the account's roster and its compliance
                    state. An owner sees who is coming to their own jobs, in
                    the job itself -- not who else is on the books. */}
                {!canManage ? null : vs.length > 0 ? (
                  <div className="prop-vendors">
                    {vs.slice(0, 6).map((v) => (
                      <button key={v.id} className="prop-vendor" onClick={() => onOpenSub(v)}>
                        {v.company}
                        {!docsComplete(v) && <AlertTriangle size={11} />}
                      </button>
                    ))}
                    {vs.length > 6 && <span className="prop-more">+{vs.length - 6} more</span>}
                  </div>
                ) : (
                  <p className="prop-none">
                    No vendors scoped here yet — every vendor on the account can work it.
                  </p>
                )}

                {p.notes && <p className="prop-notes">{p.notes}</p>}
                <div className="prop-cta">
                  {canManage && (
                    <button className="prop-job" onClick={() => setAssigning(p)}>
                      <Users size={12} /> Assign vendors
                    </button>
                  )}
                  <button className="prop-job" onClick={() => onNewJob(p)}>
                    <Plus size={12} /> {asOwner ? "Request work here" : "New job here"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function PropertyForm({ existing, onSubmit, onCancel }) {
  const [f, setF] = useState(existing || {
    name: "", address: "", city: "", state: "WA", zip: "", units: "", notes: "",
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.name.trim() && f.address.trim();
  return (
    <div className="portal-panel settings-panel">
      <h4>{existing ? "Edit property" : "New property"}</h4>
      <label className="fld">Property name
        <input value={f.name} onChange={(e) => set("name", e.target.value)}
          placeholder="Riverside Apartments" /></label>
      <label className="fld">Street address
        <input value={f.address} onChange={(e) => set("address", e.target.value)}
          placeholder="1420 Riverside Dr" /></label>
      <div className="three">
        <label className="fld">City<input value={f.city} onChange={(e) => set("city", e.target.value)} /></label>
        <label className="fld">State<input value={f.state} maxLength={2}
          onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} /></label>
        <label className="fld">ZIP<input inputMode="numeric" value={f.zip}
          onChange={(e) => set("zip", e.target.value)} /></label>
      </div>
      <label className="fld">Units or spaces <span className="fld-note">optional</span>
        <input inputMode="numeric" value={f.units} onChange={(e) => set("units", e.target.value)}
          placeholder="84" /></label>
      <label className="fld">Notes <span className="fld-note">access, gate codes, anything site-specific</span>
        <textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-solid" disabled={!ok} onClick={() => onSubmit(f)}>
          {existing ? <><Check size={15} /> Save property</> : <><Plus size={15} /> Add property</>}
        </button>
      </div>
    </div>
  );
}

// ---- Public subcontractor signup (white-labeled, linked from the GC's site) ----
// The GC drops this URL on their "work with us" page. A sub fills it in, and
// lands in that GC's account as an invited engagement awaiting approval.
function SubSignup({ brand, onSubmit, onBackToLogin }) {
  const t = themeOf(brand);
  const [step, setStep] = useState(1);
  const [f, setF] = useState({
    company: "", contact: "", email: "", phone: "", license: "", ubi: "",
    city: "", state: "WA", zip: "",
    categories: [], warranty: "", crewCount: "1",
    notifyEmail: true, notifySms: false,
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggleCat = (id) => setF((x) => ({
    ...x,
    categories: x.categories.includes(id)
      ? x.categories.filter((c) => c !== id)
      : [...x.categories, id],
  }));
  const [sent, setSent] = useState(false);

  // Mobile is optional here, but a half-typed one is worse than none -- it
  // reads as reachable and never is.
  const phoneOk = !f.phone.trim() || phoneDigits(f.phone).length === 10;
  const ok1 = f.company.trim() && f.contact.trim() && validEmail(f.email) && phoneOk;
  const ok2 = f.categories.length > 0;
  const stepOk = step === 1 ? ok1 : step === 2 ? ok2 : true;

  if (sent) return (
    <div className="wl-page" style={themeVars(t)}>
      <div className="wl-card wl-done">
        <div className="wl-brand"><BrandMark brand={brand} height={30} />
          <span className="wl-brand-name">{brand.name}</span></div>
        <div className="wl-tick"><CheckCircle2 size={34} /></div>
        <h1>Thanks — we've got it.</h1>
        <p>{brand.name} will review your details. You'll get an email at <b>{f.email}</b> with a
          link to set a password, then you can upload your insurance, bond, W-9 and signed
          agreement.</p>
        <p className="wl-fine">Nothing gets assigned to you until those are approved, so there's
          no rush today — but the sooner they're in, the sooner you can be scheduled.</p>
        <button className="wl-btn" onClick={onBackToLogin}>Go to sign in</button>
      </div>
      <PoweredBy className="wl-foot" height={15} />
    </div>
  );

  return (
    <div className="wl-page" style={themeVars(t)}>
      <div className="wl-card">
        <div className="wl-brand"><BrandMark brand={brand} height={30} />
          <span className="wl-brand-name">{brand.name}</span></div>

        <h1>Work with {brand.name}</h1>
        <p className="wl-lede">Tell us about your company and we'll add you to our
          subcontractor list. Takes about two minutes.</p>

        <div className="wl-steps">
          {[[1, "Your company"], [2, "Trades"], [3, "Finish"]].map(([n, l]) => (
            <span key={n} className={`wl-step ${step === n ? "on" : ""} ${step > n ? "done" : ""}`}>
              {step > n ? <Check size={12} /> : n} {l}
            </span>
          ))}
        </div>

        {step === 1 && (
          <>
            <label className="wl-fld">Company name
              <input value={f.company} onChange={(e) => set("company", e.target.value)} /></label>
            <label className="wl-fld">Your name
              <input value={f.contact} onChange={(e) => set("contact", e.target.value)} /></label>
            <div className="wl-row">
              <label className="wl-fld">Email
                <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
              <label className="wl-fld">Mobile
                <input type="tel" inputMode="numeric" maxLength={13} value={f.phone}
                  onChange={(e) => set("phone", formatPhone(e.target.value))}
                  placeholder="(206)555-0100" /></label>
            </div>
            <div className="wl-row">
              <label className="wl-fld">WA L&amp;I license #
                <input value={f.license} onChange={(e) => set("license", e.target.value.toUpperCase())}
                  placeholder="ABCDEF123GH" /></label>
              <label className="wl-fld">UBI
                <input inputMode="numeric" value={f.ubi} onChange={(e) => set("ubi", e.target.value)} /></label>
            </div>
            <p className="wl-fine">We check your license against the state registry — it speeds
              up approval.</p>
          </>
        )}

        {step === 2 && (
          <>
            <div className="wl-label">What trades do you cover?</div>
            <div className="wl-picks">
              {CATEGORIES.map((c) => (
                <button key={c.id} type="button"
                  className={`wl-pick ${f.categories.includes(c.id) ? "on" : ""}`}
                  onClick={() => toggleCat(c.id)}>{c.label}</button>
              ))}
            </div>
            <div className="wl-row" style={{ marginTop: 18 }}>
              <label className="wl-fld">City
                <input value={f.city} onChange={(e) => set("city", e.target.value)} /></label>
              <label className="wl-fld">ZIP
                <input inputMode="numeric" value={f.zip} onChange={(e) => set("zip", e.target.value)} /></label>
            </div>
            <label className="wl-fld">How many crews do you run?
              <select value={f.crewCount} onChange={(e) => set("crewCount", e.target.value)}>
                {["1", "2", "3", "4", "5+"].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <label className="wl-fld">How long do you warranty your labor?
              <select value={f.warranty} onChange={(e) => set("warranty", e.target.value)}>
                <option value="">Select…</option>
                {WARRANTY_OPTIONS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </label>
            <div className="wl-label">How should we reach you?</div>
            <div className="wl-checks">
              <label className={`wl-check ${f.notifyEmail ? "on" : ""}`}>
                <input type="checkbox" checked={f.notifyEmail}
                  onChange={(e) => set("notifyEmail", e.target.checked)} /> Email</label>
              <label className={`wl-check ${f.notifySms ? "on" : ""}`}>
                <input type="checkbox" checked={f.notifySms}
                  onChange={(e) => set("notifySms", e.target.checked)} /> Text message</label>
            </div>
            <p className="wl-fine">Job offers and document reminders only. One-way messages — you
              reply inside your account, not to the text.</p>
            <div className="wl-summary">
              <div><span>Company</span><b>{f.company || "—"}</b></div>
              <div><span>Trades</span><b>{f.categories.length
                ? f.categories.map((c) => catMeta(c).label).join(", ") : "—"}</b></div>
              <div><span>License</span><b>{f.license || "Not provided"}</b></div>
            </div>
          </>
        )}

        <div className="wl-actions">
          {step > 1
            ? <button className="wl-btn-ghost" onClick={() => setStep(step - 1)}>Back</button>
            : <button className="wl-btn-ghost" onClick={onBackToLogin}>I already have an account</button>}
          {step < 3
            ? <button className="wl-btn" disabled={!stepOk} onClick={() => setStep(step + 1)}>Continue</button>
            : <button className="wl-btn" disabled={!f.notifyEmail && !f.notifySms}
                onClick={() => { onSubmit(f); setSent(true); }}>Submit application</button>}
        </div>
        {!stepOk && (
          <p className="wl-err">{step !== 1
            ? "Pick at least one trade."
            : !phoneOk ? "A mobile number needs 10 digits."
            : f.email.trim() && !validEmail(f.email)
              ? "That email address does not look right — check for a missing @."
              : "Company, your name and an email are needed."}</p>
        )}
      </div>
      <PoweredBy className="wl-foot" height={15} />
    </div>
  );
}

// ---- Upgrade gate (shown instead of the add form when a plan is maxed) ---
function UpgradePrompt({ kind, plan, count, billing, onSetBilling, onUpgrade, onDecline, busy, err }) {
  const cur = PLANS[plan];
  const next = PLANS.scale;
  const [cycle, setCycle] = useState(billing === "annual" ? "annual" : "monthly");
  const annual = cycle === "annual";

  // Why they're seeing this, in their own numbers.
  const title = kind === "job" ? "You've used this month's jobs"
    : kind === "user" ? "You've used your only seat"
    : `You've reached ${cur.limit} subcontractors`;
  const why = kind === "job"
    ? `Basic covers ${cur.jobsPerMonth} jobs a month and you've created ${count}. The count resets on the 1st, or Scale removes the cap entirely.`
    : kind === "user"
      ? `Basic includes ${cur.userLimit} user for your own team and you have ${count}. Contractor logins are free and don't use a seat, either way.`
      : `You have ${count} on your account. Scale lifts the cap and keeps everything you've already set up — your subs, their documents and every job.`;
  const keep = kind === "job" ? `my ${cur.jobsPerMonth} jobs a month`
    : kind === "user" ? `${cur.userLimit} user` : `${cur.limit} subcontractors`;

  return (
    <div className="form up-form">
      <span className="up-badge"><Zap size={13} /> Plan limit</span>
      <h2>{title}</h2>
      <p className="up-sub">{why}</p>

      <p className="up-gets">
        <strong>Scale</strong> gives you unlimited subcontractors, users and jobs, your own logo
        and sign-in address, SMS notifications and uniform ordering.
      </p>

      <div className="cycle up-cycle" role="tablist" aria-label="Billing cycle">
        {[["monthly", "Monthly"], ["annual", "Annual"]].map(([c, l]) => (
          <button key={c} role="tab" aria-selected={cycle === c}
            onClick={() => { setCycle(c); if (onSetBilling) onSetBilling(c); }}>
            {l}{c === "annual" && <span className="cy-save">2 months free</span>}
          </button>
        ))}
      </div>

      <div className="up-buy">
        <div className="up-price-block">
          <span className="up-amt">{annual ? next.annualMonthly : next.price}<em>/mo</em></span>
          <span className="up-terms">
            {annual
              ? `${formatDollars(next.annual)} billed once a year, plus sales tax · saves ${formatDollars(next.annualSaving)}`
              : "Billed monthly, plus sales tax · cancel any time"}
          </span>
        </div>
        <button className="btn-solid up-go" onClick={onUpgrade} disabled={busy}>
          {busy ? "Opening checkout…" : "Upgrade to Scale"}
        </button>
      </div>

      <button className="up-stay" onClick={onDecline}>Not now — keep {keep}</button>
    </div>
  );
}

// ---- Subscription plans -------------------------------------------------
// PROPERTIES: property and portfolio managers run different vendors at
// different buildings, so an engagement can be scoped to specific properties.
// Empty propertyIds = available across the whole account, which is how a
// general contractor uses it. Jobs carry a propertyId, and matching filters
// out vendors scoped elsewhere.
//
// ARCHITECTURE: one contractor, many hiring companies (see DEPLOYMENT.md)
// ---------------------------------------------------------------------------
// Implemented, not stubbed. The three tables are companies / accounts /
// engagements, and the UI reads a flat "sub" composed from company+engagement.
// Everything you need to port this to a server is in three functions:
//   COMPANY_FIELDS / ENGAGEMENT_FIELDS  which table owns which field
//   splitPatch(patch)                   routes a write to the right table(s)
//   composeSub(company, engagement)     flattens them for the UI
// Demo data: Outerhome (Basic) engages 7 companies; Harbor Point (Scale)
// engages 3 of the same ones. Cascade Roofworks is ONE company with TWO
// engagements — different rating, notes and document verdicts in each.
// Sign in as miguel@cascaderoof.com to see the account switcher.
const PLANS = {
  basic: {
    id: "basic", name: "Basic", price: "Free", per: "",
    limit: 3, userLimit: 1, jobsPerMonth: 5, branding: false,
    features: [
      "Up to 3 subcontractors",
      "1 user",
      "5 jobs & work orders per month",
      "Schedule and manage contractors in one place",
      "Compliance document tracking",
      "Contractor portal",
    ],
    excluded: ["Your own logo", "Your own sign-in address"],
  },
  scale: {
    id: "scale", name: "Scale", price: "$99", per: "/mo",
    // Annual is two months free: $990 vs $1,188 billed monthly.
    annual: 990, annualPer: "/yr", annualMonthly: "$82.50", annualSaving: 198,
    limit: Infinity, userLimit: Infinity, jobsPerMonth: Infinity, branding: true,
    features: [
      "Unlimited subcontractors",
      "Unlimited users",
      "Unlimited jobs and work orders",
      "Your logo and your own sign-in address",
      "Email & SMS notifications available",
      "Uniform ordering and approvals",
      "Easy Pay contractors (coming soon)",
    ],
    excluded: [],
  },
};
const UNIFORM_CATALOG = [
  { sku: "tee", label: "T-shirt", note: "Cotton, company logo" },
  { sku: "hoodie", label: "Hoodie", note: "Midweight fleece" },
  { sku: "hat", label: "Hat", note: "Structured cap" },
  { sku: "hivis", label: "Hi-vis vest", note: "ANSI Class 2, safety" },
  { sku: "hivis-tee", label: "Hi-vis T-shirt", note: "ANSI Class 2, safety" },
];
const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

// ---- Account (profile, company, users, subscription) --------------------
// One-time links a customer hands out themselves, one contractor at a time.
// Deliberately weaker than the public application page that comes with Scale,
// which is always on and can be found unprompted -- the difference between
// the plans has to stay real.
function InviteLinks({ canRevoke, onClose }) {
  const [rows, setRows] = useState(null);   // null = still loading
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(null);

  const load = async () => {
    try { setRows(await api.listInvites()); }
    catch (e) { console.error("[invites] load failed:", e); setRows([]); setErr("Could not load your links."); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const made = await api.createInvite(label.trim() || null);
      setRows((cur) => [made, ...(cur || [])]);
      setLabel("");
      copy(made.url, made.id);
    } catch (e) {
      console.error("[invites] create failed:", e);
      setErr("Could not create a link. Try again.");
    } finally { setBusy(false); }
  };

  // Clipboard access is refused often enough -- an insecure origin, a browser
  // that wants a user gesture it did not see -- that the link has to stay
  // readable and selectable on screen regardless.
  const copy = async (url, id) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied((c) => c === id ? null : c), 2000);
    } catch { setCopied(null); }
  };

  const revoke = async (id) => {
    try {
      await api.revokeInvite(id);
      setRows((cur) => cur.map((r) => r.id === id ? { ...r, status: "revoked" } : r));
    } catch (e) { console.error("[invites] revoke failed:", e); setErr("Could not revoke that link."); }
  };

  const open = (rows || []).filter((r) => r.status === "open");
  const past = (rows || []).filter((r) => r.status !== "open");

  return (
    <div className="inv-panel">
      <h2>Invite a subcontractor</h2>
      <p className="panel-note">
        Creates a link you send them yourself — text, email, however you already
        talk to them. They fill in their own profile and documents, then you approve.
        Each link works once and expires after 30 days.
      </p>

      <div className="inv-make">
        <label className="fld">Who is it for? <span className="fld-note">optional, so you can tell your links apart</span>
          <input value={label} maxLength={120} placeholder="Cascade Roofworks — Miguel"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) create(); }} />
        </label>
        <button className="btn-solid" disabled={busy} onClick={create}>
          <Link2 size={15} /> {busy ? "Creating…" : "Create link"}
        </button>
      </div>

      {err && <p className="cov-hint">{err}</p>}

      {rows === null ? <p className="cov-hint">Loading…</p> : (
        <>
          {open.length === 0 && <p className="cov-hint">No open links yet.</p>}
          {open.map((r) => (
            <div key={r.id} className="inv-row-out">
              <div className="inv-main">
                <b>{r.label || "Unnamed link"}</b>
                <code className="inv-url">{r.url}</code>
              </div>
              <div className="inv-acts">
                <button className="pick" onClick={() => copy(r.url, r.id)}>
                  <Copy size={13} /> {copied === r.id ? "Copied" : "Copy"}
                </button>
                {canRevoke && <button className="pick" onClick={() => revoke(r.id)}>
                  <Trash2 size={13} /> Revoke
                </button>}
              </div>
            </div>
          ))}

          {past.length > 0 && (
            <>
              <h5 className="inv-past">Previously</h5>
              {past.map((r) => (
                <div key={r.id} className="inv-row-out spent">
                  <div className="inv-main">
                    <b>{r.label || "Unnamed link"}</b>
                    <span className="cov-hint">{
                      r.status === "accepted" ? "Accepted"
                        : r.status === "revoked" ? "Revoked" : "Expired"
                    }</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      <div className="panel-actions">
        <button className="btn-ghost" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// The trades an account hires out. Chosen at signup and edited here; a null
// list means nobody has chosen yet, which is worth saying out loud rather
// than rendering as thirty unselected chips that look like a deliberate "none".
function TradesPanel({ trades, onSave }) {
  const saved = useMemo(() => (Array.isArray(trades) ? trades : []), [trades]);
  const [sel, setSel] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);

  // Another device, or an admin in the next room, can change this underneath
  // us; take their list as the new baseline rather than silently keeping ours.
  useEffect(() => { setSel(saved); setJustSaved(false); }, [saved]);

  const toggle = (id) => {
    setJustSaved(false);
    setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const dirty = sel.length !== saved.length || sel.some((id) => !saved.includes(id));

  return (
    <div className="portal-panel settings-panel">
      <h4>Trades you work with</h4>
      <p className="panel-note">
        {trades == null
          ? "Not set yet. Pick everything you hire out — it decides what SubSub asks your subcontractors to prove."
          : "Everything you hire out. It decides what SubSub asks your subcontractors to prove."}
      </p>

      {TRADE_GROUPS.map(([heading, ids]) => (
        <div key={heading} className="trade-group">
          <h5>{heading}</h5>
          <div className="picks">
            {ids.map((id) => (
              <button key={id} type="button"
                className={`pick ${sel.includes(id) ? "on" : ""}`}
                onClick={() => toggle(id)}>{catMeta(id).label}</button>
            ))}
          </div>
        </div>
      ))}

      <div className="panel-actions">
        <button className="btn-solid" disabled={!dirty}
          onClick={() => { onSave(sel); setJustSaved(true); }}>
          <Check size={15} /> Save trades
        </button>
        {justSaved && !dirty && <span className="cov-hint">Saved.</span>}
        {dirty && <span className="cov-hint">{sel.length} selected</span>}
      </div>
    </div>
  );
}

// Where a customer's own address got to, in their own words.
//
// They were sold outerhome.subsub.work and it takes a couple of minutes to
// become real. Without this they either sit on a dead link wondering, or ring
// support -- and that is the whole reason the manual version was bad. It
// polls while setup is running, so the page turns green on its own rather
// than asking anyone to refresh.
//
// Deliberately says nothing about Cloudflare. A customer cannot act on "dns:
// Authentication failed"; it would only be alarming, and it is our problem
// to read, in the console where the detail lives.
const ADDRESS_STATE = {
  active:  { tone: "ok",   title: "Your address is live",
             say: "Your team and your contractors can sign in here now." },
  pending: { tone: "wait", title: "Setting up your address",
             say: "This usually takes a couple of minutes. You can keep working — we'll switch it on for you." },
  failed:  { tone: "bad",  title: "We're sorting out your address",
             say: "Something went wrong setting it up and we've been notified. Everyone can keep signing in at app.subsub.work in the meantime." },
};

function AddressStatus({ subdomain, status, onRefresh }) {
  const [live, setLive] = useState(status);
  useEffect(() => { setLive(status); }, [status]);

  // Poll only while there is something to wait for, and stop the moment
  // there isn't. A timer that outlives its reason is a battery complaint.
  //
  // No status at all counts as waiting: that is the state a just-changed
  // address is in, between the row being saved and Cloudflare answering, and
  // it is exactly when somebody is sitting here watching. Give up after five
  // minutes rather than polling forever on a Worker that has no Cloudflare
  // credentials and so will never have anything to report.
  //
  // Through a ref, because onRefresh is written inline by the parent and so is
  // a different function on every render -- and the parent re-renders once a
  // second off the clock. Depending on its identity tore the interval down and
  // built it again before it could ever reach twenty seconds, which is why
  // this panel never went green by itself.
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; });

  const waiting = live === "pending" || !live;
  useEffect(() => {
    if (!waiting) return;
    let running = true, tries = 0;
    const id = setInterval(async () => {
      if (++tries > 15) { clearInterval(id); return; }
      try {
        const next = await refresh.current?.();
        if (running && next) setLive(next);
      } catch { /* a failed poll is not worth saying anything about */ }
    }, 20000);
    return () => { running = false; clearInterval(id); };
  }, [waiting]);

  const host = `${subdomain || "yourcompany"}.subsub.work`;
  const state = ADDRESS_STATE[live];
  if (!state) {
    return (
      <div className="addr-state t-wait">
        <div className="addr-head"><Globe size={15} /><b>Your address is being prepared</b>
          <span className="addr-spin" aria-hidden="true" /></div>
        <p>{host} will be yours shortly. Until it is, everyone signs in at app.subsub.work.</p>
      </div>
    );
  }

  return (
    <div className={`addr-state t-${state.tone}`}>
      <div className="addr-head">
        <Globe size={15} />
        <b>{state.title}</b>
        {live === "pending" && <span className="addr-spin" aria-hidden="true" />}
      </div>
      <p className="addr-host">
        {live === "active"
          ? <a href={`https://${host}`} target="_blank" rel="noreferrer">{host}</a>
          : host}
      </p>
      <p>{state.say}</p>
    </div>
  );
}

function AccountView({ me, users, subs, jobs, brand, plan, role, canManage, mySub, seatCount, atSeatLimit,
  jobsThisMonth, canBrand, billing, onSetBilling, accountKind, onSetAccountKind,
  accountTrades, onSetAccountTrades, subscriptionStatus, currentPeriodEnd, comped, cancelAtPeriodEnd,
  onSaveUser, onSaveBrand, onUpgrade, onManageBilling, billingBusy, billingErr,
  onCancelSubscription, onResumeSubscription, cancelBusy,
  onAddUser, onRemoveUser, onEditUser, onLoginAs, currentUserId,
  onPatchSub, onRequestDocs, onSeatLimit,
  hostnameStatus, onRefreshHostname, properties = [] }) {
  // accountKind is already a prop; the user form needs it to know which
  // scoped roles this account has anybody to hand out.
  const tenantSeats = users.filter((u) => u.role === "tenant");
  const staffSeats = users.filter((u) => u.role !== "tenant");
  const panes = [["profile", "Profile"]]
    .concat(canManage ? [["company", "Company"], ["users", "Users"]] : [])
    // Only where there are buildings for tenants to be in.
    .concat(canManage && ACCOUNT_KINDS[accountKind].properties ? [["tenants", "Tenants"]] : [])
    .concat(canManage ? [["billing", "Subscription"]] : []);
  const brandingOn = PLANS[plan].branding;
  const [pane, setPane] = useState("profile");
  const [confirmCancel, setConfirmCancel] = useState(false);

  // profile form
  const [p, setP] = useState({ name: me.name, email: me.email, phone: me.phone || "" });
  const [pSaved, setPSaved] = useState(false);
  // contractor mailing address lives on their contractor record
  const [addr, setAddr] = useState(mySub ? {
    mailStreet: mySub.mailStreet || "", mailCity: mySub.mailCity || mySub.city || "",
    mailState: mySub.mailState || mySub.state || "", mailZip: mySub.mailZip || mySub.zip || "",
  } : null);
  const [aSaved, setASaved] = useState(false);
  const [nf, setNf] = useState(mySub ? { ...notifyPrefs(mySub) } : { email: true, sms: false });
  const [nSaved, setNSaved] = useState(false);
  const [co, setCo] = useState(mySub?.company || "");
  const [lic, setLic] = useState(mySub?.license || "");
  const [ubi, setUbi] = useState(mySub?.ubi || "");
  // company branding
  const [b, setB] = useState({ ...brand });
  const [th, setTh] = useState(() => themeOf(brand));
  const [bSaved, setBSaved] = useState(false);
  const [bErr, setBErr] = useState("");
  const [bBusy, setBBusy] = useState(false);
  const setBrandField = (k, v) => { setB((x) => ({ ...x, [k]: v })); setBSaved(false); setBErr(""); };
  // Instant local preview via a data URI (unchanged UX), plus a real upload
  // to R2 that persists independently of the rest of the "Save" flow below —
  // the same immediate-on-pick pattern the document uploads use.
  const readMark = (file) => {
    const r = new FileReader();
    r.onload = () => { setB((x) => ({ ...x, logoData: r.result, useDefaultMark: false })); setBSaved(false); };
    r.readAsDataURL(file);

    (async () => {
      try {
        const { key } = await api.uploadFile("logo", file);
        await api.patchAccount({ logoKey: key });
      } catch (err) {
        console.error("[persist] logo upload failed:", err);
      }
    })();
  };
  const [adding, setAdding] = useState(false);
  const slug = (b.subdomain || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  // Only complain once there is something to complain about: an empty field
  // somebody has not reached yet is not an error, it is an empty field.
  const subProblem = slug ? subdomainProblem(slug) : null;
  const active = PLANS[plan];

  return (
    <main className="ss-main">
      {panes.length > 1 && (
        <div className="seg-tabs">
          {panes.map(([id, l]) => (
            <button key={id} className={pane === id ? "on" : ""} onClick={() => setPane(id)}>{l}</button>
          ))}
        </div>
      )}

      {pane === "profile" && (
        <>
          <div className="portal-panel settings-panel">
            <h4>Your details</h4>
            {mySub && (
              <>
                <label className="fld">Company name <span className="fld-note">shown on your dashboard</span>
                  <input value={co} onChange={(e) => { setCo(e.target.value); setPSaved(false); }} placeholder="Your company" />
                </label>
                <div className="fld-row">
                  <label className="fld">WA L&amp;I license #
                    <span className="fld-note">checked against the state registry</span>
                    <input value={lic} onChange={(e) => { setLic(e.target.value.toUpperCase().trim()); setPSaved(false); }} placeholder="ABCDEF123GH" />
                  </label>
                  <label className="fld">UBI
                    <input inputMode="numeric" value={ubi} onChange={(e) => { setUbi(e.target.value.trim()); setPSaved(false); }} placeholder="603221887" />
                  </label>
                </div>
                {mySub.licenseCheck && (
                  <p className={licenseOk(mySub) ? "cov-hint" : "fld-err"}>
                    {licenseOk(mySub)
                      ? <>Verified with L&amp;I · {mySub.licenseCheck.status} · expires {mySub.licenseCheck.expirationDate}</>
                      : <><AlertTriangle size={12} /> L&amp;I shows this registration as {mySub.licenseCheck.status.toLowerCase()} — renew it to keep receiving work.</>}
                  </p>
                )}
              </>
            )}
            <div className="fld-row">
              <label className="fld">Full name<input value={p.name} onChange={(e) => { setP({ ...p, name: e.target.value }); setPSaved(false); }} /></label>
              <label className="fld">Email<input type="email" value={p.email} onChange={(e) => { setP({ ...p, email: e.target.value }); setPSaved(false); }} /></label>
            </div>
            <label className="fld">Phone<input type="tel" inputMode="numeric" maxLength={13} value={p.phone} onChange={(e) => { setP({ ...p, phone: formatPhone(e.target.value) }); setPSaved(false); }} placeholder="(206)555-0100" /></label>
            <div className="role-locked">
              <span className={`role-badge r-${role}`}>{ROLES[role].label}</span>
              <span className="rl-note">Only an admin can change roles.</span>
            </div>
            <div className="panel-actions">
              <span className="panel-count">{me.email}</span>
              {pSaved ? <span className="saved-note"><CheckCircle2 size={14} /> Saved</span>
                : <button className="btn-solid" disabled={!p.name || !p.email || (mySub && !co.trim())}
                    onClick={() => {
                      onSaveUser({ ...me, ...p });
                      if (mySub) onPatchSub(mySub.id, { company: co.trim(), license: lic, ubi });
                      setPSaved(true);
                    }}>
                    <Check size={15} /> Save details</button>}
            </div>
          </div>

          {mySub && (
            <div className="portal-panel settings-panel">
              <h4>Notifications</h4>
              <p className="panel-note">How you hear about job requests, work orders, and document reminders. Pick at least one.</p>
              <div className="notify-opts">
                <label className={`notify-opt ${nf.email ? "on" : ""}`}>
                  <input type="checkbox" checked={nf.email}
                    onChange={(e) => { setNf({ ...nf, email: e.target.checked }); setNSaved(false); }} />
                  <Mail size={17} />
                  <span className="no-txt">
                    <span className="no-name">Email</span>
                    <span className="no-sub">{mySub.email || "no email on file"}</span>
                  </span>
                </label>
                <label className={`notify-opt ${nf.sms ? "on" : ""}`}>
                  <input type="checkbox" checked={nf.sms}
                    onChange={(e) => { setNf({ ...nf, sms: e.target.checked }); setNSaved(false); }} />
                  <Phone size={17} />
                  <span className="no-txt">
                    <span className="no-name">Text message (SMS)</span>
                    <span className="no-sub">{mySub.phone || "no phone on file"}</span>
                  </span>
                </label>
              </div>
              {!nf.email && !nf.sms && (
                <div className="doc-block" style={{ marginTop: 12, marginBottom: 0 }}>
                  <AlertTriangle size={15} />
                  <div><strong>Pick at least one.</strong> You'd miss job requests and document reminders with both switched off.</div>
                </div>
              )}
              <p className="cov-hint">Email &amp; SMS is for automated notifications only — nobody can message you from the platform, and these are no-reply.</p>
              <div className="panel-actions">
                <span className="panel-count">
                  {nf.email && nf.sms ? "Email + SMS" : nf.sms ? "SMS only" : nf.email ? "Email only" : "None selected"}
                </span>
                {nSaved ? <span className="saved-note"><CheckCircle2 size={14} /> Saved</span>
                  : <button className="btn-solid" disabled={!nf.email && !nf.sms}
                      onClick={() => { onPatchSub(mySub.id, { notify: nf }); setNSaved(true); }}>
                      <Check size={15} /> Save notifications</button>}
              </div>
            </div>
          )}

          {mySub && addr && (
            <div className="portal-panel settings-panel">
              <h4>Mailing address</h4>
              <p className="panel-note">Where uniforms and paperwork get shipped.</p>
              <label className="fld">Street<input value={addr.mailStreet} onChange={(e) => { setAddr({ ...addr, mailStreet: e.target.value }); setASaved(false); }} placeholder="1234 Industrial Way, Suite B" /></label>
              <div className="fld-row">
                <label className="fld">City<input value={addr.mailCity} onChange={(e) => { setAddr({ ...addr, mailCity: e.target.value }); setASaved(false); }} placeholder="Seattle" /></label>
                <label className="fld">State<input value={addr.mailState} maxLength={2} onChange={(e) => { setAddr({ ...addr, mailState: e.target.value.toUpperCase().slice(0, 2) }); setASaved(false); }} placeholder="WA" /></label>
                <label className="fld">ZIP<input inputMode="numeric" value={addr.mailZip} onChange={(e) => { setAddr({ ...addr, mailZip: e.target.value }); setASaved(false); }} placeholder="98108" /></label>
              </div>
              <div className="panel-actions">
                <span className="panel-count">{[addr.mailCity, addr.mailState, addr.mailZip].filter(Boolean).join(", ") || "Not set"}</span>
                {aSaved ? <span className="saved-note"><CheckCircle2 size={14} /> Saved</span>
                  : <button className="btn-solid" disabled={!addr.mailStreet || !addr.mailZip}
                      onClick={() => { onPatchSub(mySub.id, addr); setASaved(true); }}>
                      <Check size={15} /> Save address</button>}
              </div>
            </div>
          )}
        </>
      )}

      {pane === "company" && canManage && (
        <div className="portal-panel settings-panel">
          <h4>Account type</h4>
          <p className="panel-note">
            What this account is. It decides whether you keep a building list:
            a general contractor subs out trades job by job, the others manage a
            standing portfolio and scope vendors to specific buildings.
          </p>
          <div className="picks">
            {Object.entries(ACCOUNT_KINDS).map(([id, k]) => (
              <button key={id} type="button"
                className={`pick ${accountKind === id ? "on" : ""}`}
                onClick={() => onSetAccountKind(id)}>{k.label}</button>
            ))}
          </div>
          <p className="cov-hint">
            {ACCOUNT_KINDS[accountKind].properties
              ? "Properties is on. Add your buildings there, then scope vendors to them."
              : "No Properties tab. Vendors are matched by trade and coverage area, per job."}
          </p>
        </div>
      )}

      {pane === "company" && canManage && (
        <TradesPanel trades={accountTrades} onSave={onSetAccountTrades} />
      )}

      {pane === "company" && canManage && !canBrand && (
        <div className="portal-panel settings-panel">
          <h4>Company branding</h4>
          <div className="doc-block with-cta">
            <AlertTriangle size={15} />
            <div><strong>Branding comes with Scale.</strong> On Basic your contractors sign in
              through SubSub. Upgrade to use your own logo and your own sign-in address —
              nothing needs re-entering.</div>
            <button className="btn-notify" disabled={billingBusy} onClick={() => onUpgrade()}>
              <Zap size={14} /> Upgrade to Scale</button>
          </div>
          <p className="cov-hint">Everything else about your company is set when you add contractors and create jobs.</p>
        </div>
      )}

      {pane === "company" && canManage && canBrand && (
        <div className="portal-panel settings-panel">
          <h4>Company branding</h4>
          <p className="panel-note">What your contractors see when they sign in. SubSub stays in the background.</p>

          <div className="brand-preview">
            <div className="bp-chrome">
              <span className="bp-dot" /><span className="bp-dot" /><span className="bp-dot" />
              <span className="bp-url">{slug || "yourcompany"}.subsub.work</span>
            </div>
            <div className="bp-body">
              <div className="brand-logo lg"><BrandMark brand={b} height={34} /></div>
              <div>
                <div className="bp-name">{b.name || "Your company"}</div>
                <div className="bp-sub">Contractor portal</div>
              </div>
            </div>
            <div className="bp-foot"><PoweredBy height={12} /></div>
          </div>

          <label className="fld">Company name<input value={b.name} onChange={(e) => setBrandField("name", e.target.value)} placeholder="Outerhome" /></label>
          <label className="fld">Subdomain <span className="fld-note">where your team and contractors sign in</span>
            <div className="subdomain-row">
              <input value={b.subdomain} onChange={(e) => setBrandField("subdomain", e.target.value)}
                autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="yourcompany" />
              <span className="sd-suffix">.subsub.work</span>
            </div>
          </label>
          {subProblem
            ? <p className="fld-err"><AlertTriangle size={12} /> {subProblem}</p>
            : slug !== brand.subdomain && (
              <p className="cov-hint">
                Not saved yet. Saving moves everyone to <b>{slug}.subsub.work</b> — the old
                address stops working, so tell your team and your contractors before you do.
              </p>
            )}

          <AddressStatus subdomain={brand.subdomain} status={hostnameStatus} onRefresh={onRefreshHostname} />

          <div className="fld">Logo mark
            <div className="mark-row">
              <div className="mark-preview"><BrandMark brand={b} height={30} /></div>
              <div className="mark-meta">
                <span className="mark-name">{b.name || "Your company"}</span>
                <span className="mark-hint">{b.logoData ? "Custom mark" : b.useDefaultMark ? "Default roof mark" : "Initials"}</span>
              </div>
              <div className="mark-actions">
                <label className="dm-replace"><Upload size={12} /> Upload
                  <input type="file" hidden accept="image/*,.svg" onChange={(e) => { if (e.target.files.length) readMark(e.target.files[0]); }} /></label>
                {b.logoData
                  ? <button type="button" className="dm-delete" onClick={() => {
                      setBrandField("logoData", null); setBrandField("useDefaultMark", true);
                      persist("patchAccount.logo", api.patchAccount({ logoKey: null }));
                    }}><Trash2 size={12} /> Remove</button>
                  : !b.useDefaultMark && <button type="button" className="dm-replace" onClick={() => setBrandField("useDefaultMark", true)}>Default</button>}
              </div>
            </div>
            <p className="cov-hint">Mark only — your company name is rendered as text beside it.</p>
          </div>

          <div className="form-sec">Colors for your subcontractor-facing pages</div>
          <p className="panel-note">These apply to the two pages your subcontractors see before
            they're inside the app: your sign-in page and the public application form you link
            from your website. The app itself keeps its own styling.</p>

          <div className="theme-grid">
            {THEME_FIELDS.map((tf) => (
              <label key={tf.id} className="theme-row">
                <span className="theme-label">{tf.label}</span>
                <span className="theme-input">
                  <input type="color" value={th[tf.id]}
                    onChange={(e) => { setTh({ ...th, [tf.id]: e.target.value }); setBSaved(false); setBErr(""); }} />
                  <input className="theme-hex" value={th[tf.id]}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
                        setTh({ ...th, [tf.id]: v.startsWith("#") ? v : "#" + v });
                        setBSaved(false);
                      }
                    }} />
                </span>
              </label>
            ))}
          </div>

          {(() => {
            const cr = contrastRatio(th.text, th.surface);
            const br = contrastRatio(th.btnText, th.accent);
            const bad = cr < 4.5 || br < 4.5;
            return bad ? (
              <p className="fld-err"><AlertTriangle size={12} />
                {cr < 4.5 && ` Text on cards is low contrast (${cr}:1).`}
                {br < 4.5 && ` Button text is low contrast (${br}:1).`}
                {" "}Aim for 4.5:1 or higher so it stays readable.
              </p>
            ) : (
              <p className="cov-hint">Contrast looks good — text {cr}:1, buttons {br}:1.</p>
            );
          })()}

          <div className="theme-preview" style={themeVars(th)}>
            <div className="tp-bar">
              <span>{slug || "yourcompany"}.subsub.work</span>
            </div>
            <div className="tp-body">
              <div className="tp-card">
                <div className="tp-brand"><BrandMark brand={b} height={22} />
                  <span>{b.name || "Your company"}</span></div>
                <div className="tp-h">Work with {b.name || "your company"}</div>
                <div className="tp-p">Tell us about your company and we'll add you to our
                  subcontractor list.</div>
                <div className="tp-field" />
                <div className="tp-field" />
                <div className="tp-btn">Continue</div>
              </div>
            </div>
          </div>

          <div className="theme-actions">
            <button type="button" className="btn-ghost"
              onClick={() => { setTh({ ...DEFAULT_THEME }); setBSaved(false); setBErr(""); }}>Reset to default</button>
            {/* The real form on the real address, in a new tab. It used to
                open a copy inside this tab, which meant signing out of the
                app to look at it and coming back to generic SubSub branding
                -- the one thing this page exists to replace. */}
            {hostnameStatus === "active" && brand.subdomain ? (
              <a className="theme-link" href={`https://${brand.subdomain}.subsub.work/?apply=1`}
                target="_blank" rel="noreferrer">
                Open the live application form <ExternalLink size={12} />
              </a>
            ) : (
              <span className="theme-note">
                The live form opens once {brand.subdomain || "your"}.subsub.work is ready.
              </span>
            )}
          </div>

          {bErr && <p className="fld-err"><AlertTriangle size={12} /> {bErr}</p>}

          <div className="panel-actions">
            <span className="panel-count">{slug || "yourcompany"}.subsub.work</span>
            {bSaved ? <span className="saved-note"><CheckCircle2 size={14} /> Saved</span>
              : <button className="btn-solid" disabled={bBusy || !b.name || !slug || !!subProblem}
                  onClick={async () => {
                    setBBusy(true); setBErr("");
                    const err = await onSaveBrand({ ...b, subdomain: slug, theme: th });
                    setBBusy(false);
                    if (err) setBErr(err); else { setBSaved(true); setB((x) => ({ ...x, subdomain: slug })); }
                  }}>
                  <Check size={15} /> {bBusy ? "Saving…" : "Save branding"}</button>}
          </div>
        </div>
      )}

      {pane === "users" && canManage && (
        <>
          <div className="jobs-head">
            <h3>{seatCount} of {PLANS[plan].userLimit === Infinity ? "unlimited" : PLANS[plan].userLimit} user seat{PLANS[plan].userLimit === 1 ? "" : "s"} used</h3>
            <button className="add-btn small" onClick={() => atSeatLimit ? onSeatLimit() : setAdding(true)}>
              <Plus size={14} /> New user
            </button>
          </div>
          {adding && (
            <div className="portal-panel" style={{ marginBottom: 12 }}>
              <UserForm subs={subs} properties={properties} accountKind={accountKind}
                onSubmit={(u) => { onAddUser(u); setAdding(false); }} onCancel={() => setAdding(false)} />
            </div>
          )}
          <div className="user-list">
            {staffSeats.map((u) => {
              const linked = u.subId && subs.find((x) => x.id === u.subId);
              return (
                <div key={u.id} className="user-row">
                  <span className="user-avatar lg">{u.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                  <div className="user-row-main">
                    <div className="user-row-head">
                      <h4>{u.name}</h4>
                      <span className={`role-badge r-${u.role}`}>{ROLES[u.role].label}</span>
                      {u.id === currentUserId && <span className="you-badge">you</span>}
                    </div>
                    <p className="user-row-sub">{u.email}{linked ? ` · ${linked.company}` : ""}
                      {(ALWAYS_SCOPED_ROLES.includes(u.role) || isScoped(u)) && (() => {
                        const names = (u.propertyIds || [])
                          .map((id) => properties.find((p) => p.id === id)?.name).filter(Boolean);
                        return names.length ? ` · ${names.join(", ")}` : " · no buildings yet";
                      })()}</p>
                  </div>
                  <div className="user-row-actions">
                    {linked && !docsComplete(linked) && (
                      <button className="btn-notify sm" onClick={() => onRequestDocs(linked)}><Mail size={12} /> Request docs</button>
                    )}
                    {u.id !== currentUserId && (
                      <button className="login-as-btn" onClick={() => onLoginAs(u.id)}><LogIn size={13} /> Log in as</button>
                    )}
                    <button className="edit-btn" onClick={() => onEditUser(u)}><Pencil size={13} /> Edit</button>
                    {u.id !== currentUserId && (
                      <button className="icon-x" onClick={() => onRemoveUser(u.id)} title="Remove user"><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {pane === "tenants" && canManage && (
        <TenantsPane properties={properties} accountKind={accountKind} />
      )}

      {pane === "billing" && canManage && (
        <>
          {billingErr && <p className="billing-err" role="alert">{billingErr}</p>}
          {/* Cards, invoices and cancellation live in Stripe's portal. This
              is the door to it, shown only once there is a customer there. */}
          {plan === "scale" && !comped && (
            <div className="billing-manage">
              <div>
                <b>Payment and invoices</b>
                <p>Change the card on file, download invoices, or cancel.</p>
              </div>
              <button className="btn-ghost" disabled={billingBusy} onClick={onManageBilling}>
                {billingBusy ? "Opening…" : "Manage billing"}
              </button>
            </div>
          )}
          <div className="plan-current">
            <div>
              <span className="pc-label">Current plan</span>
              <span className="pc-name">{active.name}</span>
              {active.annual ? (
                <span className="pc-cycle">
                  {billing === "annual" ? `${formatDollars(active.annual)}/yr` : `${active.price}/mo`}
                  {!currentPeriodEnd && (billing === "annual" ? " · billed yearly" : " · billed monthly")}
                </span>
              ) : (
                <span className="pc-cycle">No subscription</span>
              )}
              {/* The date sits on its own line beside the plan name, and shows
                  for a free account too: a cancelled subscription still runs
                  to a date, and "when does this stop" is the question being
                  asked. "Renews" becomes "ends" when it will not. */}
              {comped && <span className="pc-renew comp">Complimentary — nothing to pay</span>}
              {!comped && currentPeriodEnd && (
                <span className={`pc-renew ${subscriptionStatus === "past_due" || cancelAtPeriodEnd ? "warn" : ""}`}>
                  {/* Three different things, and saying the wrong one is a
                      support call: somebody told they will be charged again
                      after cancelling, or told their access ends when it
                      does not. Stripe keeps a cancelling subscription
                      `active` to the last day, so the flag decides, not the
                      status. */}
                  {subscriptionStatus === "canceled" || plan === "basic"
                    ? <>Moved to Basic {niceDay(currentPeriodEnd)}</>
                    : cancelAtPeriodEnd
                      ? <>Scale until {niceDay(currentPeriodEnd)}, then Basic — free</>
                      : <>Renews automatically {niceDay(currentPeriodEnd)} · {billing === "annual" ? "yearly" : "monthly"}</>}
                  {subscriptionStatus === "past_due" && " · payment failed, we're retrying"}
                </span>
              )}
            </div>
            <div className="pc-usage">
              <span><strong>{subs.length}</strong> of {active.limit === Infinity ? "unlimited" : active.limit} contractors</span>
              <span><strong>{seatCount}</strong> of {active.userLimit === Infinity ? "unlimited" : active.userLimit} user{active.userLimit === 1 ? "" : "s"}</span>
              <span><strong>{jobsThisMonth}</strong> of {active.jobsPerMonth === Infinity ? "unlimited" : active.jobsPerMonth} job{active.jobsPerMonth === 1 ? "" : "s"} this month</span>
            </div>
          </div>
          {cancelAtPeriodEnd && plan === "scale" && (
            <div className="cancel-note">
              <AlertTriangle size={14} />
              <span>
                Moving to the free <b>Basic</b> plan on <b>{niceDay(currentPeriodEnd)}</b>. Everything on
                Scale keeps working until then, and your account, contractors and job history stay
                exactly as they are. Changed your mind? <b>Stay on Scale</b> below.
              </span>
            </div>
          )}

          <div className="cycle-row">
            <div className="cycle" role="tablist" aria-label="Billing cycle">
              {[["monthly", "Monthly"], ["annual", "Annual"]].map(([c, l]) => (
                <button key={c} role="tab" aria-selected={billing === c}
                  onClick={() => onSetBilling(c)}>
                  {l}{c === "annual" && <span className="cy-save">2 months free</span>}
                </button>
              ))}
            </div>
            {billing === "annual" && (
              <span className="cycle-note">
{formatDollars(PLANS.scale.annual)} a year on Scale, plus sales tax — saves {formatDollars(PLANS.scale.annualSaving)}
              </span>
            )}
          </div>
          <div className="plan-grid">
            {Object.values(PLANS).map((pl) => (
              <div key={pl.id} className={`plan-card ${plan === pl.id ? "on" : ""}`}>
                {plan === pl.id && <span className="plan-badge">Current</span>}
                <span className="plan-name">{pl.name}</span>
                <div className="plan-price">
                  {pl.annual && billing === "annual"
                    ? <>{pl.annualMonthly}<span>{pl.per}</span></>
                    : <>{pl.price}<span>{pl.per}</span></>}
                </div>
                {pl.annual && (
                  <span className="plan-bill">
                    {/* Sales tax is added at checkout, and it is added
                        wherever we are registered to collect it. Saying so
                        here rather than letting the total appear on the
                        payment form is the difference between a price and a
                        surprise. */}
                    {billing === "annual"
                      ? `${formatDollars(pl.annual)} billed once a year, plus sales tax`
                      : "Billed monthly, plus sales tax · cancel any time"}
                  </span>
                )}
                <ul className="plan-feats">
                  {pl.features.map((ft) => <li key={ft}><Check size={13} /> {ft}</li>)}
                  {(pl.excluded || []).map((ft) => (
                    <li key={ft} className="feat-off"><X size={13} /> {ft}</li>
                  ))}
                </ul>
                {/* Each card's button is about that card's plan. The way
                    back from a scheduled downgrade belongs on Scale ("stay
                    here"), not on Basic -- putting it there read as though
                    Basic were the thing being kept. */}
                {plan === pl.id && !(pl.id === "scale" && cancelAtPeriodEnd)
                  ? <button className="btn-ghost plan-btn" disabled>Current plan</button>
                  : pl.id === "scale"
                    ? cancelAtPeriodEnd
                      ? <button className="btn-solid plan-btn" disabled={cancelBusy}
                          onClick={onResumeSubscription}>
                          {cancelBusy ? "Working…" : "Stay on Scale"}</button>
                      : <button className="btn-solid plan-btn" disabled={billingBusy}
                          onClick={() => onUpgrade()}>
                          <Zap size={15} /> {billingBusy ? "Opening checkout…" : "Upgrade"}
                        </button>
                    // Moving to Basic happens here rather than in Stripe's
                    // portal, which is a hosted page with no embedded form.
                    : cancelAtPeriodEnd
                      ? <button className="btn-ghost plan-btn" disabled>
                          Starts {niceDay(currentPeriodEnd)}</button>
                      : <button className="btn-ghost plan-btn" disabled={cancelBusy}
                          onClick={() => setConfirmCancel(true)}>Switch to Basic</button>}
              </div>
            ))}
          </div>
          {confirmCancel && (
            <Modal onClose={() => setConfirmCancel(false)}>
              <div className="cancel-modal">
                <h3>Switch to the free Basic plan?</h3>
                <p>
                  {currentPeriodEnd
                    ? <>You keep everything on Scale until <b>{niceDay(currentPeriodEnd)}</b> — you have paid
                        for that time and we are not taking it back. Nothing more is charged after that.</>
                    : <>You keep everything on Scale until the end of the period you have paid for.
                        Nothing more is charged after that.</>}
                </p>
                <p className="cancel-after">
                  <b>Your account stays open.</b> Your contractors, documents and job history are all
                  kept — nothing is deleted. From that date Basic's limits apply: three subcontractors,
                  one user, five jobs a month, and sign-in moves back to app.subsub.work. You can go
                  back to Scale whenever you like.
                </p>
                {billingErr && <p className="pf-host-err">{billingErr}</p>}
                <div className="form-actions">
                  <button className="btn-ghost" onClick={() => setConfirmCancel(false)}>
                    Stay on Scale
                  </button>
                  <button className="btn-solid" disabled={cancelBusy}
                    onClick={async () => { await onCancelSubscription(); setConfirmCancel(false); }}>
                    {cancelBusy ? "Switching…" : "Switch to Basic"}
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {plan === "scale" && (
            <div className="usage-panel">
              <h4>Usage this month</h4>
              <div className="usage-rows">
                <div className="wd-row"><span>Email notifications</span><strong>Included</strong></div>
                <div className="wd-row"><span>SMS notifications</span><strong>$0.02 each</strong></div>
                <div className="wd-row"><span>Contractors on account</span><strong>{subs.length}</strong></div>
                <div className="wd-row"><span>User seats</span><strong>{seatCount} · unlimited</strong></div>
              </div>
              {/* Was "$50 subscription", which is neither the monthly nor
                  the annual price. A number typed into a sentence goes stale
                  the first time pricing moves; the plan's name does not. */}
              <p className="cov-hint">
                SMS usage is billed monthly, separately from your Scale subscription.
                Email notifications are included at no extra cost.
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ---- Contractor: order uniforms ----------------------------------------
function UniformOrder({ sub, orders, onOrder, brand }) {
  const [qty, setQty] = useState({});
  const [size, setSize] = useState({});
  const [note, setNote] = useState("");
  const hasAddr = sub.mailStreet && sub.mailZip;
  const set = (sku, n) => setQty((q) => ({ ...q, [sku]: Math.max(0, (q[sku] || 0) + n) }));
  const lines = UNIFORM_CATALOG
    .filter((c) => qty[c.sku] > 0)
    .map((c) => ({ sku: c.sku, label: c.label, size: size[c.sku] || "L", qty: qty[c.sku] }));
  const total = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="portal-panel">
      <h4>Order uniforms</h4>
      <p className="panel-note">Branded gear from {brand.name}. Orders go to them for approval, then ship to your mailing address.</p>

      {!hasAddr && (
        <div className="doc-block with-cta">
          <AlertTriangle size={15} />
          <div><strong>Mailing address needed.</strong> Add it under My account before ordering.</div>
        </div>
      )}

      <div className="uni-grid">
        {UNIFORM_CATALOG.map((c) => (
          <div key={c.sku} className={`uni-card ${qty[c.sku] > 0 ? "on" : ""}`}>
            <div className="uni-top">
              <span className="uni-name">{c.label}</span>
              {c.sku.startsWith("hivis") && <span className="uni-safety">Safety</span>}
            </div>
            <span className="uni-note">{c.note}</span>
            <div className="uni-controls">
              <select value={size[c.sku] || "L"} onChange={(e) => setSize((z) => ({ ...z, [c.sku]: e.target.value }))}>
                {SIZES.map((z) => <option key={z}>{z}</option>)}
              </select>
              <div className="uni-qty">
                <button onClick={() => set(c.sku, -1)} disabled={!qty[c.sku]}>−</button>
                <span>{qty[c.sku] || 0}</span>
                <button onClick={() => set(c.sku, 1)}>+</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <label className="fld" style={{ marginTop: 16 }}>Note <span className="fld-note">crew names, special sizing, anything else</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 3 shirts for Roof Crew A…" />
      </label>

      <div className="panel-actions">
        <span className="panel-count">{total} item{total === 1 ? "" : "s"}{hasAddr ? ` → ${[sub.mailCity, sub.mailState].filter(Boolean).join(", ")}` : ""}</span>
        <button className="btn-solid" disabled={!total || !hasAddr}
          onClick={() => { onOrder({ lines, note, ship: { street: sub.mailStreet, city: sub.mailCity, state: sub.mailState, zip: sub.mailZip } }); setQty({}); setNote(""); }}>
          <Send size={15} /> Submit for approval
        </button>
      </div>

      {orders.length > 0 && (
        <>
          <div className="form-sec">Your orders</div>
          {orders.map((o) => (
            <div key={o.id} className="uni-order">
              <div className="uo-main">
                <span className="uo-items">{o.lines.map((l) => `${l.qty}× ${l.label} (${l.size})`).join(", ")}</span>
                <span className="uo-date">Submitted {o.createdAt}</span>
              </div>
              <span className={`job-status st-${o.status === "approved" ? "accepted" : o.status === "denied" ? "declined" : "pending"}`}>{o.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---- Admin / PM: approve uniform orders --------------------------------
function UniformAdmin({ orders, subs, onDecide }) {
  const pending = orders.filter((o) => o.status === "pending");
  const decided = orders.filter((o) => o.status !== "pending");
  const Row = ({ o, showActions }) => (
    <div className="uni-order admin">
      <div className="dash-avatar">{(o.company || "?").split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
      <div className="uo-main">
        <span className="uo-co">{o.company}</span>
        <span className="uo-items">{o.lines.map((l) => `${l.qty}× ${l.label} (${l.size})`).join(", ")}</span>
        {o.note && <span className="uo-note">“{o.note}”</span>}
        <span className="uo-date">
          Ship to {[o.ship?.street, o.ship?.city, o.ship?.state, o.ship?.zip].filter(Boolean).join(", ")} · {o.createdAt}
        </span>
      </div>
      {showActions ? (
        <div className="trade-actions">
          <button className="resp accept" onClick={() => onDecide(o.id, "approved")}><Check size={12} /> Approve</button>
          <button className="resp decline" onClick={() => onDecide(o.id, "denied")}><X size={12} /> Deny</button>
        </div>
      ) : (
        <span className={`job-status st-${o.status === "approved" ? "accepted" : "declined"}`}>{o.status}</span>
      )}
    </div>
  );
  return (
    <main className="ss-main">
      <div className="dash-hello">
        <div>
          <h2>Uniform orders</h2>
          <p>{pending.length === 0 ? "Nothing waiting on approval." : `${pending.length} order${pending.length === 1 ? "" : "s"} awaiting your approval`}</p>
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="dash-empty"><Shirt size={24} /><p>No uniform orders yet. Contractors order from their portal.</p></div>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="dash-sec">
              <h3><Clock size={15} /> Awaiting approval <span className="sec-count amber">{pending.length}</span></h3>
              {pending.map((o) => <Row key={o.id} o={o} showActions />)}
            </section>
          )}
          {decided.length > 0 && (
            <section className="dash-sec">
              <h3><CheckCircle2 size={15} /> Decided <span className="sec-count">{decided.length}</span></h3>
              {decided.map((o) => <Row key={o.id} o={o} />)}
            </section>
          )}
        </>
      )}
    </main>
  );
}

// ---- Admin / PM dashboard ----------------------------------------------
// The first hour decides whether an account is ever used again. A new one is
// a set of empty panels that each look like somebody else's job, so this says
// what to do next -- and stops as soon as it is no longer needed. A runway,
// not furniture.
//
// The order is the dependency order: trades decide which documents get asked
// for, documents decide who can be assigned, so a job created before either
// is a job with nobody to give it to.
function GettingStarted({ accountId, trades, subs, jobs, subLimit, onGoAccount, onInvite, onAddSub, onNewJob, onGoContractors, properties, onAddProperty }) {
  const key = `subsub.gs.${accountId}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });

  const approved = subs.filter((s) => DOC_KINDS.every((k) => s[k]));
  const steps = [
    {
      id: "trades", done: Array.isArray(trades) && trades.length > 0,
      title: "Tell us what you hire out",
      note: "Your trades decide what SubSub asks each subcontractor to prove.",
      actions: [{ label: "Pick trades", onClick: onGoAccount, solid: true }],
    },
    {
      id: "subs", done: subs.length > 0,
      title: subLimit === Infinity
        ? "Bring your subcontractors in"
        : `Bring your subcontractors in — ${subs.length} of ${subLimit}`,
      note: "Send them a link and they build their own profile and upload their own "
        + "documents. Faster than chasing paperwork, and it stays theirs to keep current.",
      actions: [
        { label: "Send an invite link", onClick: onInvite, solid: true },
        { label: "Add one myself", onClick: onAddSub },
      ],
    },
    // Somebody managing buildings has nowhere to point a job until the
    // buildings exist, so for those accounts this is a step rather than
    // something to discover later. A general contractor never sees it.
    ...(Array.isArray(properties) ? [{
      id: "properties", done: properties.length > 0,
      title: "Add the properties you manage",
      note: "Jobs are raised against a building, and contractors can be scoped to "
        + "the ones they actually work, so this is worth doing before the first job.",
      actions: [{ label: "Add a property", onClick: onAddProperty, solid: true }],
    }] : []),
    {
      id: "docs", done: approved.length > 0,
      title: "Approve their documents",
      note: "Insurance, bond, contract and W-9. Nobody can be assigned a job until theirs clear.",
      actions: [{ label: "Review documents", onClick: onGoContractors, solid: true }],
    },
    {
      id: "job", done: jobs.length > 0,
      title: "Create your first job",
      note: "Pick the trades it needs and SubSub shows you who can take it.",
      actions: [{ label: "New job", onClick: onNewJob, solid: true }],
    },
  ];

  const doneCount = steps.filter((x) => x.done).length;
  // Gone for good once it is finished -- the whole point was to get out of the way.
  if (hidden || doneCount === steps.length) return null;
  const current = steps.find((x) => !x.done);

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(key, "1"); } catch { /* private window; it just comes back */ }
  };

  return (
    <div className="gs-card">
      <div className="gs-head">
        <div>
          <h3>Get set up</h3>
          <p>Progress · {doneCount} of {steps.length} done</p>
        </div>
        <button className="gs-hide" onClick={dismiss} title="Hide this" aria-label="Hide this">
          <X size={15} />
        </button>
      </div>

      <div className="gs-bar"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>

      <ol className="gs-steps">
        {steps.map((step) => (
          <li key={step.id} className={`gs-step ${step.done ? "done" : step.id === current.id ? "now" : "later"}`}>
            <span className="gs-tick">{step.done ? <Check size={13} /> : null}</span>
            <div className="gs-body">
              <b>{step.title}</b>
              {step.id === current.id && (
                <>
                  <p>{step.note}</p>
                  <div className="gs-acts">
                    {step.actions.map((a) => (
                      <button key={a.label} className={a.solid ? "btn-solid" : "btn-ghost"} onClick={a.onClick}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// `properties` is null for an account that keeps no building list -- a general
// contractor -- and an array for the rest, so it is both the data and the
// answer to "does this account think in buildings at all".
function AdminDashboard({ subs, jobs, role, me, now, trades, accountId, subLimit, onGoAccount, onInvite, onAddSub, onGoJobs, onGoContractors, onNewJob, onAssign, onRequestDocs, onOpenSub, onReviewDoc, onVerifyLicense, properties, onGoProperties, onAddProperty, onApproveJob, users = [], runsAccount = true }) {
  const managesProperties = Array.isArray(properties);
  const today = new Date().toISOString().slice(0, 10);
  const slots = jobs.flatMap((j) => j.trades.map((t) => ({ job: j, trade: t, a: j.assignments[t] })));
  const open = slots.filter((s) => !s.a);
  const pending = slots.filter((s) => s.a && s.a.status === "pending" && !s.a.auto);
  const declined = slots.filter((s) => s.a && s.a.status === "declined");
  const upcoming = jobs.filter((j) => j.status !== "completed" && j.date).sort((a, b) => a.date.localeCompare(b.date));
  const nonCompliant = subs.filter((s) => DOC_KINDS.some((k) => !s[k]));
  const toReview = subs.map((s) => ({ sub: s, kinds: pendingReviewDocs(s) })).filter((x) => x.kinds.length);
  const licenseIssues = subs.filter((s) => !licenseOk(s));
  // Offers that ran out of time need a different action from ones still ticking.
  const expiredOffers = [];
  jobs.filter((j) => j.status !== "completed").forEach((j) =>
    Object.entries(j.assignments || {}).forEach(([t, a]) => {
      if (isExpired(a, now)) expiredOffers.push({ job: j, trade: t, a });
    }));
  // Anyone who wasn't declined was on the job, so they can be rated.
  const unrated = slots.filter((s) => s.a && s.a.status !== "declined" && !s.a.rating
    && s.job.status === "completed");
  const committed = slots.filter((s) => s.a && (s.a.status === "accepted" || s.a.auto))
    .reduce((n, s) => n + Number(moneyRaw(s.a.value) || 0), 0);
  const readyToComplete = jobs.filter((j) => j.status !== "completed"
    && j.trades.every((t) => j.assignments[t] && (j.assignments[t].status === "accepted" || j.assignments[t].auto)));

  const first = me.name.split(" ")[0];
  const isOwner = role === "owner";
  // `properties` is null for an account with no building list. A scoped seat
  // should not exist on such an account -- but the account type is editable,
  // so somebody switching a portfolio to "general contractor" would strand
  // every owner and managing agent on it. They get an honest empty list
  // rather than a blank screen.
  const props = properties || [];
  // A request nobody has agreed to yet. The owner watches for it to clear;
  // the account has to do something about it.
  const awaitingApproval = jobs.filter((j) => j.requestedBy && !j.approvedAt);

  return (
    <main className="ss-main">
      <div className="dash-hello">
        <div>
          <h2>Good to see you, {first}</h2>
          <p>{isOwner
            ? (jobs.length === 0
                ? `Nothing scheduled at your ${props.length === 1 ? "building" : "buildings"} yet.`
                : `${jobs.length} job${jobs.length === 1 ? "" : "s"} at your ${props.length === 1 ? "building" : `${props.length} buildings`}${awaitingApproval.length ? ` · ${awaitingApproval.length} request${awaitingApproval.length === 1 ? "" : "s"} waiting on approval` : ""}`)
            : jobs.length === 0 ? "No jobs yet — create one to get started." :
              `${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${open.length} trade slot${open.length === 1 ? "" : "s"} still unassigned`}</p>
        </div>
        <div className="dash-cta">
          <button className="btn-solid" onClick={onNewJob}>
            <Plus size={15} /> {isOwner ? "Request work" : "New job"}</button>
          <button className="btn-ghost" onClick={onGoJobs}>
            <ClipboardList size={15} /> {isOwner ? "All work" : "All jobs"}</button>
        </div>
      </div>

      {runsAccount && <GettingStarted accountId={accountId} trades={trades} subs={subs} jobs={jobs}
        subLimit={subLimit} onGoAccount={onGoAccount} onInvite={onInvite}
        onAddSub={onAddSub} onNewJob={onNewJob} onGoContractors={onGoContractors}
        properties={properties} onAddProperty={onAddProperty} />}

      {/* An owner gets their own row. Reusing the account's -- unassigned
          slots, contractors missing documents -- would be showing somebody
          a work queue they cannot act on and, worse, telling a building
          owner which of the account's contractors are out of compliance. */}
      {isOwner ? (
        <div className="dash-grid g3">
          <button className="dash-card prop" onClick={onGoProperties}>
            <span className="dc-num">{props.length}</span>
            <span className="dc-lab">Your building{props.length === 1 ? "" : "s"}</span>
          </button>
          <button className="dash-card" onClick={onGoJobs}>
            <span className="dc-num">{upcoming.length}</span>
            <span className="dc-lab">Work scheduled</span>
          </button>
          <button className={`dash-card ${awaitingApproval.length ? "accent" : ""}`} onClick={onGoJobs}>
            <span className="dc-num">{awaitingApproval.length}</span>
            <span className="dc-lab">Request{awaitingApproval.length === 1 ? "" : "s"} waiting on approval</span>
          </button>
        </div>
      ) : (
      <div className={`dash-grid ${managesProperties ? "g5" : ""}`}>
        {/* For somebody running a portfolio this is the headline number, so it
            leads -- and on a narrow screen it takes the full width above the
            rest rather than leaving an odd card stranded beside a gap. */}
        {managesProperties && (
          <button className="dash-card prop" onClick={onGoProperties}>
            <span className="dc-num">{props.length}</span>
            <span className="dc-lab">{isOwner
              ? `Your building${props.length === 1 ? "" : "s"}`
              : "Properties under management"}</span>
          </button>
        )}
        <button className={`dash-card ${open.length ? "accent" : ""}`} onClick={onGoJobs}>
          <span className="dc-num">{open.length}</span>
          <span className="dc-lab">Unassigned trade slots</span>
        </button>
        <button className="dash-card" onClick={onGoJobs}>
          <span className="dc-num">{pending.length}</span>
          <span className="dc-lab">Awaiting contractor reply</span>
        </button>
        <button className={`dash-card ${nonCompliant.length ? "warn" : ""}`} onClick={onGoContractors}>
          <span className="dc-num">{nonCompliant.length}</span>
          <span className="dc-lab">Contractors missing docs</span>
        </button>
        {/* What the account pays a subcontractor is not an owner's business,
            so the card is not rendered for them at all -- the API does not
            send them the figures either. */}
        <button className="dash-card" onClick={onGoJobs}>
          <span className="dc-num">{committed ? formatMoney(committed) : "—"}</span>
          <span className="dc-lab">Committed sub spend</span>
        </button>
      </div>
      )}

      {awaitingApproval.length > 0 && (
        <section className="dash-sec">
          <h3><Building2 size={15} /> {isOwner ? "Waiting on approval" : "Asked for by owners and tenants"}
            <span className="sec-count amber">{awaitingApproval.length}</span></h3>
          {awaitingApproval.map((j) => {
            const who = users.find((u) => u.id === j.requestedBy);
            const where = props.find((p) => p.id === j.propertyId);
            return (
              <div key={j.id} className="dash-row">
                <div className="dash-row-main">
                  <div className="dr-title">{j.title}</div>
                  <span className="dr-meta">
                    {where ? where.name : "A building"}
                    {j.date ? ` · ${niceDay(j.date)}` : " · no date given"}
                    {isOwner ? " · not approved yet"
                      : ` · asked for by ${who ? who.name : "someone"}${
                          who?.role === "tenant"
                            ? ` (tenant${who.unit ? `, unit ${who.unit}` : ""})`
                            : who?.role === "owner" ? " (owner)" : ""}`}
                  </span>
                </div>
                {!isOwner && (
                  <button className="btn-solid dash-row-btn" onClick={() => onApproveJob(j.id)}>
                    <Check size={14} /> Approve</button>
                )}
              </div>
            );
          })}
          {!isOwner && (
            <p className="rollup-note">Approving turns a request into a job you can price and
              assign. Nothing reaches a contractor until you do.</p>
          )}
        </section>
      )}

      {!isOwner && open.length > 0 && (
        <section className="dash-sec">
          <h3><AlertTriangle size={15} /> Needs a contractor <span className="sec-count amber">{open.length}</span></h3>
          {open.slice(0, 6).map(({ job, trade }) => {
            const M = catMeta(trade);
            return (
              <div key={`${job.id}-${trade}`} className="dash-row">
                <div className={`trade-icon cat-${trade}`}><M.icon size={15} /></div>
                <div className="dash-row-main">
                  <span className="dr-title">{job.title}</span>
                  <span className="dr-meta">{M.label} · {formatWhen(job.date, job.time) || "no date"}{job.zip ? ` · ${job.zip}` : ""}</span>
                </div>
                <button className="btn-solid dash-row-btn" onClick={() => onAssign(job, trade)}>
                  <Plus size={13} /> Assign
                </button>
              </div>
            );
          })}
          {open.length > 6 && <button className="dash-more" onClick={onGoJobs}>View all {open.length} open slots →</button>}
        </section>
      )}

      {!isOwner && expiredOffers.length > 0 && (
        <section className="dash-sec">
          <h3><Clock size={15} /> No reply — needs re-matching
            <span className="sec-count red">{expiredOffers.length}</span></h3>
          {expiredOffers.map(({ job, trade, a }) => (
            <div key={`${job.id}-${trade}`} className="dash-row">
              <div className="dash-avatar">{(a.company || "?").split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
              <div className="dash-row-main">
                <span className="dr-title" onClick={() => onGoJobs()}>{job.title}</span>
                <span className="dr-meta">
                  {catMeta(trade).label} · {a.company} didn't reply by {new Date(a.respondBy)
                    .toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              <button className="btn-solid dash-row-btn"
                onClick={() => onAssign(job, trade, a.subId)}>
                <Zap size={13} /> Find alternatives
              </button>
            </div>
          ))}
        </section>
      )}

      {!isOwner && licenseIssues.length > 0 && (
        <section className="dash-sec">
          <h3><Shield size={15} /> Registration problems <span className="sec-count red">{licenseIssues.length}</span></h3>
          {licenseIssues.map((s) => (
            <div key={s.id} className="dash-row">
              <div className="dash-avatar">{s.company.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
              <div className="dash-row-main">
                <span className="dr-title" onClick={() => onOpenSub(s)}>{s.company}</span>
                <span className="dr-meta">
                  {!s.license ? "No L&I license number on file"
                    : !s.licenseCheck ? `${s.license} — not yet verified`
                    : `${s.license} — ${s.licenseCheck.status.toLowerCase()}${s.licenseCheck.expirationDate ? `, expired ${s.licenseCheck.expirationDate}` : ""}`}
                </span>
              </div>
              <button className="btn-solid dash-row-btn" onClick={() => onVerifyLicense(s)}>
                <Shield size={13} /> {s.licenseCheck ? "Re-check" : "Verify"}
              </button>
            </div>
          ))}
        </section>
      )}

      {!isOwner && toReview.length > 0 && (
        <section className="dash-sec">
          <h3><Shield size={15} /> Documents to verify <span className="sec-count amber">{toReview.reduce((n, x) => n + x.kinds.length, 0)}</span></h3>
          {toReview.map(({ sub, kinds }) => (
            <div key={sub.id} className="dash-row">
              <div className="dash-avatar">{sub.company.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
              <div className="dash-row-main">
                <span className="dr-title" onClick={() => onOpenSub(sub)}>{sub.company}</span>
                <span className="dr-meta">Uploaded, awaiting review: {kinds.map((k) => DOC_LABELS[k]).join(", ")}</span>
              </div>
              <button className="btn-solid dash-row-btn" onClick={() => onReviewDoc(sub, kinds[0])}>
                <Shield size={13} /> Review
              </button>
            </div>
          ))}
        </section>
      )}

      {!isOwner && nonCompliant.length > 0 && (
        <section className="dash-sec">
          <h3><AlertTriangle size={15} /> Awaiting documents <span className="sec-count red">{nonCompliant.length}</span></h3>
          {nonCompliant.map((s) => (
            <div key={s.id} className="dash-row">
              <div className="dash-avatar">{s.company.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
              <div className="dash-row-main">
                <span className="dr-title" onClick={() => onOpenSub(s)}>{s.company}</span>
                <span className="dr-meta">Not uploaded: {DOC_KINDS.filter((k) => !s[k]).map((k) => DOC_LABELS[k]).join(", ")}</span>
              </div>
              <button className="btn-notify dash-row-btn" onClick={() => onRequestDocs(s)}>
                <Mail size={13} /> Request
              </button>
            </div>
          ))}
        </section>
      )}

      {!isOwner && declined.length > 0 && (
        <section className="dash-sec">
          <h3><XCircle size={15} /> Declined — needs reassigning <span className="sec-count red">{declined.length}</span></h3>
          {declined.map(({ job, trade, a }) => {
            const M = catMeta(trade);
            return (
              <div key={`${job.id}-${trade}`} className="dash-row">
                <div className={`trade-icon cat-${trade}`}><M.icon size={15} /></div>
                <div className="dash-row-main">
                  <span className="dr-title">{job.title}</span>
                  <span className="dr-meta">{a.company} declined {M.label}</span>
                </div>
                <button className="btn-solid dash-row-btn" onClick={onGoJobs}>Review</button>
              </div>
            );
          })}
        </section>
      )}

      {!isOwner && readyToComplete.length > 0 && (
        <section className="dash-sec">
          <h3><CheckCircle2 size={15} /> Ready to mark complete <span className="sec-count">{readyToComplete.length}</span></h3>
          {readyToComplete.slice(0, 5).map((j) => (
            <div key={j.id} className="dash-row">
              <div className="dash-avatar"><CheckCircle2 size={15} /></div>
              <div className="dash-row-main">
                <span className="dr-title">{j.title}</span>
                <span className="dr-meta">All {j.trades.length} trade{j.trades.length > 1 ? "s" : ""} accepted · complete it to rate crews</span>
              </div>
              <button className="btn-solid dash-row-btn" onClick={onGoJobs}>Review</button>
            </div>
          ))}
        </section>
      )}

      <section className="dash-sec">
        <h3><Calendar size={15} /> {isOwner ? "Coming up at your buildings" : "Upcoming jobs"}
          {upcoming.length > 0 && <span className="sec-count">{upcoming.length}</span>}</h3>
        {upcoming.length === 0 ? (
          <div className="dash-empty">
            <ClipboardList size={24} /><p>Nothing scheduled yet.</p>
            {/* The empty state named the problem and then offered no way out
                of it; the button is the whole reason somebody reads this. */}
            <button className="btn-solid dash-empty-btn" onClick={onNewJob}>
              <Plus size={15} /> {isOwner ? "Request work" : "New job"}</button>
          </div>
        ) : upcoming.slice(0, 5).map((j) => {
          const filled = j.trades.filter((t) => j.assignments[t]).length;
          return (
            <div key={j.id} className="dash-row" onClick={onGoJobs}>
              <div className="dash-date">
                <span className="dd-mon">{new Date(`${j.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span>
                <span className="dd-day">{new Date(`${j.date}T12:00:00`).getDate()}</span>
              </div>
              <div className="dash-row-main">
                <span className="dr-title">{j.title}</span>
                <span className="dr-meta">
                  {[j.area, j.zip].filter(Boolean).join(" ")} · {filled}/{j.trades.length} trades
                  {j.sqft ? ` · ${Number(j.sqft).toLocaleString()} sq ft` : ""}
                </span>
              </div>
              <span className={`fill-badge ${filled === j.trades.length ? "full" : ""}`}>{filled}/{j.trades.length}</span>
            </div>
          );
        })}
      </section>

      {!isOwner && unrated.length > 0 && (
        <section className="dash-sec">
          <h3><Star size={15} /> Completed, not yet rated <span className="sec-count">{unrated.length}</span></h3>
          {unrated.slice(0, 5).map(({ job, trade, a }) => (
            <div key={`${job.id}-${trade}`} className="dash-row" onClick={onGoJobs}>
              <div className="dash-avatar">{(a.company || "?").split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
              <div className="dash-row-main">
                <span className="dr-title">{job.title}</span>
                <span className="dr-meta">{a.crewName || a.company} · {catMeta(trade).label}</span>
              </div>
              <button className="btn-ghost dash-row-btn" onClick={onGoJobs}>Rate</button>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

// ---- Availability calendar ----------------------------------------------
function AvailabilityView({ subs, jobs, allJobs, accountId, onSchedule, onRequestDocs }) {
  const today = new Date();
  const days = [...Array(14)].map((_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i); return d;
  });
  const fmt = (d) => d.toISOString().slice(0, 10);
  const jobsByDay = useMemo(() => {
    const map = {};
    jobs.forEach((j) => { (map[j.date] ||= []).push(j); });
    return map;
  }, [jobs]);

  return (
    <main className="ss-main">
      <div className="cal-legend">
        <span><span className="lg up" /> Available</span>
        <span><span className="lg down" /> Not available</span>
        <span><span className="lg booked" /> Booked job</span>
        <span><span className="lg needdocs" /> Docs needed — click to request</span>
        <span className="cal-hint">Click an available day to assign</span>
      </div>
      <div className="cal-wrap">
        <div className="cal-grid">
          <div className="cal-corner">Contractor <span className="cc-note">free crews</span></div>
          {days.map((d) => (
            <div key={fmt(d)} className="cal-dayhead">
              <span className="dow">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <span className="dom">{d.getDate()}</span>
            </div>
          ))}
          {subs.map((s) => {
            const ready = s.bond && s.insurance && s.contract;
            return (
              <React.Fragment key={s.id}>
                <div className="cal-sub">
                  <span className={`avail-dot ${s.available ? "up" : "down"}`} />
                  <span className="cal-sub-name">{s.company}</span>
                </div>
                {days.map((d) => {
                  const dayJobs = (jobsByDay[fmt(d)] || []).filter((j) =>
                    Object.values(j.assignments || {}).some((a) => a.subId === s.id));
                  const booked = dayJobs.length > 0;
                  const dayKey = fmt(d);
                  const free = availableOn(s, dayKey);
                  const cls = booked ? "booked" : free ? "up" : "down";
                  const clickable = !booked && free && ready;
                  const dstat = dayStatus(s, allJobs, dayKey, null, accountId);
                  const freeCt = dstat?.crews?.length || 0;
                  const needDocs = !ready && !booked && free;
                  const title = booked ? dayJobs.map((j) => j.title).join(", ")
                    : !s.available ? "Not taking work"
                    : !free ? (dstat?.label || "No crews free this day")
                    : !ready ? `Available — complete docs to schedule`
                    : dstat?.label || `Assign ${s.company} to a job`;
                  return (
                    <div key={dayKey}
                      className={`cal-cell ${cls} ${clickable ? "clickable" : ""} ${needDocs ? "needdocs" : ""}`}
                      title={needDocs
                        ? `Missing ${missingDocs(s).map((k) => DOC_LABELS[k]).join(", ")} — click to request documents`
                        : title}
                      onClick={clickable ? () => onSchedule(s, dayKey)
                        : needDocs ? () => onRequestDocs(s) : undefined}>
                      {booked ? <span className="cal-job">{dayJobs.length}</span>
                        : needDocs ? <span className="cal-doc"><Mail size={11} /></span>
                        : clickable ? <span className="cal-crews">{freeCt}</span> : null}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// ---- Create job ----------------------------------------------------------
// The job holds every project fact. Work orders are derived from it on assign.
function JobForm({ onSubmit, onCancel, forSub, jobs, allJobs, accountId, properties, forProperty, asOwner = false }) {
  // An owner with one building never has a choice to make, so it is made for
  // them rather than presented as an empty select they must fill in.
  const onlyOne = asOwner && (properties || []).length === 1 ? properties[0] : null;
  const start = forProperty || onlyOne;
  const [f, setF] = useState({
    title: start ? `${start.name} — ` : "",
    client: "", propertyId: start ? start.id : "",
    address: start ? start.address || "" : "",
    area: start ? start.city || "" : "",
    zip: start ? start.zip || "" : "",
    sqft: "", stories: "",
    date: "", time: "07:00",
    trades: forSub ? [...forSub.categories] : [],
    scope: "", materialSource: "", materialsPaidBy: "Outerhome",
    measurementDocs: [],
  });
  // Picking a property fills the address, so it isn't retyped per job.
  const pickProperty = (id) => {
    const p = (properties || []).find((x) => x.id === id);
    setF((s) => ({ ...s, propertyId: id,
      ...(p ? { address: p.address || "", area: p.city || "", zip: p.zip || "",
                title: s.title || `${p.name} — ` } : {}) }));
  };
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleTrade = (id) => setF((s) => ({ ...s, trades: s.trades.includes(id) ? s.trades.filter((x) => x !== id) : [...s.trades, id] }));
  const when = formatWhen(f.date, f.time);
  // A request has to name a building: it is the only thing that decides whose
  // it is, and the server refuses one without.
  const valid = f.title && f.trades.length && f.address && (!asOwner || f.propertyId);

  return (
    <div className="form">
      <h2>{asOwner ? "Request work" : "Create job"}</h2>
      <p className="form-sub">{asOwner
        ? "This goes to whoever manages the building. They price it and arrange the contractors — nothing is booked until they approve it."
        : "Enter the project once. Work orders are generated per trade when you assign contractors."}</p>
      {forSub && (
        <div className={`for-sub ${docsComplete(forSub) ? "" : "warn"}`}>
          {docsComplete(forSub)
            ? <><CheckCircle2 size={14} /> {forSub.company} will be assigned to the trades they cover, and a work order issued.</>
            : <><AlertTriangle size={14} /> {forSub.company} has outstanding documents — trades will be left open.</>}
        </div>
      )}

      <div className="form-sec">1 · Project</div>
      {(properties || []).length > 0 && (
        <label className="fld">
          {asOwner ? "Which building" : "Property"}
          <span className="fld-note">{asOwner
            ? "Only the buildings you have access to"
            : "fills the address and scopes vendor matching"}</span>
          <select value={f.propertyId} onChange={(e) => pickProperty(e.target.value)}>
            {/* An owner has no "somewhere else" to pick: work they ask for is
                at one of their own buildings or it is not theirs to ask for. */}
            {!asOwner && <option value="">Not at a managed property</option>}
            {asOwner && !f.propertyId && <option value="">Choose a building…</option>}
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      <label className="fld">Job name<input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 1420 Maple St — full exterior" /></label>
      <label className="fld">Homeowner / client<input value={f.client} onChange={(e) => set("client", e.target.value)} placeholder="Client name" /></label>
      <label className="fld">Service address<input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="1420 Maple St" /></label>
      <div className="fld-row">
        <label className="fld">City
          <select value={f.area} onChange={(e) => { set("area", e.target.value); if (CITY_ZIP[e.target.value]) set("zip", CITY_ZIP[e.target.value]); }}>
            <option value="">Select…</option>
            {AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="fld">ZIP<input inputMode="numeric" value={f.zip} onChange={(e) => set("zip", e.target.value.trim())} placeholder="98101" /></label>
      </div>
      <div className="fld-row">
        <label className="fld">Square footage<input inputMode="numeric" value={f.sqft} onChange={(e) => set("sqft", e.target.value.replace(/[^0-9]/g, ""))} placeholder="2400" /></label>
        <label className="fld">Stories<input inputMode="numeric" value={f.stories} onChange={(e) => set("stories", e.target.value.replace(/[^0-9]/g, ""))} placeholder="2" /></label>
      </div>

      <div className="form-sec">2 · Schedule</div>
      <div className="fld-row">
        <label className="fld">Start date<input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
        <label className="fld">Start time<input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} /></label>
      </div>
      {when && <div className="when-preview"><Calendar size={14} /> Starts <strong>{when}</strong></div>}
      {forSub && f.date && (() => {
        const day = dayStatus(forSub, allJobs || jobs, f.date, null, accountId);
        if (!day || day.kind === "free") return (
          <div className="for-sub"><CheckCircle2 size={14} /> {forSub.company} is free on {formatDay(f.date)}.</div>
        );
        return (
          <div className="for-sub warn">
            <AlertTriangle size={14} />
            <span>{forSub.company} {day.kind === "off" ? `has ${formatDay(f.date)} marked off`
              : day.kind === "booked" ? `is already booked on ${formatDay(f.date)}` : "isn't taking work"} — pick another date.</span>
          </div>
        );
      })()}

      <div className="form-sec">3 · Trades needed</div>
      <div className="fld">
        <div className="pick-grid">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" className={`pick ${f.trades.includes(c.id) ? "on" : ""}`} onClick={() => toggleTrade(c.id)}>{c.label}</button>
          ))}
        </div>
        {f.trades.length > 1 && <p className="cov-hint">{f.trades.length} trades — each gets its own contractor and work order.</p>}
      </div>
      <label className="fld">Overall scope<textarea rows={3} value={f.scope} onChange={(e) => set("scope", e.target.value)} placeholder="What the job covers end to end…" /></label>

      <div className="form-sec">4 · Materials</div>
      <label className="fld">Material source / supplier<input value={f.materialSource} onChange={(e) => set("materialSource", e.target.value)} placeholder="e.g. ABC Supply — Ballard" /></label>
      <label className="fld">Materials paid by
        <select value={f.materialsPaidBy} onChange={(e) => set("materialsPaidBy", e.target.value)}>
          <option>Outerhome</option><option>Subcontractor (reimbursed)</option>
        </select>
      </label>

      <div className="form-sec">5 · Measurement documents</div>
      <p className="sec-note">Uploaded by you — contractors see these on their work order.</p>
      <div className="meas-list">
        {f.measurementDocs.map((d) => (
          <div key={d} className="meas-row">
            <FileText size={14} /><span className="meas-name">{d}</span>
            <button type="button" className="icon-x" onClick={() => set("measurementDocs", f.measurementDocs.filter((x) => x !== d))}><X size={12} /></button>
          </div>
        ))}
        <label className="meas-upload">
          <Upload size={14} /> Upload measurements, takeoff, or drawings
          <input type="file" hidden multiple onChange={(e) => {
            const names = [...e.target.files].map((x) => x.name);
            set("measurementDocs", [...new Set([...f.measurementDocs, ...names])]);
          }} />
        </label>
      </div>

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-solid" onClick={() => onSubmit(f)} disabled={!valid}>
          <Plus size={15} /> {asOwner ? "Send this request" : <>Create job &amp; find contractors</>}
        </button>
      </div>
    </div>
  );
}
// ---- Pick a contractor for one trade slot --------------------------------
function PickContractor({ job, trade, subs, jobs, allJobs, accountId, replacing, onPick, onNotify, onCancel }) {
  // When re-matching after an expiry, the sub who didn't reply drops off the list.
  const pool = replacing ? subs.filter((x) => x.id !== replacing) : subs;
  const lapsed = replacing ? subs.find((x) => x.id === replacing) : null;
  const [chosen, setChosen] = useState(null);
  // One scope + value PER TRADE. Bundling a sub across two trades must not
  // copy the same money onto both.
  const [lines, setLines] = useState({});        // { [trade]: { on, scope, value } }
  const [crewPick, setCrewPick] = useState("");
  const [respWindow, setRespWindow] = useState(DEFAULT_WINDOW);
  const setLine = (t, patch) => setLines((l) => ({ ...l, [t]: { ...l[t], ...patch } }));
  // Trades on this job still unassigned that the chosen sub also covers.
  const bundleable = (sb) => (job.trades || []).filter((t) =>
    t !== trade && !job.assignments?.[t] && sb.categories.includes(t));
  const openLines = chosen
    ? [trade, ...bundleable(chosen).filter((t) => lines[t]?.on)]
    : [trade];
  const lineTotal = openLines.reduce((n, t) => n + Number(moneyRaw(lines[t]?.value || "") || 0), 0);
  const pickSub = (sb) => {
    const init = { [trade]: { on: true, scope: "", value: "" } };
    bundleable(sb).forEach((t) => { init[t] = { on: false, scope: "", value: "" }; });
    setLines(init);
    const fc = dayStatus(sb, allJobs || jobs, job.date, job.id, accountId)?.crews || sb.crews || [];
    setCrewPick(fc[0]?.name || "");
    setChosen(sb);
  };
  // crews of the chosen contractor that are free on this job's date
  const freeForDay = chosen
    ? (dayStatus(chosen, allJobs || jobs, job.date, job.id, accountId)?.crews || chosen.crews || [])
    : [];
  const M = catMeta(trade);
  const alreadyOn = Object.values(job.assignments || {}).map((a) => a.subId);
  const ranked = useMemo(() => pool
    .filter((s) => s.categories.includes(trade))
    .map((s) => {
      const prox = job.zip ? coversZip(s, job.zip) : null;
      const docs = s.bond && s.insurance && s.contract;
      const day = dayStatus(s, allJobs || jobs, job.date, job.id, accountId);
      // Bundling bonus: one sub covering several of this job's open trades
      // means one crew, one mobilization and one point of contact, so rank
      // them ahead of a single-trade sub of similar standing.
      const covers = (job.trades || []).filter((t) =>
        !job.assignments?.[t] && s.categories.includes(t));
      // A vendor scoped to other properties shouldn't surface for this job.
      const onProperty = !job.propertyId || !(s.propertyIds || []).length
        || s.propertyIds.includes(job.propertyId);
      let score = s.rating * 4 + (docs ? 25 : 0) + (s.available ? 15 : 0) + (s.autoSchedule ? 30 : 0);
      score += Math.max(0, covers.length - 1) * 35;
      score += onProperty ? 0 : -1000;   // effectively removes off-property vendors
      if (prox?.inRange) score += 20;
      if (prox?.distance != null) score -= Math.min(prox.distance, 40) * 0.5;
      // day-level availability against this job's date
      if (day?.kind === "free") score += 25;
      if (day?.kind === "booked") score -= 40;
      if (day?.kind === "off") score -= 60;
      return { sub: s, prox, docs, day, score, covers, onProperty, dup: alreadyOn.includes(s.id) };
    })
    .filter((r) => r.onProperty)
    .sort((a, b) => b.score - a.score), [pool, trade, job, jobs, allJobs, accountId]);

  // Step 2: the only details a work order adds on top of the job
  if (chosen) {
    return (
      <div className="form">
        <h2>Work order details</h2>
        <p className="form-sub">{chosen.company} · {M.label} · {job.title}</p>
        <label className="fld">Response deadline
        <span className="fld-note">how long they have to accept before the offer expires</span>
        <select value={respWindow} onChange={(e) => setRespWindow(e.target.value)}>
          {RESPONSE_WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </label>
      {chosen && chosen.autoSchedule ? (
        <p className="cov-hint">{chosen.company} has auto-schedule on — the job books straight
          onto their calendar, so no deadline applies.</p>
      ) : (
        <p className="cov-hint">Expires {new Date(Date.now() + windowMins(respWindow) * 60000)
          .toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit" })}. If they don't reply by then you'll be
          prompted to match someone else.</p>
      )}

      {freeForDay.length > 0 && (
        <label className="fld">Crew <span className="fld-note">crews free on {formatDay(job.date) || "this job"}</span>
          <select value={crewPick} onChange={(e) => setCrewPick(e.target.value)}>
            {freeForDay.map((c) => <option key={c.id} value={c.name}>{c.name} ({c.members.length} people)</option>)}
          </select>
        </label>
      )}
      <div className="wo-inherit">
          <ScrollText size={14} />
          <div>
            <strong>Inherited from the job:</strong> address, {job.sqft ? `${Number(job.sqft).toLocaleString()} sq ft, ` : ""}
            schedule, materials{(job.measurementDocs || []).length ? `, ${job.measurementDocs.length} measurement doc${job.measurementDocs.length > 1 ? "s" : ""}` : ""}.
          </div>
        </div>
        {bundleable(chosen).length > 0 && (
          <div className="bundle-box">
            <Layers size={15} />
            <div>
              <strong>{chosen.company} also covers {bundleable(chosen).map((t) => catMeta(t).label.toLowerCase()).join(" and ")} on this job.</strong>
              <span className="bundle-sub">Add them below and each trade gets its own work
                order, scope and value — one crew on site instead of two.</span>
            </div>
          </div>
        )}

        <div className="form-sec">Work orders to issue</div>
        {[trade, ...bundleable(chosen)].map((t) => {
          const TM = catMeta(t);
          const isPrimary = t === trade;
          const on = isPrimary || !!lines[t]?.on;
          return (
            <div key={t} className={`wo-line ${on ? "on" : ""}`}>
              <div className="wol-head">
                {isPrimary ? (
                  <span className="wol-title"><TM.icon size={14} /> {TM.label}
                    <span className="wol-tag">this assignment</span></span>
                ) : (
                  <label className="wol-check">
                    <input type="checkbox" checked={!!lines[t]?.on}
                      onChange={(e) => setLine(t, { on: e.target.checked })} />
                    <TM.icon size={14} /> {TM.label}
                    <span className="wol-tag alt">also available</span>
                  </label>
                )}
                {on && lines[t]?.value && (
                  <span className="wol-val">{formatMoney(lines[t].value)}</span>
                )}
              </div>
              {on && (
                <div className="wol-body">
                  <label className="fld">Scope for {TM.label.toLowerCase()}
                    <textarea rows={2} value={lines[t]?.scope || ""}
                      onChange={(e) => setLine(t, { scope: e.target.value })}
                      placeholder={`${TM.label} work included in this work order…`} />
                  </label>
                  <label className="fld">Subcontractor value for {TM.label.toLowerCase()}
                    <span className="fld-note">their pay for this trade only</span>
                    <MoneyInput value={lines[t]?.value || ""}
                      onChange={(v) => setLine(t, { value: v })} />
                  </label>
                </div>
              )}
            </div>
          );
        })}

        {openLines.length > 1 && (
          <div className="wol-total">
            <span>{openLines.length} work orders</span>
            <strong>{formatMoney(lineTotal)} total to {chosen.company}</strong>
          </div>
        )}

        <div className="form-actions">
          <button className="btn-ghost" onClick={() => setChosen(null)}>Back</button>
          <button className="btn-solid"
            disabled={openLines.some((t) => !lines[t]?.value)}
            onClick={() => onPick(chosen, {
              crewName: crewPick || freeForDay[0]?.name || null,
              responseWindow: respWindow,
              trades: openLines.map((t) => ({
                trade: t, tradeScope: lines[t]?.scope || "", value: lines[t]?.value || "" })),
            })}>
            <Send size={15} /> Issue {openLines.length > 1 ? `${openLines.length} work orders` : "work order"}
          </button>
        </div>
        {openLines.some((t) => !lines[t]?.value) && (
          <p className="cov-hint">Enter a value for each trade you're issuing.</p>
        )}
      </div>
    );
  }

  return (
    <div className="form">
      <h2>{replacing ? `Find an alternative ${M.label.toLowerCase()} contractor`
        : `Assign ${M.label.toLowerCase()} contractor`}</h2>
      {lapsed && (
        <div className="doc-block" style={{ marginBottom: 14, marginTop: 10 }}>
          <Clock size={15} />
          <div><strong>{lapsed.company} didn't reply in time.</strong> They've been left off the
            list below. The job and its details are unchanged — pick someone else and a new work
            order is issued.</div>
        </div>
      )}
      <p className="form-sub">{job.title}
        {job.date ? ` · ${formatWhen(job.date, job.time) || job.date}` : " · no date set"}
        {job.zip ? ` · from ${job.zip}` : ""}</p>
      {job.date && <p className="pick-hint">Contractors free on this date are ranked first.</p>}
      {ranked.length === 0 ? (
        <div className="empty"><Search size={26} /><p>No contractors cover {M.label.toLowerCase()}.</p></div>
      ) : (
        <div className="pick-list">
          {ranked.map(({ sub, prox, docs, day, covers, dup }, i) => (
            <div key={sub.id} className="pick-row">
              <div className="rec-rank">{i + 1}</div>
              <div className="rec-main">
                <div className="rec-head">
                  <h4>{sub.company}</h4>
                  <Stars value={sub.rating} />
                  <span className={`avail-dot ${sub.available ? "up" : "down"}`} />
                </div>
                <div className="rec-tags">
                  <span className="cap">{crewCount(sub)} crews · {headCount(sub)} ppl</span>
                  {sub.autoSchedule && <span className="auto-badge"><Zap size={11} /> Auto-schedule</span>}
                  {prox && prox.distance != null && (
                    <span className={`prox-badge ${prox.inRange ? "in" : "out"}`}><Target size={11} /> {prox.distance} mi{prox.inRange ? "" : " · out"}</span>
                  )}
                  {docs ? <span className="rec-ok"><Shield size={11} /> Docs complete</span>
                    : <span className="rec-warn"><AlertTriangle size={11} /> {complianceGaps(sub).length} outstanding</span>}
                  {covers && covers.length > 1 && (
                    <span className="rec-bundle">
                      <Layers size={11} /> covers {covers.length} trades on this job
                    </span>
                  )}
                  {dup && <span className="rec-dup">already on this job</span>}
                </div>
              </div>
              {docs ? (
                <button className={`rec-send ${day && (day.kind === "off" || day.kind === "booked" || day.kind === "unavailable") ? "btn-warn" : "btn-solid"}`}
                  title={day && day.kind !== "free" ? day.label : undefined}
                  onClick={() => pickSub(sub)}>
                  <Send size={14} /> {day && day.kind !== "free" && day.kind !== undefined && job.date ? "Select anyway" : "Select"}
                </button>
              ) : (
                <button className="btn-notify rec-send" onClick={() => onNotify(sub)}>
                  <Mail size={14} /> Request docs
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="form-actions"><button className="btn-ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

// ---- Pick which job + trade to put a contractor on -----------------------
function PickJobSlot({ sub, jobs, allJobs, accountId, onPick, onNewJob, onNotify, onRequestDocs, onCancel }) {
  const ok = docsComplete(sub);
  const off = sub.unavailableDays || [];
  const rank = { free: 0, booked: 1, off: 2, unavailable: 3 };
  const slots = jobs.flatMap((j) =>
    j.trades
      .filter((t) => !j.assignments[t] && sub.categories.includes(t))
      .map((t) => ({ job: j, trade: t }))
  ).sort((a, b) => {
    const ka = rank[dayStatus(sub, allJobs || jobs, a.job.date, a.job.id, accountId)?.kind] ?? 9;
    const kb = rank[dayStatus(sub, allJobs || jobs, b.job.date, b.job.id, accountId)?.kind] ?? 9;
    return ka - kb;
  });
  // Ask first: existing job or brand-new one?
  const [mode, setMode] = useState(null);

  if (!ok) {
    return (
      <div className="form">
        <h2>Assign {sub.company}</h2>
        <div className="doc-block">
          <AlertTriangle size={15} />
          <div>
            <strong>Can't assign yet.</strong> Outstanding: {complianceGaps(sub).join(", ")}.
            Send a request and they'll be assignable once the paperwork is in.
          </div>
        </div>
        {slots.length > 0 && (
          <>
            <p className="form-sub">They were matched to {slots.length} open slot{slots.length > 1 ? "s" : ""}:</p>
            <div className="pick-list">
              {slots.map(({ job, trade }) => {
                const M = catMeta(trade);
                return (
                  <div key={`${job.id}-${trade}`} className="pick-row">
                    <div className={`trade-icon cat-${trade}`}><M.icon size={15} /></div>
                    <div className="rec-main">
                      <div className="rec-head"><h4>{job.title}</h4></div>
                      <div className="rec-tags">
                        <span className={`cat-badge cat-${trade}`}>{M.label}</span>
                        <span className="cap">{formatWhen(job.date, job.time) || "No date"}</span>
                      </div>
                    </div>
                    <button className="btn-notify rec-send" onClick={() => onNotify(job, trade)}><Mail size={14} /> Request docs</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="form-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-notify" onClick={() => onRequestDocs(sub)}><Mail size={15} /> Request documents</button>
        </div>
      </div>
    );
  }

  // Step 1: choose the path
  if (mode === null) {
    return (
      <div className="form">
        <h2>Assign {sub.company}</h2>
        <p className="form-sub">Add them to a job you've already created, or set up a new one.</p>
        <div className="assign-choice">
          <button className="ac-card" disabled={slots.length === 0} onClick={() => setMode("existing")}>
            <ClipboardList size={22} />
            <span className="ac-title">Assign to an existing job</span>
            <span className="ac-desc">
              {slots.length === 0
                ? "No open trade slots match their trades"
                : `${slots.length} open slot${slots.length > 1 ? "s" : ""} they can cover`}
            </span>
            {slots.length > 0 && <ChevronRight size={16} className="ac-arrow" />}
          </button>
          <button className="ac-card" onClick={onNewJob}>
            <Plus size={22} />
            <span className="ac-title">Create a new job for them</span>
            <span className="ac-desc">Pre-fills their trades and assigns them on creation</span>
            <ChevronRight size={16} className="ac-arrow" />
          </button>
        </div>
        {off.length > 0 && (
          <div className="off-days"><XCircle size={13} /> Marked off: {off.slice().sort().map(formatDay).join(", ")}</div>
        )}
        <div className="form-actions"><button className="btn-ghost" onClick={onCancel}>Cancel</button></div>
      </div>
    );
  }

  // Step 2: pick the slot
  return (
    <div className="form">
      <h2>Pick a job for {sub.company}</h2>
      <p className="form-sub">Open trade slots they can cover · free dates first</p>
      <div className="pick-list">
        {slots.map(({ job, trade }) => {
          const M = catMeta(trade);
          const prox = job.zip ? coversZip(sub, job.zip) : null;
          const day = dayStatus(sub, allJobs || jobs, job.date, job.id, accountId);
          return (
            <div key={`${job.id}-${trade}`} className="pick-row">
              <div className={`trade-icon cat-${trade}`}><M.icon size={15} /></div>
              <div className="rec-main">
                <div className="rec-head"><h4>{job.title}</h4></div>
                <div className="rec-tags">
                  <span className={`cat-badge cat-${trade}`}>{M.label}</span>
                  <span className="cap">{formatWhen(job.date, job.time) || "No date"}</span>
                  {day && (
                    <span className={`day-badge d-${day.kind}`} title={day.label}>
                      {day.kind === "free" ? <><CheckCircle2 size={11} /> Free</>
                        : day.kind === "booked" ? <><Calendar size={11} /> Already booked</>
                        : day.kind === "off" ? <><XCircle size={11} /> Marked off</>
                        : <><AlertTriangle size={11} /> Not taking work</>}
                    </span>
                  )}
                  {prox && prox.distance != null && (
                    <span className={`prox-badge ${prox.inRange ? "in" : "out"}`}><Target size={11} /> {prox.distance} mi{prox.inRange ? "" : " · out"}</span>
                  )}
                </div>
              </div>
              <button className={`rec-send ${day && day.kind !== "free" ? "btn-warn" : "btn-solid"}`}
                onClick={() => onPick(job, trade)}>
                <Send size={14} /> {day && day.kind !== "free" ? "Assign anyway" : "Assign"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        <button className="btn-ghost" onClick={() => setMode(null)}>Back</button>
        <button className="btn-solid" onClick={onNewJob}><Plus size={15} /> New job instead</button>
      </div>
    </div>
  );
}
// ---- Contractor portal (contractor role) ---------------------------------
function ContractorPortal({ sub, jobs, pane, mine, brand, me, orders, now, serviceCalls, onConfirmCall, changeOrders, onRespondCO, onVoidCO, onRequestChange, onOrderUniform, onGoDocs, onViewWO, onToggleCrewDay, onToggleCrewAvailable, onSetAutoSchedule, onSetWarranty, onSetCategories, onSetCaps, onUploadDoc, onDeleteDoc, onRespond, onSetCrews, onSetCoverage }) {
  const [sub2, setSub2] = useState("trades");
  const caps = [...new Set(sub.categories.flatMap((c) => CAP_LIBRARY[c] || []))];
  const miss = missingDocs(sub);
  const today = new Date().toISOString().slice(0, 10);

  const first = (me?.name || sub.contact || sub.company).split(" ")[0];
  const pending = mine.filter((m) => m.a.status === "pending" && !m.a.auto);
  const accepted = mine.filter((m) => m.a.status === "accepted" || m.a.auto);
  const upcoming = accepted.filter((m) => m.job.status !== "completed")
    .sort((a, b) => (a.job.date || "9").localeCompare(b.job.date || "9"));
  const past = accepted.filter((m) => m.job.status === "completed");
  const declined = mine.filter((m) => m.a.status === "declined");
  const earnings = accepted.reduce((n, m) => n + Number(moneyRaw(m.a.value) || 0), 0);

  return (
    <main className="ss-main">
      {miss.length > 0 && pane !== "docs" && (
        <div className="doc-block with-cta">
          <AlertTriangle size={15} />
          <div><strong>Action needed.</strong> You can't be assigned jobs until you upload: {miss.map((k) => DOC_LABELS[k]).join(", ")}.</div>
          <button className="btn-notify" onClick={onGoDocs}>
            <Upload size={14} /> Upload {miss.length === 1 ? "document" : "documents"}
          </button>
        </div>
      )}

      {pane === "jobs" && (
        <>
          {(changeOrders || []).filter((c) => c.status === "pending").length > 0 && (
            <section className="portal-sec">
              <h3><FilePlus2 size={15} /> Change orders
                <span className="sec-count amber">
                  {(changeOrders || []).filter((c) => c.status === "pending" && c.origin === "gc").length}
                </span>
              </h3>
              <p className="portal-sec-note">
                A change to a work order you already accepted. Accepting updates your pay for that
                job; the original work order stays as it was.
              </p>
              {(changeOrders || []).filter((c) => c.status === "pending").map((c) => (
                <ChangeOrderRow key={c.id} c={c} now={now} side="sub"
                  onRespond={onRespondCO} onVoid={onVoidCO} />
              ))}
            </section>
          )}
          {(serviceCalls || []).filter((c) => c.status !== "resolved").length > 0 && (
            <section className="portal-sec">
              <h3><Wrench size={15} /> Return visits
                <span className="sec-count amber">
                  {(serviceCalls || []).filter((c) => c.status === "awaiting-confirmation").length}
                </span>
              </h3>
              <p className="portal-sec-note">
                {brand.name} has reported an issue on a job you completed. Confirm the date and
                it's added to your schedule.
              </p>
              {(serviceCalls || []).filter((c) => c.status !== "resolved").map((c) => (
                <ServiceCallRow key={c.id} c={c} job={jobs.find((j) => j.id === c.jobId)}
                  showSubActions onConfirm={onConfirmCall} />
              ))}
            </section>
          )}
          <div className="dash-hello">
            <div>
              <h2>Good to see you, {first}</h2>
              <p>
                {pending.length > 0
                  ? `${pending.length} job request${pending.length === 1 ? "" : "s"} waiting on you`
                  : upcoming.length > 0
                    ? `${upcoming.length} job${upcoming.length === 1 ? "" : "s"} booked — nothing waiting on you`
                    : miss.length > 0
                      ? "Upload your documents to start receiving job requests"
                      : "No jobs booked right now"}
              </p>
            </div>
            <div className="who-bar">
              <div className="who-txt">
                <span className="who-me">{sub.company}</span>
                <span className="who-for">Subcontracting for {brand.name}</span>
              </div>
            </div>
          </div>
          <div className="dash-grid">
            <div className="dash-card accent">
              <span className="dc-num">{pending.length}</span>
              <span className="dc-lab">Job request{pending.length === 1 ? "" : "s"} awaiting you</span>
            </div>
            <div className="dash-card">
              <span className="dc-num">{upcoming.length}</span>
              <span className="dc-lab">Upcoming job{upcoming.length === 1 ? "" : "s"}</span>
            </div>
            <div className="dash-card">
              <span className="dc-num">{crewCount(sub)}</span>
              <span className="dc-lab">Crews · {headCount(sub)} people</span>
            </div>
            <div className="dash-card">
              <span className="dc-num">{earnings ? formatMoney(earnings) : "—"}</span>
              <span className="dc-lab">Booked value</span>
            </div>
          </div>

          {sub.autoSchedule && (
            <div className="auto-strip"><Zap size={14} /> Auto-schedule is on — jobs matching your availability are booked directly.</div>
          )}

          {pending.length > 0 && (
            <section className="dash-sec">
              <h3><Clock size={15} /> Job requests <span className="sec-count amber">{pending.length}</span></h3>
              {pending.map((m) => <JobRequestCard key={`${m.job.id}-${m.trade}`} {...m} onRespond={onRespond} onViewWO={onViewWO} now={now} changeOrders={changeOrders} onRequestChange={onRequestChange} showActions />)}
            </section>
          )}

          <section className="dash-sec">
            <h3><Calendar size={15} /> Current &amp; upcoming {upcoming.length > 0 && <span className="sec-count">{upcoming.length}</span>}</h3>
            {upcoming.length === 0
              ? <div className="dash-empty"><ClipboardList size={24} /><p>No upcoming jobs booked.</p></div>
              : upcoming.map((m) => <JobRequestCard key={`${m.job.id}-${m.trade}`} {...m} onRespond={onRespond} onViewWO={onViewWO} now={now} changeOrders={changeOrders} onRequestChange={onRequestChange} />)}
          </section>

          {past.length > 0 && (
            <section className="dash-sec">
              <h3><CheckCircle2 size={15} /> Completed <span className="sec-count">{past.length}</span></h3>
              {past.map((m) => <JobRequestCard key={`${m.job.id}-${m.trade}`} {...m} onRespond={onRespond} onViewWO={onViewWO} now={now} changeOrders={changeOrders} onRequestChange={onRequestChange} past />)}
            </section>
          )}

          {declined.length > 0 && (
            <section className="dash-sec">
              <h3><XCircle size={15} /> Declined <span className="sec-count">{declined.length}</span></h3>
              {declined.map((m) => <JobRequestCard key={`${m.job.id}-${m.trade}`} {...m} onRespond={onRespond} onViewWO={onViewWO} now={now} changeOrders={changeOrders} onRequestChange={onRequestChange} />)}
            </section>
          )}
        </>
      )}

      {pane === "crews" && <MyCrews crews={sub.crews || []} onSave={onSetCrews} />}

      {pane === "uniforms" && (
        <UniformOrder sub={sub} orders={orders} onOrder={onOrderUniform} brand={brand} />
      )}

      {pane === "settings" && (
        <>
          <div className="seg-tabs">
            {[["trades", "Trades"], ["coverage", "Coverage"], ["availability", "Availability"]].map(([id, l]) => (
              <button key={id} className={sub2 === id ? "on" : ""} onClick={() => setSub2(id)}>{l}</button>
            ))}
          </div>

          {sub2 === "trades" && (
            <div className="portal-panel" style={{ marginBottom: 16 }}>
              <h4>Your labor warranty</h4>
              <p className="panel-note">How long you stand behind your workmanship. {brand.name}
                uses this to decide whether a later issue is a warranty claim or chargeable work.</p>
              <div className="pick-grid warranty-grid">
                {WARRANTY_OPTIONS.map((w) => (
                  <button key={w.id} type="button"
                    className={`pick ${String(sub.warranty || "") === w.id ? "on" : ""}`}
                    onClick={() => onSetWarranty(w.id)}>{w.label}</button>
                ))}
              </div>
              <p className="cov-hint">
                {warrantyLabel(sub)}. Separately, defects reported within {CALLBACK_DAYS} days of
                completing a job are treated as callbacks and always come back to you.
              </p>
            </div>
          )}

          {sub2 === "trades" && (
            <div className="portal-panel">
              <h4>Trades you work in</h4>
              <p className="panel-note">You'll only be matched to jobs in these trades.</p>
              <div className="pick-grid">
                {CATEGORIES.map((c) => (
                  <button key={c.id} type="button" className={`pick ${sub.categories.includes(c.id) ? "on" : ""}`}
                    onClick={() => {
                      const next = sub.categories.includes(c.id)
                        ? sub.categories.filter((x) => x !== c.id)
                        : [...sub.categories, c.id];
                      if (next.length) onSetCategories(next);
                    }}>{c.label}</button>
                ))}
              </div>
              <h4 style={{ marginTop: 20 }}>Specific capabilities</h4>
              <div className="pick-grid">
                {caps.map((c) => (
                  <button key={c} type="button" className={`pick ${sub.caps.includes(c) ? "on" : ""}`}
                    onClick={() => onSetCaps(sub.caps.includes(c) ? sub.caps.filter((x) => x !== c) : [...sub.caps, c])}>{c}</button>
                ))}
              </div>
              <div className={`auto-card ${sub.autoSchedule ? "on" : ""}`} style={{ marginTop: 20, marginBottom: 0 }}>
                <Zap size={18} />
                <div className="auto-card-main">
                  <span className="auto-title">Auto-schedule</span>
                  <span className="auto-desc">
                    {sub.autoSchedule
                      ? "On — jobs matching your availability are booked directly, no approval needed. You get priority in matching."
                      : "Off — you review and accept or decline every job request."}
                  </span>
                </div>
                <label className="auto-toggle">
                  <input type="checkbox" checked={!!sub.autoSchedule} onChange={(e) => onSetAutoSchedule(e.target.checked)} />
                  <span>{sub.autoSchedule ? "On" : "Off"}</span>
                </label>
              </div>
            </div>
          )}

          {sub2 === "coverage" && <MyCoverage sub={sub} onSave={onSetCoverage} />}

          {sub2 === "availability" && <MyAvailability sub={sub} jobs={jobs}
            onToggleCrewDay={onToggleCrewDay} onToggleCrewAvailable={onToggleCrewAvailable} />}
        </>
      )}


      {pane === "docs" && (
        <div className="portal-panel">
          <h4>My documents</h4>
          {miss.length > 0 ? (
            <div className="doc-alert">
              <AlertTriangle size={16} />
              <div>
                <strong>{miss.length} document{miss.length > 1 ? "s" : ""} outstanding.</strong>
                <span> {brand.name} reviews each one — you'll be cleared for work once all {DOC_KINDS.length} are verified.</span>
              </div>
            </div>
          ) : (
            <div className="doc-ok-banner"><CheckCircle2 size={16} /> All documents on file — you're cleared for work.</div>
          )}
          {sub.license && (
            <div className={`lic-card ${licenseOk(sub) ? "ok" : "bad"}`} style={{ marginBottom: 16 }}>
              {licenseOk(sub) ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <div className="lic-main">
                <span className="lic-num">WA registration {sub.license}
                  <span className={`lic-status s-${(sub.licenseCheck?.status || "unknown").toLowerCase()}`}>
                    {sub.licenseCheck?.status || "Not checked"}
                  </span>
                </span>
                <span className="lic-meta">
                  {licenseOk(sub)
                    ? `Active with L&I · expires ${sub.licenseCheck.expirationDate}`
                    : "Renew with L&I to keep receiving work — this is checked against the state registry."}
                </span>
              </div>
            </div>
          )}

          <details className="req-box">
            <summary><Shield size={14} /> What {brand.name} requires</summary>
            <div className="req-body">
              <div className="req-sec">Certificate of insurance</div>
              <table className="req-table">
                <tbody>
                  {INSURANCE_LINES.map((l) => (
                    <tr key={l.id}>
                      <td>{l.label}{l.sub ? <span className="rt-sub"> ({l.sub})</span> : null}</td>
                      <td className="rt-amt">{formatMoney(l.min)}{l.optional ? "*" : ""}</td>
                    </tr>
                  ))}
                  <tr><td>Workers' compensation</td><td className="rt-amt">WA L&amp;I active</td></tr>
                </tbody>
              </table>
              <ul className="req-list">
                {INSURANCE_ATTEST.map((a) => <li key={a.id}><Check size={12} /> {a.label(brand.name)}</li>)}
              </ul>
              <div className="req-sec">Surety bond</div>
              <p className="req-note">{formatMoney(BOND_MIN)} minimum, active, surety licensed in Washington.</p>
              <div className="req-sec">Subcontractor agreement</div>
              <p className="req-note">Signed and dated by you, current version.</p>
              <div className="req-sec">IRS Form W-9</div>
              <p className="req-note">Needed before we can pay you. Your TIN or EIN, tax
                classification, and a signature in Part II. Current revision of the form.</p>
              <p className="req-note">* Umbrella / excess applies to higher-risk or larger crews.</p>
            </div>
          </details>

          <div className="doc-manage">
            {[["w9", "IRS Form W-9", Receipt],
              ["insurance", "Certificate of insurance", FileText],
              ["bond", "Surety bond", Shield],
              ["contract", "Signed subcontractor agreement", ScrollText]].map(([k, l, Icon]) => (
              <div key={k} className={`doc-manage-row st-doc-${docStatus(sub, k)}`}>
                <Icon size={16} />
                <div className="dm-info">
                  <span className="dm-label">{l}</span>
                  {sub[k] && <span className="dm-file">{sub.docFiles?.[k] || "document.pdf"}</span>}
                  <span className={`doc-state s-${docStatus(sub, k)}`}>
                    {docStatus(sub, k) === "verified" && <><CheckCircle2 size={11} /> Verified</>}
                    {docStatus(sub, k) === "pending" && <><Clock size={11} /> {brand.name} is reviewing this</>}
                    {docStatus(sub, k) === "rejected" && <><XCircle size={11} /> Needs a new copy — {docReview(sub, k)?.note}</>}
                    {docStatus(sub, k) === "missing" && <><AlertTriangle size={11} /> Not uploaded</>}
                  </span>
                </div>
                {sub[k] ? (
                  <div className="dm-actions">
                    <label className="dm-replace"><Upload size={12} /> Replace
                      <input type="file" hidden onChange={(e) => { if (e.target.files.length) onUploadDoc(k, e.target.files[0]); }} /></label>
                    <button type="button" className="dm-delete" onClick={() => onDeleteDoc(k)}><Trash2 size={12} /> Delete</button>
                  </div>
                ) : (
                  <label className="dm-upload"><Upload size={13} /> Upload
                    <input type="file" hidden onChange={(e) => { if (e.target.files.length) onUploadDoc(k, e.target.files[0]); }} /></label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </main>
  );
}

// ---- Contractor dashboard job card -------------------------------------
function JobRequestCard({ job, trade, a, onRespond, showActions, past, onViewWO, now, changeOrders, onRequestChange }) {
  const M = catMeta(trade);
  const left = msLeft(a, now);
  const expired = isExpired(a, now);
  const urgency = urgencyOf(left);
  return (
    <div className={`job-card jr-card ${past ? "past" : ""}`}>
      <div className="job-card-head">
        <div>
          <h3>{job.title}</h3>
          <div className="job-meta">
            <span><Calendar size={12} /> {formatWhen(job.date, job.time) || job.date || "No date"}</span>
            <span><MapPin size={12} /> {[job.address, job.area, job.zip].filter(Boolean).join(", ") || "No address"}</span>
            {job.sqft && <span><Ruler size={12} /> {Number(job.sqft).toLocaleString()} sq ft</span>}
            {a.value && <span className="job-val">
              {formatMoney(revisedValue(a, changeOrders, job.id, trade))} your pay
              {cosFor(changeOrders, job.id, trade).some((c) => c.status === "accepted") &&
                <em className="job-val-note"> · incl. change orders</em>}
            </span>}
          </div>
        </div>
        <span className={`cat-badge cat-${trade}`}><M.icon size={12} /> {M.label}</span>
      </div>
      {(a.tradeScope || job.scope) && <p className="job-scope">{a.tradeScope || job.scope}</p>}
      {a.crewName && <p className="portal-crew"><Users size={12} /> Your crew: {a.crewName}</p>}
      {job.materialSource && <p className="portal-crew"><Layers size={12} /> Materials: {job.materialSource} ({job.materialsPaidBy})</p>}
      <button className="wo-open-btn" onClick={() => onViewWO({ job, trade, a })}>
        <ScrollText size={13} /> View work order {a.wo}
        {(job.measurementDocs || []).length > 0 && <span className="wo-open-meas">+{job.measurementDocs.length} measurement doc{job.measurementDocs.length > 1 ? "s" : ""}</span>}
      </button>
      {!past && (a.status === "accepted" || a.auto) && onRequestChange && (
        <button className="wo-open-btn wo-change-btn" onClick={() => onRequestChange(job, trade, a)}>
          <FilePlus2 size={13} /> Request a change to this work order
        </button>
      )}
      {a.rating ? (
        <p className="portal-crew"><Star size={12} fill="currentColor" /> Rated {a.rating}.0 by the GC</p>
      ) : null}
      {showActions && awaitingReply(a) && (
        <div className={`ddl ddl-${urgency}`}>
          {expired ? <><XCircle size={14} /> <b>Expired</b> — this offer has been withdrawn.
            Contact the office if you still want the work.</>
            : <><Clock size={14} /> <b>{countdown(left)}</b> left to respond
              <span className="ddl-when">by {new Date(a.respondBy).toLocaleString(undefined,
                { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></>}
        </div>
      )}
      {showActions && !expired ? (
        <div className="portal-respond">
          <span className="respond-label">Do you accept this job?</span>
          <div className="respond-btns">
            <button className="resp accept" onClick={() => onRespond(job.id, trade, "accepted")}><Check size={13} /> Accept</button>
            <button className="resp decline" onClick={() => onRespond(job.id, trade, "declined")}><X size={13} /> Decline</button>
          </div>
        </div>
      ) : showActions && expired ? null : (
        <div className={`job-final ${a.status} portal-final`}>
          {a.auto ? <><Zap size={15} /> Auto-scheduled — booked to your calendar</>
            : a.status === "accepted" ? <><CheckCircle2 size={15} /> You accepted this job</>
            : <><XCircle size={15} /> You declined this job</>}
        </div>
      )}
    </div>
  );
}

// ---- Contractor: manage own crews ---------------------------------------
function MyCrews({ crews, onSave }) {
  const [list, setList] = useState(() => JSON.parse(JSON.stringify(crews.length ? crews : [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "", role: "" }] }])));
  const [saved, setSaved] = useState(false);
  const touch = (next) => { setList(next); setSaved(false); };
  const addCrew = () => touch([...list, { id: "c" + Date.now(), name: `Crew ${list.length + 1}`, members: [{ name: "", role: "" }] }]);
  const removeCrew = (ci) => touch(list.filter((_, i) => i !== ci));
  const setName = (ci, name) => touch(list.map((c, i) => i === ci ? { ...c, name } : c));
  const addMember = (ci) => touch(list.map((c, i) => i === ci ? { ...c, members: [...c.members, { name: "", role: "" }] } : c));
  const removeMember = (ci, mi) => touch(list.map((c, i) => i === ci ? { ...c, members: c.members.filter((_, j) => j !== mi) } : c));
  const setMember = (ci, mi, k, v) => touch(list.map((c, i) => i === ci ? { ...c, members: c.members.map((m, j) => j === mi ? { ...m, [k]: v } : m) } : c));

  const clean = list.map((c) => ({ ...c, members: c.members.filter((m) => m.name.trim()) })).filter((c) => c.members.length);
  const total = clean.reduce((n, c) => n + c.members.length, 0);

  return (
    <div className="portal-panel">
      <h4>My crews</h4>
      <p className="panel-note">Name each crew and list who's on it. Admins pick which crew runs a job.</p>
      <div className="crew-edit">
        {list.map((cr, ci) => (
          <div key={cr.id} className="crew-edit-card">
            <div className="crew-edit-head">
              <input className="crew-name-input" value={cr.name} onChange={(e) => setName(ci, e.target.value)} placeholder={`Crew ${ci + 1}`} />
              {list.length > 1 && <button type="button" className="icon-x" onClick={() => removeCrew(ci)}><X size={13} /></button>}
            </div>
            {cr.members.map((m, mi) => (
              <div key={mi} className="member-row">
                <input value={m.name} onChange={(e) => setMember(ci, mi, "name", e.target.value)} placeholder="Member name" />
                <input value={m.role} onChange={(e) => setMember(ci, mi, "role", e.target.value)} placeholder="Role" />
                {cr.members.length > 1 && <button type="button" className="icon-x" onClick={() => removeMember(ci, mi)}><X size={12} /></button>}
              </div>
            ))}
            <button type="button" className="add-line" onClick={() => addMember(ci)}><Plus size={12} /> Member</button>
          </div>
        ))}
        <button type="button" className="add-crew" onClick={addCrew}><Plus size={13} /> Add crew</button>
      </div>
      <div className="panel-actions">
        <span className="panel-count">{clean.length} {clean.length === 1 ? "crew" : "crews"} · {total} people</span>
        {saved
          ? <span className="saved-note"><CheckCircle2 size={14} /> Saved</span>
          : <button className="btn-solid" disabled={!clean.length} onClick={() => { onSave(clean); setSaved(true); }}>
              <Check size={15} /> Save crews
            </button>}
      </div>
    </div>
  );
}

// ---- Contractor: choose where they work --------------------------------
function MyCoverage({ sub, onSave }) {
  const [mode, setMode] = useState(covMode(sub.coverage));
  const [cities, setCities] = useState(sub.coverage.cities || []);
  const [radii, setRadii] = useState(() => {
    const r = covRadii(sub.coverage);
    return r.length ? r.map((x) => ({ ...x })) : [{ zip: sub.zip || "", miles: 25 }];
  });
  const [newCity, setNewCity] = useState("");
  const [saved, setSaved] = useState(false);
  const touch = (fn) => { fn(); setSaved(false); };

  const toggleCity = (c) => touch(() => setCities((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const addCity = () => {
    const c = newCity.trim();
    if (!c) return;
    touch(() => { setCities((cs) => cs.includes(c) ? cs : [...cs, c]); setNewCity(""); });
  };
  const setRadius = (i, k, v) => touch(() => setRadii((rs) => rs.map((r, j) => j === i ? { ...r, [k]: v } : r)));
  const addRadius = () => touch(() => setRadii((rs) => [...rs, { zip: "", miles: 25 }]));
  const removeRadius = (i) => touch(() => setRadii((rs) => rs.filter((_, j) => j !== i)));

  const cleanRadii = radii.filter((r) => r.zip && r.miles).map((r) => ({ zip: r.zip, miles: Number(r.miles) }));
  const valid = mode === "cities" ? cities.length > 0 : cleanRadii.length > 0;
  const custom = cities.filter((c) => !AREAS.includes(c));

  return (
    <div className="portal-panel">
      <h4>Where you'll work</h4>
      <p className="panel-note">Choose named cities or set travel radii from ZIP codes — one or the other. You'll only be matched to jobs inside your coverage.</p>

      <div className="cov-toggle">
        <button type="button" className={mode === "cities" ? "on" : ""} onClick={() => touch(() => setMode("cities"))}>Specific cities</button>
        <button type="button" className={mode === "radius" ? "on" : ""} onClick={() => touch(() => setMode("radius"))}>ZIP radius</button>
      </div>

      {mode === "cities" ? (
        <>
          <div className="cov-sub" style={{ marginTop: 16 }}>Cities you cover</div>
          <div className="pick-grid">
            {AREAS.map((a) => (
              <button key={a} type="button" className={`pick ${cities.includes(a) ? "on" : ""}`} onClick={() => toggleCity(a)}>{a}</button>
            ))}
          </div>
          {custom.length > 0 && (
            <>
              <div className="cov-sub" style={{ marginTop: 14 }}>Cities you added</div>
              <div className="pick-grid">
                {custom.map((c) => (
                  <button key={c} type="button" className="pick on" onClick={() => toggleCity(c)}>
                    {c} <X size={11} />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="add-city-row">
            <input value={newCity} placeholder="Add another city…"
              onChange={(e) => setNewCity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCity()} />
            <button type="button" className="btn-solid" disabled={!newCity.trim()} onClick={addCity}>
              <Plus size={14} /> Add
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="cov-sub" style={{ marginTop: 16 }}>Radius areas</div>
          <div className="radii-edit">
            {radii.map((r, i) => (
              <div key={i} className="radius-row">
                <input inputMode="numeric" value={r.zip} placeholder="ZIP (e.g. 98101)"
                  onChange={(e) => setRadius(i, "zip", e.target.value.trim())} />
                <span>within</span>
                <input type="number" min="1" value={r.miles}
                  onChange={(e) => setRadius(i, "miles", e.target.value)} />
                <span>mi</span>
                {radii.length > 1 && (
                  <button type="button" className="icon-x" onClick={() => removeRadius(i)}><X size={12} /></button>
                )}
              </div>
            ))}
            <button type="button" className="add-line" onClick={addRadius}><Plus size={12} /> Add another radius</button>
          </div>
        </>
      )}

      <div className="cov-preview">
        <Target size={14} />
        <span>
          {valid
            ? (mode === "cities"
                ? <strong>{cities.join(", ")}</strong>
                : <strong>{cleanRadii.map((r) => `${r.miles} mi of ${r.zip}`).join(" · ")}</strong>)
            : <em>No coverage set — you won't be matched to any jobs.</em>}
        </span>
      </div>

      <div className="panel-actions">
        <span className="panel-count">
          {mode === "cities"
            ? `${cities.length} ${cities.length === 1 ? "city" : "cities"}`
            : `${cleanRadii.length} radius ${cleanRadii.length === 1 ? "area" : "areas"}`}
        </span>
        {saved
          ? <span className="saved-note"><CheckCircle2 size={14} /> Saved</span>
          : <button className="btn-solid" disabled={!valid}
              onClick={() => {
                onSave(mode === "cities"
                  ? { mode: "cities", cities, radii: [] }
                  : { mode: "radius", cities: [], radii: cleanRadii });
                setSaved(true);
              }}>
              <Check size={15} /> Save coverage
            </button>}
      </div>
    </div>
  );
}
// ---- Contractor: crew-based availability --------------------------------
function MyAvailability({ sub, jobs, onToggleCrewDay, onToggleCrewAvailable }) {
  const crews = sub.crews || [];
  const [crewId, setCrewId] = useState(crews[0]?.id || "");
  const [offset, setOffset] = useState(0);
  const today = new Date();
  const start = new Date(today); start.setDate(today.getDate() + offset * 28);
  const days = [...Array(28)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const fmt = (d) => d.toISOString().slice(0, 10);

  const isAll = crewId === "__all";
  const crew = crews.find((c) => c.id === crewId);

  // which days each crew is booked on
  const bookedFor = (name) => new Set(
    jobs.filter((j) => Object.values(j.assignments || {})
      .some((a) => a.subId === sub.id && a.crewName === name)).map((j) => j.date)
  );
  const crewBooked = crew ? bookedFor(crew.name) : new Set();

  if (crews.length === 0) {
    return (
      <div className="portal-panel">
        <h4>My availability</h4>
        <div className="dash-empty"><Users size={24} />
          <p>Add a crew under My Crews first — availability is set per crew.</p></div>
      </div>
    );
  }

  return (
    <div className="portal-panel">
      <h4>My availability</h4>
      <p className="panel-note">Availability is set per crew. Pick a crew, then tap days it can't work.</p>

      <div className="crew-picker">
        {crews.map((c) => {
          const off = crewOffDays(c).length;
          return (
            <button key={c.id} className={`cp-btn ${crewId === c.id ? "on" : ""} ${c.available === false ? "paused" : ""}`}
              onClick={() => setCrewId(c.id)}>
              <span className="cp-name">{c.name}</span>
              <span className="cp-meta">
                {c.available === false ? "Paused" : off > 0 ? `${off} day${off === 1 ? "" : "s"} off` : "Fully open"}
                {" · "}{c.members.length} ppl
              </span>
            </button>
          );
        })}
        <button className={`cp-btn all ${isAll ? "on" : ""}`} onClick={() => setCrewId("__all")}>
          <span className="cp-name">All crews</span>
          <span className="cp-meta">Overview</span>
        </button>
      </div>

      {isAll ? (
        <>
          <div className="cal-legend">
            <span><span className="lg up" /> At least one crew free</span>
            <span><span className="lg down" /> No crews free</span>
          </div>
          <div className="all-crew-grid">
            <div className="acg-head">Crew</div>
            {days.slice(0, 14).map((d) => (
              <div key={fmt(d)} className="acg-day">
                <span className="dow">{d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                <span className="dom">{d.getDate()}</span>
              </div>
            ))}
            {crews.map((c) => {
              const bk = bookedFor(c.name);
              return (
                <React.Fragment key={c.id}>
                  <div className="acg-name">{c.name}</div>
                  {days.slice(0, 14).map((d) => {
                    const k = fmt(d);
                    const booked = bk.has(k);
                    const free = crewFreeOn(c, k);
                    return <div key={k} className={`acg-cell ${booked ? "booked" : free ? "up" : "down"}`}
                      title={`${c.name} · ${booked ? "booked" : free ? "free" : "off"} ${formatDay(k)}`} />;
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="crew-switch-row">
            <label className={`avail-switch ${crew.available !== false ? "on" : ""}`}>
              <input type="checkbox" checked={crew.available !== false}
                onChange={(e) => onToggleCrewAvailable(crew.id, e.target.checked)} />
              <span className={`avail-dot ${crew.available !== false ? "up" : "down"}`} />
              {crew.available !== false ? `${crew.name} is taking work` : `${crew.name} is paused`}
            </label>
          </div>

          {crew.available === false && (
            <div className="doc-block">
              <AlertTriangle size={15} />
              <div><strong>{crew.name} is paused.</strong> It won't be offered for any job until you switch it back on.</div>
            </div>
          )}

          <div className="cal-legend">
            <span><span className="lg up" /> Available</span>
            <span><span className="lg down" /> Marked off</span>
            <span><span className="lg booked" /> Booked</span>
            <span className="cal-hint">{crewOffDays(crew).length} day{crewOffDays(crew).length === 1 ? "" : "s"} off</span>
          </div>

          <div className="mini-cal-nav">
            <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}>← Earlier</button>
            <span>{days[0].toLocaleDateString(undefined, { month: "long", day: "numeric" })} – {days[27].toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span>
            <button onClick={() => setOffset((o) => o + 1)}>Later →</button>
          </div>
          <div className="mini-cal">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="mc-dow">{d}</div>)}
            {[...Array(days[0].getDay())].map((_, i) => <div key={"pad" + i} />)}
            {days.map((d) => {
              const key = fmt(d);
              const booked = crewBooked.has(key);
              const off = crewOffDays(crew).includes(key);
              const paused = crew.available === false;
              return (
                <button key={key}
                  className={`mc-day ${booked ? "booked" : paused ? "down" : off ? "off" : "free"}`}
                  disabled={booked || paused}
                  title={booked ? `${crew.name} has a job this day`
                    : paused ? `${crew.name} is paused`
                    : off ? "Marked off — tap to free up" : "Available — tap to mark off"}
                  onClick={() => !booked && !paused && onToggleCrewDay(crew.id, key)}>
                  <span className="mc-num">{d.getDate()}</span>
                  {booked && <Hammer size={10} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Create / edit user -------------------------------------------------
function UserForm({ subs, onSubmit, onCancel, existing, isSelf, canChangeRole = true, properties = [], accountKind = DEFAULT_ACCOUNT_KIND }) {
  const [f, setF] = useState(existing
    ? { id: existing.id, name: existing.name, email: existing.email, role: existing.role,
        subId: existing.subId || "", propertyIds: existing.propertyIds || [] }
    : { name: "", email: "", role: "pm", subId: "", propertyIds: [] });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // Building owner is only offered by an account that has owners on the other
  // side of the table, and never without buildings to attach them to. A role
  // somebody already holds stays listed either way, so editing a user cannot
  // silently change what they are.
  const offered = ACCOUNT_KINDS[accountKind]?.invites || [];
  const roles = Object.entries(ROLES).filter(([k]) =>
    !ALWAYS_SCOPED_ROLES.includes(k)
    || k === existing?.role
    || (offered.includes(k) && properties.length > 0));

  // Two different meanings for the same empty list, so they are named apart.
  // A manager with none ticked runs the whole account, which is the common
  // case and the one that must stay effortless. An owner with none ticked
  // would sign in to an empty account, so for them it is required.
  const canNarrow = f.role === "pm" && properties.length > 0;
  const mustScope = ALWAYS_SCOPED_ROLES.includes(f.role);
  const showBuildings = (canNarrow || mustScope) && f.role !== "tenant";
  const valid = f.name && f.email
    && (f.role !== "contractor" || f.subId)
    && (!mustScope || f.propertyIds.length > 0);
  const roleLocked = existing && !canChangeRole;
  return (
    <div className="form">
      <h2>{isSelf ? "My account" : existing ? "Edit user" : "New user"}</h2>
      <p className="form-sub">
        {isSelf ? "Update your own name and email."
          : existing ? "Change this user's details, role, or access."
          : "Admins manage users; property managers do everything else."}
      </p>
      <label className="fld">Full name<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Jane Doe" /></label>
      <label className="fld">Email<input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@company.com" /></label>
      <div className="fld">Role
        {roleLocked ? (
          <div className="role-locked">
            <span className={`role-badge r-${f.role}`}>{ROLES[f.role].label}</span>
            <span className="rl-note">{isSelf ? "You can't change your own role." : "Only an admin can change roles."}</span>
          </div>
        ) : (
          <div className="role-pick">
            {roles.map(([k, r]) => (
              <button key={k} type="button" className={f.role === k ? "on" : ""} onClick={() => set("role", k)}>
                <span className="rp-label">{r.label}</span>
                <span className="rp-desc">
                  {k === "admin" && "Full access, can manage users"}
                  {k === "pm" && (properties.length > 0
                    ? "Runs jobs and contractors — every building, or only the ones you pick"
                    : "Create jobs & work orders, assign contractors")}
                  {k === "owner" && "Only the buildings you choose — can request work, sees no costs"}
                  {k === "contractor" && "Own availability, trades, docs, job responses"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {showBuildings && !roleLocked && (
        <div className="fld">{f.role === "owner" ? "Buildings they can see" : "Buildings"}
          <div className="pick-grid">
            {properties.map((p) => (
              <button key={p.id} type="button"
                className={`pick ${f.propertyIds.includes(p.id) ? "on" : ""}`}
                // From the live list, not the one this render captured: two
                // taps in the same batch would otherwise both start from the
                // same array and the second would drop the first.
                onClick={() => setF((s) => ({ ...s, propertyIds: s.propertyIds.includes(p.id)
                  ? s.propertyIds.filter((x) => x !== p.id)
                  : [...s.propertyIds, p.id] }))}>{p.name}</button>
            ))}
          </div>
          <p className="fld-note">
            {!f.propertyIds.length
              ? (mustScope
                  ? "Pick at least one. A seat with none would sign in to an empty account."
                  : "Leave them all unticked and they run every building on the account — which is what most managers should do. Tick some to assign them to just those.")
              : f.role === "owner"
              ? `They will see ${f.propertyIds.length} of your ${properties.length} propert${properties.length === 1 ? "y" : "ies"}, the jobs at ${f.propertyIds.length === 1 ? "it" : "them"}, and who is coming. Not the others, not your other contractors, and no costs.`
              : `Assigned to ${f.propertyIds.length} of your ${properties.length} propert${properties.length === 1 ? "y" : "ies"} — they run the jobs at ${f.propertyIds.length === 1 ? "it" : "them"} and see nothing at the others. They cannot add or remove buildings, or change your billing and users.`}
          </p>
        </div>
      )}
      {f.role === "contractor" && !roleLocked && (
        <label className="fld">Link to contractor record
          <select value={f.subId} onChange={(e) => set("subId", Number(e.target.value))}>
            <option value="">Select contractor…</option>
            {subs.map((x) => <option key={x.id} value={x.id}>{x.company}</option>)}
          </select>
        </label>
      )}
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-solid" onClick={() => onSubmit({
          ...f, subId: f.subId || undefined,
          propertyIds: showBuildings ? f.propertyIds : [],
        })} disabled={!valid}>
          {existing ? <><Check size={15} /> Save changes</> : <><Plus size={15} /> Create user</>}
        </button>
      </div>
    </div>
  );
}
// ---- Default tenant mark (roof/home glyph only — the name is set in text) --
// NOTE: this polygon is OUTERHOME'S mark, used only as their own account logo.
// It is not a generic default — a tenant without a logo falls back to initials.
function HomeMark({ height = 26 }) {
  return (
    <svg viewBox="66 242 124 111" height={height} role="img" aria-label="Home mark"
      style={{ display: "block", width: "auto" }}>
      <polygon fill="currentColor" points="184.99,277.48 184.99,347.67 163.33,347.67 163.33,290.18 128.24,271.51 93.14,290.18 93.14,332.74 93.16,332.73 128.32,311.39 128.24,347.67 71.49,347.67 71.49,277.48 128.24,247.61"/>
    </svg>
  );
}

// The actual SubSub logo (orange mark + wordmark), matching subsub.work's own
// nav — used wherever the platform names itself, e.g. "Powered by [mark]" on
// a white-label login screen. The wordmark uses currentColor so it always
// matches whatever text color it's dropped into; the mark keeps its own
// brand orange regardless.
function SubSubLogo({ height = 16 }) {
  return (
    <svg className="ss-logo" height={height} viewBox="36 62 502 114" xmlns="http://www.w3.org/2000/svg"
      role="img" aria-label="SubSub" style={{ width: "auto", display: "block", flex: "none" }}>
      <path fill="#E39B32" d="M124.35,80.05l-78,36.53c-1.99,0.93-4.27-0.52-4.27-2.72V98.92c0-2.66,1.54-5.07,3.94-6.2L98.82,68c2.61-1.22,5.6-1.31,8.28-0.25l17.09,6.78C126.63,75.51,126.73,78.93,124.35,80.05z"/>
      <path fill="#E39B32" d="M43.81,156.95l78-36.53c1.99-0.93,4.27,0.52,4.27,2.72v14.93c0,2.66-1.54,5.07-3.94,6.2L69.34,169c-2.61,1.22-5.6,1.31-8.28,0.25l-17.09-6.78C41.53,161.49,41.43,158.07,43.81,156.95z"/>
      <path fill="#E39B32" d="M124.51,111.55l-57.06,26.43c-2.31,1.09-4.76,0.85-7.27-0.19l-16.4-6.7c-2.37-0.98-2.45-4.42-0.13-5.52l57.16-26.43c2.7-1.15,4.5-1.1,7.52-0.06l16.05,6.94C126.75,107.01,126.83,110.45,124.51,111.55z"/>
      <path fill="currentColor" d="M159.95,151.25l6.62-14.87c6.31,4.18,15.27,7.03,23.52,7.03c8.35,0,11.61-2.34,11.61-5.8c0-11.3-40.53-3.05-40.53-29.53c0-12.73,10.39-23.11,31.57-23.11c9.27,0,18.84,2.14,25.86,6.21l-6.21,14.97c-6.82-3.67-13.54-5.5-19.75-5.5c-8.45,0-11.51,2.85-11.51,6.41c0,10.9,40.42,2.75,40.42,29.02c0,12.42-10.39,23.01-31.57,23.01C178.27,159.09,166.67,155.94,159.95,151.25z"/>
      <path fill="currentColor" d="M281.36,104.58v53.14h-17.75v-5.69c-4.02,4.41-9.71,6.57-15.79,6.57c-13.04,0-22.55-7.45-22.55-24.32v-29.71h18.63v26.67c0,8.24,3.24,11.47,8.82,11.47c5.49,0,10-3.63,10-12.55v-25.59H281.36z"/>
      <path fill="currentColor" d="M345.6,131.05c0,16.96-11.67,27.55-26.08,27.55c-6.96,0-12.16-1.96-15.69-6.18v5.29h-17.75V84.97h18.63v24.22c3.63-3.73,8.63-5.49,14.81-5.49C333.93,103.69,345.6,114.19,345.6,131.05z M326.78,131.05c0-8.04-4.9-12.55-11.18-12.55s-11.18,4.51-11.18,12.55c0,8.14,4.9,12.75,11.18,12.75S326.78,139.19,326.78,131.05z"/>
      <path fill="currentColor" d="M345.41,151.25l6.62-14.87c6.31,4.18,15.27,7.03,23.52,7.03c8.35,0,11.61-2.34,11.61-5.8c0-11.3-40.53-3.05-40.53-29.53c0-12.73,10.39-23.11,31.57-23.11c9.27,0,18.84,2.14,25.86,6.21l-6.21,14.97c-6.82-3.67-13.54-5.5-19.75-5.5c-8.45,0-11.51,2.85-11.51,6.41c0,10.9,40.42,2.75,40.42,29.02c0,12.42-10.39,23.01-31.57,23.01C363.74,159.09,352.13,155.94,345.41,151.25z"/>
      <path fill="currentColor" d="M466.81,104.58v53.14h-17.75v-5.69c-4.02,4.41-9.71,6.57-15.79,6.57c-13.04,0-22.55-7.45-22.55-24.32v-29.71h18.63v26.67c0,8.24,3.24,11.47,8.83,11.47c5.49,0,10-3.63,10-12.55v-25.59H466.81z"/>
      <path fill="currentColor" d="M531.05,131.05c0,16.96-11.67,27.55-26.08,27.55c-6.96,0-12.16-1.96-15.69-6.18v5.29h-17.75V84.97h18.63v24.22c3.63-3.73,8.63-5.49,14.81-5.49C519.38,103.69,531.05,114.19,531.05,131.05z M512.22,131.05c0-8.04-4.9-12.55-11.18-12.55s-11.18,4.51-11.18,12.55c0,8.14,4.9,12.75,11.18,12.75S512.22,139.19,512.22,131.05z"/>
    </svg>
  );
}

// The mark at the foot of every white-labelled page, and the only thing on
// it that is ours. It links home, because a subcontractor who notices it is
// exactly the person worth telling who built this.
//
// A new tab, not this one: it appears on the sign-in screen and on the
// application form, and a curious click halfway through filling one in
// should not throw the form away. `noopener` and nothing more -- the
// referrer is worth keeping, since it says which customer's page sent them.
function PoweredBy({ height = 15, className = "" }) {
  return (
    <a className={`powered-by ${className}`} href="https://subsub.work/"
      target="_blank" rel="noopener" aria-label="Powered by SubSub — visit subsub.work">
      <span>Powered by</span><SubSubLogo height={height} />
    </a>
  );
}

// ---- Tenant brand mark (custom upload, else default, else initials) -----
// Just the mark, no wordmark. The login card already prints the name
// underneath, so the full lockup would say "SubSub" twice.
function SubSubMark({ height = 24 }) {
  return (
    <svg height={height} viewBox="36 62 96 114" xmlns="http://www.w3.org/2000/svg"
      role="img" aria-label="SubSub" style={{ width: "auto", display: "block", flex: "none" }}>
      <path fill="#E39B32" d="M124.35,80.05l-78,36.53c-1.99,0.93-4.27-0.52-4.27-2.72V98.92c0-2.66,1.54-5.07,3.94-6.2L98.82,68c2.61-1.22,5.6-1.31,8.28-0.25l17.09,6.78C126.63,75.51,126.73,78.93,124.35,80.05z"/>
      <path fill="#E39B32" d="M43.81,156.95l78-36.53c1.99-0.93,4.27,0.52,4.27,2.72v14.93c0,2.66-1.54,5.07-3.94,6.2L69.34,169c-2.61,1.22-5.6,1.31-8.28,0.25l-17.09-6.78C41.53,161.49,41.43,158.07,43.81,156.95z"/>
      <path fill="#E39B32" d="M124.51,111.55l-57.06,26.43c-2.31,1.09-4.76,0.85-7.27-0.19l-16.4-6.7c-2.37-0.98-2.45-4.42-0.13-5.52l57.16-26.43c2.7-1.15,4.5-1.1,7.52-0.06l16.05,6.94C126.75,107.01,126.83,110.45,124.51,111.55z"/>
    </svg>
  );
}

function BrandMark({ brand, height = 24 }) {
  // SubSub's own front door wears SubSub's own mark, not two initials.
  if (brand.isSubSub) return <SubSubMark height={height} />;
  if (brand.logoData) {
    return <img src={brand.logoData} alt={brand.name} style={{ height, width: "auto", display: "block" }} />;
  }
  // No borrowed marks: a tenant with no logo of their own gets their initials.
  return (
    <div className="brand-initials" style={{ height, minWidth: height }}>
      {brand.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
    </div>
  );
}

// ---- Which account? ------------------------------------------------------
// A subcontractor can work for several general contractors on one login, and
// an admin can run more than one company. Signing in used to pick the first
// membership and leave them to notice and undo it; the ones most likely to
// have several are the ones least likely to be at a desk when they find out.
//
// Only shown when the address does not already say: on a customer's own
// subdomain the question is already answered.
function AccountChooser({ result, brand, onPick, onBack }) {
  const wl = themeOf(brand);
  const sorted = [...result.memberships].sort((a, b) =>
    (a.accountName || "").localeCompare(b.accountName || ""));

  return (
    <div className="wl-page" style={themeVars(wl)}>
      <div className="wl-card ac-card">
        <div className="wl-brand"><BrandMark brand={brand} height={30} />
          <span className="wl-brand-name">{brand.name}</span></div>
        <h1>Which account?</h1>
        <p className="wl-lede">
          You're signed in as {result.user.email}. This login reaches {sorted.length} accounts.
        </p>

        <div className="ac-list">
          {sorted.map((m) => (
            <button key={m.accountId} className="ac-row" onClick={() => onPick(m)}>
              {/* Only a mark somebody actually uploaded. SubSub's own mark
                  beside another company's name would claim they are SubSub,
                  and two letters in a square is a stand-in for a brand rather
                  than one -- so an account without a logo is its name, set as
                  text, which is what it is. */}
              <span className="ac-mark">
                {m.logoKey && PLANS[m.plan]?.branding
                  ? <img src={logoUrl(m.accountId)} alt="" height={30}
                      style={{ height: 30, width: "auto", display: "block" }} />
                  // No logo of their own: their initials, set as text rather
                  // than dressed up as a mark. It keeps every row starting at
                  // the same place without inventing a brand for them.
                  : <span className="ac-ini">
                      {(m.accountName || "").split(" ").filter(Boolean)
                        .map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </span>}
              </span>
              <span className="ac-txt">
                <b>{m.accountName}</b>
                <span>{ROLES[m.role] ? ROLES[m.role].label : m.role}</span>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>

        <button className="wl-btn-ghost" onClick={onBack}>Sign in as someone else</button>
      </div>
      {!brand.isSubSub && <p className="login-foot"><PoweredBy height={13} /></p>}
    </div>
  );
}

// ---- Payment, inside our own page ----------------------------------------
// Stripe's form, mounted in a panel here rather than on stripe.com. The
// customer keeps our header, our background and our URL, and card details
// still never touch this code -- the form is Stripe's, in an iframe they
// control, and we only hand it a session id.
//
// Publishable keys are designed to be public: this one can start a payment
// and do nothing else. Its absence is what decides whether we embed or
// redirect, so a build without it still sells.
const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";

// Loaded on demand rather than in the page head: almost nobody upgrades, and
// nobody should pay for Stripe's script on the dashboard. Cached so opening
// the panel twice does not fetch it twice.
let stripeJsPromise = null;
function loadStripeJs() {
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const el = document.createElement("script");
    el.src = "https://js.stripe.com/v3/";
    el.async = true;
    el.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("stripe_js_missing")));
    el.onerror = () => reject(new Error("stripe_js_blocked"));
    document.head.appendChild(el);
  });
  return stripeJsPromise;
}

function CheckoutPanel({ clientSecret, onClose }) {
  const host = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    let checkout = null;
    (async () => {
      try {
        const Stripe = await loadStripeJs();
        if (!live) return;
        checkout = await Stripe(STRIPE_PK).initEmbeddedCheckout({ clientSecret });
        // The await above can outlive the panel, and mounting into a node
        // React has already removed throws.
        if (!live || !host.current) { checkout.destroy(); return; }
        checkout.mount(host.current);
      } catch (e) {
        console.error("[checkout] could not mount:", e);
        if (live) {
          setErr(e?.message === "stripe_js_blocked"
            ? "Couldn't load the payment form — something on this network is blocking Stripe."
            : "Couldn't load the payment form. Try again in a moment.");
        }
      }
    })();
    return () => { live = false; if (checkout) checkout.destroy(); };
  }, [clientSecret]);

  return (
    <div className="co-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="co-panel" role="dialog" aria-label="Payment">
        <div className="co-head">
          <div>
            <SubSubLogo height={26} />
            {/* The processor's name is theirs to show, and it already appears
                inside their own frame below. What this line is for is the
                reassurance, which survives without borrowing the brand. */}
            <span className="co-sub">Secure payment</span>
          </div>
          <button className="co-x" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        {err
          ? <p className="co-err">{err}</p>
          : <div ref={host} className="co-mount" />}
      </div>
    </div>
  );
}

// ---- Login / splash ------------------------------------------------------
function LoginPage({ users, brand, accounts, memberships, onLogin, onSignup }) {
  const wl = themeOf(brand);
  // Show which account each demo login lands in — the same person can hold
  // memberships in several.
  const acctOf = (u) => {
    const m = (memberships || []).find((x) => x.userId === u.id);
    return m ? (accounts || []).find((a) => a.id === m.accountId) : null;
  };
  const roleOf = (u) => {
    const m = (memberships || []).find((x) => x.userId === u.id);
    return m ? m.role : "contractor";
  };
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // "Create your password" only ever creates the LOGIN — it covers someone
  // who already has an internal users row, either because an admin added
  // them via Users → Add, or because they already applied through the
  // public SubSignup form on this subdomain (which creates that row up
  // front). resolveSupabaseUser() in worker/index.js links the two by
  // email on first sign-in — no separate provisioning call needed here.
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [signupSent, setSignupSent] = useState(false);
  const onSubdomain = detectSubdomain();

  const submit = async () => {
    if (!supabaseEnabled) {
      const u = users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u) { setErr("No account found for that email."); return; }
      if (!pw) { setErr("Enter your password."); return; }
      setErr("");
      const msg = await onLogin(u.email);
      if (msg) setErr(msg);
      return;
    }

    if (!email.trim() || !pw) { setErr("Enter your email and password."); return; }
    setErr(""); setBusy(true);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw });
      setBusy(false);
      if (error) { setErr(error.message); return; }
      if (data.session) {                       // email confirmation disabled — straight in
        const msg = await onLogin();
        if (msg) setErr(msg);
        return;
      }
      setSignupSent(true); // otherwise Supabase mailed a confirmation link
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setBusy(false); setErr(error.message); return; }
    // The Supabase session is only half of it — the account still has to
    // recognise this person. Show it when it doesn't.
    const msg = await onLogin();
    setBusy(false);
    if (msg) setErr(msg);
  };

  const forgotPassword = async () => {
    if (!supabaseEnabled) { setErr("Password reset isn't wired up in this demo."); return; }
    if (!email.trim()) { setErr("Enter your email first, then tap this again."); return; }
    // Back to the address they are standing on: somebody who starts at their
    // own company's address should not be returned to the shared one.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(),
      { redirectTo: window.location.origin });
    if (error) setErr(error.message);
    else setResetSent(true);
  };

  return (
    <div className="login-wrap wl-themed" style={themeVars(wl)}>
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap"><BrandMark brand={brand} height={38} /></div>
          <h1>{brand.name}</h1>
          <p>Contractor portal · {brand.subdomain}.subsub.work</p>
        </div>

        <div className="login-form">
          {supabaseEnabled && signupSent ? (
            <div className="login-err" style={{ color: "var(--forest-lift)" }}>
              <CheckCircle2 size={13} /> Check {email} for a confirmation link, then come back and sign in.
            </div>
          ) : (
            <>
              <label className="fld">Email
                <input type="email" inputMode="email" autoComplete="username"
                  value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); setResetSent(false); }}
                  placeholder="you@company.com"
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
              </label>
              <label className="fld">Password
                <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }}
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
              </label>
              {err && <div className="login-err"><AlertTriangle size={13} /> {err}</div>}
              {resetSent && <div className="login-err" style={{ color: "var(--forest-lift)" }}><CheckCircle2 size={13} /> Check your email for a reset link.</div>}
              <button className="btn-solid login-btn" onClick={submit} disabled={busy}>
                <Lock size={15} /> {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
              </button>
              {mode === "signin" ? (
                <button className="login-forgot" onClick={forgotPassword}>
                  Forgot password?
                </button>
              ) : null}
              {supabaseEnabled && (
                <button className="login-forgot" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setErr(""); }}>
                  {mode === "signup" ? "Already have an account? Sign in" : "Already invited? Create your password"}
                </button>
              )}
            </>
          )}
        </div>

        {onSignup && onSubdomain && (
          <button className="login-signup" onClick={onSignup}>
            <span>New subcontractor?</span>
            <b>Apply to work with {brand.name} &#8250;</b>
          </button>
        )}

      </div>
      {/* "Powered by SubSub" belongs on a customer's portal, not on SubSub's own. */}
      {!brand.isSubSub && (
        <p className="login-foot">
          <PoweredBy height={13} />
        </p>
      )}
    </div>
  );
}

// ---- Work order document (derived view, downloadable) -------------------
function WorkOrderDoc({ job, trade, a, onClose, onUploadSigned, canUpload, brand, cos }) {
  const coList = (cos || []).filter((c) => c.status === "accepted").sort((x, y) => x.seq - y.seq);
  const coPending = (cos || []).filter((c) => c.status === "pending").length;
  const revised = Number(moneyRaw(a.value) || 0) + coList.reduce((n, c) => n + c.valueDelta, 0);
  const M = catMeta(trade);
  const download = () => {
    const lines = [
      `WORK ORDER ${a.wo}`,
      `Issued: ${a.woIssued}`,
      "",
      `Contractor: ${a.company}  (${a.contact})`,
      a.crewName ? `Crew: ${a.crewName}` : "",
      `Trade: ${M.label}`,
      "",
      `Job: ${job.title}`,
      job.client ? `Client: ${job.client}` : "",
      `Address: ${[job.address, job.area, job.zip].filter(Boolean).join(", ")}`,
      job.sqft ? `Square footage: ${Number(job.sqft).toLocaleString()} sq ft` : "",
      job.stories ? `Stories: ${job.stories}` : "",
      `Start: ${formatWhen(job.date, job.time) || job.date || "TBD"}`,
      "",
      `Materials source: ${job.materialSource || "—"}`,
      `Materials paid by: ${job.materialsPaidBy || "—"}`,
      "",
      "SCOPE OF WORK",
      a.tradeScope || job.scope || "—",
      "",
      `Subcontractor value: ${a.value ? formatMoney(a.value) : "—"}`,
      ...(coList.length ? [
        "",
        "CHANGE ORDERS (accepted)",
        ...coList.map((c) => `  ${coSeq(c.seq)}  ${c.valueDelta === 0 ? "No cost   " : (c.valueDelta > 0 ? "+" : "-") + formatMoney(Math.abs(c.valueDelta)).padEnd(10)}  ${c.scope}`),
        `  Revised subcontractor value: ${formatMoney(revised)}`,
      ] : []),
      ...(coPending ? [`  (${coPending} change order${coPending === 1 ? "" : "s"} pending — not included)`] : []),
      "",
      (job.measurementDocs || []).length
        ? `Measurement documents: ${job.measurementDocs.join(", ")}` : "",
      "",
      `Status: ${a.auto ? "Auto-scheduled" : a.status}`,
      "",
      brand ? `${brand.name} — powered by SubSub` : "Powered by SubSub",
    ].filter((l) => l !== "");
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${a.wo}-${M.label.replace(/\W+/g, "-").toLowerCase()}.txt`;
    link.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="wo-doc">
      <div className="wo-doc-head">
        <div>
          <div className="wdh-label">{brand ? `${brand.name} · work order` : "Work order"}</div>
          <h2>{a.wo}</h2>
          <p className="wdh-sub">Issued {a.woIssued} · {M.label}</p>
        </div>
        <span className={`job-status st-${a.auto ? "accepted" : a.status}`}>{a.auto ? "auto-scheduled" : a.status}</span>
      </div>

      <div className="wo-doc-grid">
        <div className="wd-row"><span>Contractor</span><strong>{a.company}</strong></div>
        <div className="wd-row"><span>Contact</span><strong>{a.contact}</strong></div>
        {a.crewName && <div className="wd-row"><span>Crew</span><strong>{a.crewName}</strong></div>}
        <div className="wd-row"><span>Trade</span><strong>{M.label}</strong></div>
      </div>

      <div className="wo-doc-sec">Job</div>
      <div className="wo-doc-grid">
        <div className="wd-row"><span>Job</span><strong>{job.title}</strong></div>
        {job.client && <div className="wd-row"><span>Client</span><strong>{job.client}</strong></div>}
        <div className="wd-row"><span>Address</span><strong>{[job.address, job.area, job.zip].filter(Boolean).join(", ") || "—"}</strong></div>
        {job.sqft && <div className="wd-row"><span>Square footage</span><strong>{Number(job.sqft).toLocaleString()} sq ft</strong></div>}
        {job.stories && <div className="wd-row"><span>Stories</span><strong>{job.stories}</strong></div>}
        <div className="wd-row"><span>Start</span><strong>{formatWhen(job.date, job.time) || "TBD"}</strong></div>
      </div>

      <div className="wo-doc-sec">Materials</div>
      <div className="wo-doc-grid">
        <div className="wd-row"><span>Source</span><strong>{job.materialSource || "—"}</strong></div>
        <div className="wd-row"><span>Paid by</span><strong>{job.materialsPaidBy || "—"}</strong></div>
      </div>

      <div className="wo-doc-sec">Scope of work</div>
      <p className="wo-doc-scope">{a.tradeScope || job.scope || "No scope recorded."}</p>

      <div className="wo-doc-sec">Compensation</div>
      <div className="wo-value">{a.value ? formatMoney(a.value) : "—"}<span> subcontractor value</span></div>
      {coList.length > 0 && (
        <div className="wo-co-sched">
          <div className="wo-co-hd">Change orders</div>
          {coList.map((c) => (
            <div key={c.id} className="wo-co-line">
              <span className="wo-co-seq">{coSeq(c.seq)}</span>
              <span className="wo-co-scope">{c.scope}</span>
              <span className={`wo-co-delta ${c.valueDelta > 0 ? "up" : c.valueDelta < 0 ? "down" : ""}`}>
                {c.valueDelta === 0 ? "No cost" : (c.valueDelta > 0 ? "+" : "−") + formatMoney(Math.abs(c.valueDelta))}
              </span>
            </div>
          ))}
          <div className="wo-co-total"><span>Revised subcontractor value</span><b>{formatMoney(revised)}</b></div>
        </div>
      )}

      <div className="wo-doc-sec">Measurement documents</div>
      {(job.measurementDocs || []).length === 0 ? (
        <p className="muted">None attached to this job.</p>
      ) : (
        <div className="meas-list">
          {job.measurementDocs.map((d) => (
            <div key={d} className="meas-row view">
              <FileText size={14} /><span className="meas-name">{d}</span>
              <button className="meas-dl" onClick={download}><Download size={12} /> Open</button>
            </div>
          ))}
        </div>
      )}

      <div className="wo-doc-sec">Signed copy</div>
      {a.signedWO ? (
        <div className="meas-row view"><CheckCircle2 size={14} /><span className="meas-name">{a.signedWO}</span></div>
      ) : canUpload ? (
        <label className="meas-upload">
          <Upload size={14} /> Upload signed work order
          <input type="file" hidden onChange={(e) => { if (e.target.files.length) onUploadSigned(e.target.files[0]); }} />
        </label>
      ) : <p className="muted">Not yet uploaded.</p>}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-solid" onClick={download}><Download size={15} /> Download work order</button>
      </div>
    </div>
  );
}

// ---- Modal shell ---------------------------------------------------------
function Modal({ children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        {children}
      </div>
    </div>
  );
}

// ---- Sub detail ----------------------------------------------------------
function SubDetail({ sub, jobs, onSchedule, onSaveNotes, onEdit, onRequestDocs, onReviewDoc, onVerifyLicense }) {
  const ready = sub.bond && sub.insurance && sub.contract;
  const [notes, setNotes] = useState(sub.notes || "");
  const [dirty, setDirty] = useState(false);
  const docs = [
    { key: "insurance", label: DOC_LABELS.insurance, icon: FileText },
    { key: "bond", label: DOC_LABELS.bond, icon: Shield },
    { key: "contract", label: DOC_LABELS.contract, icon: ScrollText },
    { key: "w9", label: DOC_LABELS.w9, icon: Receipt },
  ];
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="cat-row">
          {sub.categories.map((c) => {
            const M = catMeta(c);
            return <span key={c} className={`cat-badge cat-${c}`}><M.icon size={12} /> {M.label}</span>;
          })}
        </div>
        <button className="edit-btn" onClick={onEdit}><Pencil size={13} /> Edit</button>
      </div>
      <div className="name-row big"><h2>{sub.company}</h2>
        {sub.rating > 0 && <span className="rating-wrap"><Stars value={sub.rating} />
          {sub.ratedJobs ? <span className="rated-count">from {sub.ratedJobs} {sub.ratedJobs === 1 ? "job" : "jobs"}</span> : null}</span>}
      </div>
      <div className="detail-contact">
        <a href={`tel:${sub.phone}`}><Phone size={14} /> {sub.phone}</a>
        <a href={`mailto:${sub.email}`}><Mail size={14} /> {sub.email}</a>
        {(sub.propertyIds || []).length > 0 && (
          <span className="notify-chip" title="Properties this vendor is scoped to">
            <Building2 size={12} /> {sub.propertyIds.length} propert{sub.propertyIds.length === 1 ? "y" : "ies"}
          </span>
        )}
        <span className="notify-chip" title="How long they warranty their labor">
          <ShieldCheck size={12} /> {warrantyLabel(sub)}
        </span>
        <span className="notify-chip" title="How this contractor receives automated notifications">
          <Bell size={12} /> {notifyLabel(sub)}
        </span>
      </div>
      {(sub.city || sub.zip) && (
        <p className="detail-addr"><MapPin size={13} /> {[sub.city, sub.state, sub.zip].filter(Boolean).join(", ")}</p>
      )}
      <p className="detail-person">
        {sub.contact} · <Users size={13} /> {crewCount(sub)} {crewCount(sub) === 1 ? "crew" : "crews"} · {headCount(sub)} people ·
        <span className={`avail-inline ${sub.available ? "up" : "down"}`}>
          {sub.available ? "Available" : "Not available"}</span>
      </p>

      {(() => { const st = contractorStats(sub, jobs); return (
        <div className="stat-cards">
          <div className="stat-card"><span className="sc-num">{st.completed}</span><span className="sc-lab"><CheckCircle2 size={12} /> Jobs done</span></div>
          <div className="stat-card"><span className="sc-num">{st.earned ? formatMoney(st.earned) : "$0"}</span><span className="sc-lab"><Target size={12} /> Earned</span></div>
          <div className="stat-card"><span className="sc-num">{acceptRate(sub)}%</span><span className="sc-lab"><Check size={12} /> Accept rate</span></div>
        </div>
      ); })()}

      <section><h4>Capabilities</h4><div className="caps">{sub.caps.map((c) => <span key={c} className="cap">{c}</span>)}</div></section>

      <section>
        <h4>Coverage</h4>
        {covMode(sub.coverage) === "cities" ? (
          (sub.coverage.cities || []).length > 0
            ? <div className="area-chips">{sub.coverage.cities.map((a) => <span key={a} className="area-chip"><MapPin size={11} /> {a}</span>)}</div>
            : <p className="muted">No cities set.</p>
        ) : (
          covRadii(sub.coverage).length > 0
            ? <div className="radii-list">
                {covRadii(sub.coverage).map((r, i) => (
                  <div key={i} className="cov-radius"><Target size={14} /> Works within <strong>{r.miles} miles</strong> of {r.zip}</div>
                ))}
              </div>
            : <p className="muted">No radius set.</p>
        )}
      </section>

      {(sub.unavailableDays || []).length > 0 && (
        <section>
          <h4><Calendar size={13} /> Days marked off</h4>
          <div className="area-chips">
            {sub.unavailableDays.slice().sort().map((d) => (
              <span key={d} className="off-chip"><XCircle size={11} /> {formatDay(d)}</span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h4><Users size={13} /> Crews &amp; members</h4>
        {(sub.crews || []).length === 0 ? <p className="muted">No crews set.</p> : (
          <div className="crew-list">
            {sub.crews.map((cr) => {
              const cr2 = crewRatings(sub, jobs).find((x) => x.name === cr.name);
              return (
              <div key={cr.id} className="crew-card">
                <div className="crew-head">
                  <span className="crew-name">{cr.name}</span>
                  <span className="crew-head-right">
                    {cr2 ? <span className="crew-rating"><Star size={11} fill="currentColor" /> {cr2.avg.toFixed(1)} <em>({cr2.count})</em></span> : <span className="crew-unrated">unrated</span>}
                    <span className="crew-size">{cr.members.length} {cr.members.length === 1 ? "member" : "members"}</span>
                  </span>
                </div>
                <div className="crew-members">
                  {cr.members.map((m, i) => (
                    <span key={i} className="member"><span className="m-name">{m.name}</span>{m.role ? <span className="m-role">{m.role}</span> : null}</span>
                  ))}
                </div>
              </div>
            );})}
          </div>
        )}
        {crewRatings(sub, jobs).length > 0 && (
          <p className="rollup-note">
            Crew ratings roll up to the contractor's overall score
            {sub.rating ? <> — currently <strong>{sub.rating.toFixed(1)}</strong></> : null}
            {sub.ratedJobs ? ` across ${sub.ratedJobs} rated ${sub.ratedJobs === 1 ? "job" : "jobs"}` : ""}.
          </p>
        )}
      </section>

      <section>
        <h4><StickyNote size={13} /> Notes</h4>
        <textarea className="notes-area" value={notes} rows={3}
          onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Add notes about this sub…" />
        {dirty && <button className="notes-save" onClick={() => { onSaveNotes(sub.id, notes); setDirty(false); }}>Save notes</button>}
      </section>

      <section>
        <h4><Shield size={13} /> WA contractor registration</h4>
        {(() => {
          const c = sub.licenseCheck;
          const ok = licenseOk(sub);
          if (!sub.license) return (
            <div className="lic-card none">
              <AlertTriangle size={16} />
              <div className="lic-main">
                <span className="lic-num">No license number on file</span>
                <span className="lic-meta">Add their L&amp;I registration number to verify it against the state registry.</span>
              </div>
              <button className="doc-add" onClick={onEdit}><Pencil size={13} /> Add</button>
            </div>
          );
          return (
            <div className={`lic-card ${ok ? "ok" : "bad"}`}>
              {ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <div className="lic-main">
                <span className="lic-num">{sub.license}
                  <span className={`lic-status s-${(c?.status || "unknown").toLowerCase()}`}>{c?.status || "Not checked"}</span>
                </span>
                {c?.found ? (
                  <span className="lic-meta">
                    {c.licenseType} · expires {c.expirationDate}
                    {sub.ubi ? ` · UBI ${sub.ubi}` : ""}
                    {c.checkedAt ? ` · checked ${c.checkedAt}` : ""}
                  </span>
                ) : <span className="lic-meta">Not yet verified against L&amp;I.</span>}
                {c?.found && (
                  <span className="lic-state">
                    State record: bond {c.bond ? `${formatMoney(c.bond.amount)} (${c.bond.surety})` : "none"} · insurance {c.insurance ? `${formatMoney(c.insurance.coverage)} (${c.insurance.carrier})` : "none"}
                  </span>
                )}
              </div>
              <div className="lic-actions">
                <button className="doc-review" onClick={() => onVerifyLicense(sub)}>
                  <Shield size={13} /> {c ? "Re-check" : "Verify"}
                </button>
                <a className="lic-link" href={lniPublicLookup(sub.license)} target="_blank" rel="noopener noreferrer">
                  L&amp;I record
                </a>
              </div>
            </div>
          );
        })()}
        {sub.licenseCheck?.found && !licenseOk(sub) && (
          <p className="rollup-note" style={{ color: "var(--red)" }}>
            Registration is {sub.licenseCheck.status.toLowerCase()} — this contractor can't be assigned until it's renewed.
          </p>
        )}
      </section>

      <section>
        <h4>Compliance documents</h4>
        <div className="doc-rows">
          {docs.map((d) => {
            const st = docStatus(sub, d.key);
            const rv = docReview(sub, d.key);
            return (
              <div key={d.key} className={`doc-row st-doc-${st}`}>
                <d.icon size={16} />
                <div className="doc-label-wrap">
                  <span className="doc-label">{d.label}</span>
                  {sub.docFiles?.[d.key] && <span className="doc-file">{sub.docFiles[d.key]}</span>}
                  <span className={`doc-state s-${st}`}>
                    {st === "verified" && <><CheckCircle2 size={11} /> Verified {rv?.verifiedAt} by {rv?.verifiedBy}
                      {rv?.limits?.cgl_occ ? ` · CGL ${formatMoney(rv.limits.cgl_occ)}` : rv?.amount ? ` · ${formatMoney(rv.amount)}` : ""}{rv?.expires ? ` · expires ${rv.expires}` : ""}</>}
                    {st === "pending" && <><Clock size={11} /> Awaiting review</>}
                    {st === "rejected" && <><XCircle size={11} /> Rejected — {rv?.note}</>}
                    {st === "missing" && <><AlertTriangle size={11} /> Not uploaded</>}
                  </span>
                </div>
                {activeOverrides(rv).length > 0 && (
                  <span className="doc-waived" title={activeOverrides(rv).map((o) => `${o.label}: ${o.reason}`).join(" · ")}>
                    <Shield size={11} /> {activeOverrides(rv).length} accepted below requirement
                  </span>
                )}
                {st === "missing" ? (
                  <div className="doc-row-actions">
                    <button className="doc-add" onClick={onEdit}><Upload size={13} /> Upload</button>
                    <button className="doc-req" onClick={() => onRequestDocs(sub)}><Mail size={12} /> Request</button>
                  </div>
                ) : (
                  <button className={`doc-review ${st === "pending" ? "urgent" : ""}`}
                    onClick={() => onReviewDoc(sub, d.key)}>
                    {st === "verified" ? <><FileText size={13} /> View</> : <><Shield size={13} /> Review</>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {pendingReviewDocs(sub).length > 0 && (
          <p className="rollup-note">
            {pendingReviewDocs(sub).length} document{pendingReviewDocs(sub).length === 1 ? "" : "s"} uploaded but
            not yet verified — this contractor can't be assigned until they're reviewed.
          </p>
        )}
      </section>

      <div className="detail-actions">
        <button className="mini primary" onClick={onSchedule}><Calendar size={14} /> Assign to a job</button>
      </div>
      {!ready && (
        <div className="doc-block detail-doc-block">
          <AlertTriangle size={15} />
          <div>
            <strong>Not assignable yet.</strong> Outstanding: {complianceGaps(sub).join(", ")}.
          </div>
          <button className="btn-notify" onClick={() => onRequestDocs(sub)}><Mail size={14} /> Request docs</button>
        </div>
      )}
    </div>
  );
}

// ---- Send a compliance notification (one way: email, optionally + SMS) ---
function NotifyForm({ data, brand, onClose }) {
  const { sub, job, trade } = data;
  const prefs = notifyPrefs(sub);
  const hasEmail = !!sub.email;
  const hasPhone = !!sub.phone;
  const [sendEmail, setSendEmail] = useState(hasEmail);
  const [sendSms, setSendSms] = useState(hasPhone && prefs.sms);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The server composes the message, so this preview is the message. Asking it
  // rather than rendering a second copy locally is what stops the reviewed text
  // and the sent text drifting apart.
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState("");
  useEffect(() => {
    let live = true;
    api.previewDocRequest({ companyId: sub.id, jobId: job?.id, trade })
      .then((p) => { if (live) { setPreview(p); setPreviewErr(""); } })
      .catch((e) => { if (live) setPreviewErr(e?.body?.error || e?.message || "preview_failed"); });
    return () => { live = false; };
  }, [sub.id, job?.id, trade]);

  const smsBody = buildDocSms(sub, job, brand);
  const subject = preview?.subject || "";
  const emailBody = preview?.text || "";
  const mailConfigured = preview ? preview.configured : true;
  const canSend = !busy && preview && mailConfigured && sendEmail && hasEmail;

  const send = async () => {
    setErr(""); setBusy(true);
    try {
      await api.sendDocRequest({ companyId: sub.id, jobId: job?.id || null, trade: trade || null });
      setBusy(false); setSent(true);
    } catch (e) {
      setBusy(false);
      setErr(e?.body?.error === "no_email_on_file" ? "This contractor has no email on file."
        : e?.body?.error === "mail_not_configured" ? "Email delivery isn't configured yet."
        : `Could not send: ${e?.body?.detail || e?.body?.error || e?.message || "unknown error"}`);
    }
  };

  if (sent) {
    return (
      <div className="form sent-state">
        <CheckCircle2 size={40} />
        <h2>Email sent</h2>
        <p>
          Sent to {sub.email} — {sub.contact} at {sub.company}.
          {sendSms && hasPhone && " The text message was not sent: SMS isn't wired up yet."}
        </p>
        <button className="btn-solid" onClick={onClose}>Done</button>
      </div>
    );
  }

  return (
    <div className="form">
      <h2>Request documents</h2>
      <p className="form-sub">
        {sub.company} · outstanding: {complianceGaps(sub).join(", ")}
      </p>

      <div className="notify-note">
        <Bell size={13} />
        Email &amp; SMS is for automated notifications only. This points them to their portal to upload — there's no reply address.
      </div>

      <div className="form-sec">Send via</div>
      <div className="notify-opts">
        <label className={`notify-opt ${sendEmail ? "on" : ""} ${!hasEmail ? "disabled" : ""}`}>
          <input type="checkbox" checked={sendEmail} disabled={!hasEmail}
            onChange={(e) => setSendEmail(e.target.checked)} />
          <Mail size={17} />
          <span className="no-txt">
            <span className="no-name">Email <span className="no-tag">default</span></span>
            <span className="no-sub">{sub.email || "No email on file"}</span>
          </span>
        </label>
        <label className={`notify-opt ${sendSms ? "on" : ""} ${!hasPhone ? "disabled" : ""}`}>
          <input type="checkbox" checked={sendSms} disabled={!hasPhone}
            onChange={(e) => setSendSms(e.target.checked)} />
          <Phone size={17} />
          <span className="no-txt">
            <span className="no-name">Also send a text message</span>
            <span className="no-sub">
              {sub.phone
                ? prefs.sms ? `${sub.phone} · SMS is on for this contractor` : `${sub.phone} · they prefer email`
                : "No phone on file"}
            </span>
          </span>
        </label>
      </div>
      {!prefs.sms && sendSms && hasPhone && (
        <p className="cov-hint">This contractor has SMS switched off in their notification settings — send it only if it's urgent.</p>
      )}

      {sendEmail && hasEmail && (
        <>
          <div className="form-sec">Email preview</div>
          {previewErr ? (
            <p className="wl-err"><AlertTriangle size={13} /> Could not load the preview ({previewErr}).</p>
          ) : !preview ? (
            <p className="cov-hint">Loading the message…</p>
          ) : (
            <div className="msg-preview">
              <div className="mp-head"><span>Subject</span><strong>{subject}</strong></div>
              <pre className="mp-body">{emailBody}</pre>
            </div>
          )}
          {preview && !mailConfigured && (
            <p className="wl-err"><AlertTriangle size={13} /> Email delivery isn't configured
              on the server yet, so this can't be sent.</p>
          )}
        </>
      )}

      {sendSms && hasPhone && (
        <>
          <div className="form-sec">Text preview</div>
          <div className="sms-bubble">{smsBody}</div>
          <p className="cov-hint">{smsBody.length} characters · {Math.ceil(smsBody.length / 160)} SMS segment{smsBody.length > 160 ? "s" : ""}</p>
          <p className="wl-err"><AlertTriangle size={13} /> SMS isn't wired up yet — only the email will go out.</p>
        </>
      )}

      {err && <p className="wl-err"><AlertTriangle size={13} /> {err}</p>}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-solid" disabled={!canSend} onClick={send}>
          <Send size={15} /> {busy ? "Sending…" : "Send email"}
        </button>
      </div>
    </div>
  );
}

// ---- Add / edit sub form -------------------------------------------------
function SubForm({ onSubmit, onCancel, existing, properties }) {
  const init = existing ? {
    company: existing.company, contact: existing.contact, phone: existing.phone, email: existing.email,
    categories: existing.categories, caps: existing.caps,
    city: existing.city || "", state: existing.state || "", zip2: existing.zip || "",
    license: existing.license || "", ubi: existing.ubi || "",
    propertyIds: existing.propertyIds || [],
    notifyEmail: notifyPrefs(existing).email, notifySms: notifyPrefs(existing).sms,
    mailStreet: existing.mailStreet || "", mailCity: existing.mailCity || "",
    mailState: existing.mailState || "", mailZip: existing.mailZip || "",
    crews: existing.crews ? JSON.parse(JSON.stringify(existing.crews)) : [],
    cities: existing.coverage.cities || [],
    covMode: covMode(existing.coverage),
    radii: covRadii(existing.coverage).length ? covRadii(existing.coverage).map((r) => ({ ...r })) : [{ zip: "", miles: 25 }],
    rating: existing.rating || 0,
    bond: existing.bond, insurance: existing.insurance, contract: existing.contract,
    docFiles: { bond: existing.docFiles?.bond || null, insurance: existing.docFiles?.insurance || null, contract: existing.docFiles?.contract || null },
    available: existing.available, notes: existing.notes || "",
  } : {
    company: "", contact: "", phone: "", email: "", categories: [], caps: [],
    city: "", state: "", zip2: "",
    license: "", ubi: "",
    propertyIds: [],
    notifyEmail: true, notifySms: false,
    mailStreet: "", mailCity: "", mailState: "", mailZip: "",
    crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "", role: "" }] }],
    cities: [], covMode: "cities", radii: [{ zip: "", miles: 25 }], rating: 0,
    bond: false, insurance: false, contract: false, available: true, notes: "",
    docFiles: { bond: null, insurance: null, contract: null },
  };
  const [f, setF] = useState(init);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggle = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  // crew editing helpers
  const addCrew = () => setF((s) => ({ ...s, crews: [...s.crews, { id: "c" + Date.now(), name: `Crew ${s.crews.length + 1}`, members: [{ name: "", role: "" }] }] }));
  const removeCrew = (ci) => setF((s) => ({ ...s, crews: s.crews.filter((_, i) => i !== ci) }));
  const setCrewName = (ci, name) => setF((s) => ({ ...s, crews: s.crews.map((c, i) => i === ci ? { ...c, name } : c) }));
  const addMember = (ci) => setF((s) => ({ ...s, crews: s.crews.map((c, i) => i === ci ? { ...c, members: [...c.members, { name: "", role: "" }] } : c) }));
  const removeMember = (ci, mi) => setF((s) => ({ ...s, crews: s.crews.map((c, i) => i === ci ? { ...c, members: c.members.filter((_, j) => j !== mi) } : c) }));
  const setMember = (ci, mi, k, v) => setF((s) => ({ ...s, crews: s.crews.map((c, i) => i === ci ? { ...c, members: c.members.map((m, j) => j === mi ? { ...m, [k]: v } : m) } : c) }));

  const uploadDoc = (key, filename) => setF((s) => ({ ...s, [key]: true, docFiles: { ...s.docFiles, [key]: filename } }));
  const deleteDoc = (key) => setF((s) => ({ ...s, [key]: false, docFiles: { ...s.docFiles, [key]: null } }));

  const toggleCategory = (id) => {
    setF((s) => {
      const nextCats = s.categories.includes(id) ? s.categories.filter((x) => x !== id) : [...s.categories, id];
      const allowedCaps = new Set(nextCats.flatMap((cat) => CAP_LIBRARY[cat] || []));
      return { ...s, categories: nextCats, caps: s.caps.filter((c) => allowedCaps.has(c)) };
    });
  };

  const caps = [...new Set(f.categories.flatMap((c) => CAP_LIBRARY[c] || []))];
  const cleanRadii = (f.radii || []).filter((r) => r.zip && r.miles).map((r) => ({ zip: r.zip, miles: Number(r.miles) }));
  const coverageOk = f.covMode === "cities" ? f.cities.length > 0 : cleanRadii.length > 0;
  // clean crews: drop empty members, drop crews with no named members
  const cleanCrews = f.crews
    .map((c) => ({ ...c, members: c.members.filter((m) => m.name.trim()) }))
    .filter((c) => c.members.length);
  const valid = f.company && f.contact && f.categories.length && f.caps.length && coverageOk && cleanCrews.length
    && (f.notifyEmail || f.notifySms);
  const build = () => onSubmit({
    ...(existing ? { id: existing.id } : {}),
    company: f.company, contact: f.contact, phone: f.phone, email: f.email,
    city: f.city, state: f.state, zip: f.zip2,
    license: f.license, ubi: f.ubi, propertyIds: f.propertyIds,
    notify: { email: f.notifyEmail, sms: f.notifySms },
    mailStreet: f.mailStreet, mailCity: f.mailCity, mailState: f.mailState, mailZip: f.mailZip,
    categories: f.categories, caps: f.caps, crews: cleanCrews,
    coverage: f.covMode === "cities"
      ? { mode: "cities", cities: f.cities, radii: [] }
      : { mode: "radius", cities: [], radii: cleanRadii },
    bond: f.bond, insurance: f.insurance, contract: f.contract, available: f.available, notes: f.notes,
    rating: Number(f.rating) || 0, docFiles: f.docFiles,
  });
  // Three steps: who they are, what they do, who's on the crew + paperwork.
  // Editing an existing record opens on step 1 but can jump between steps.
  const [step, setStep] = useState(1);
  const STEPS = [
    { n: 1, label: "Company" },
    { n: 2, label: "Trades & coverage" },
    { n: 3, label: "Crews & paperwork" },
  ];
  // Both are optional on this form, but a malformed one is worse than a blank:
  // it looks reachable and silently isn't. Email is required once they've
  // asked us to notify by email at all.
  const subEmailOk = f.notifyEmail ? validEmail(f.email) : (!f.email.trim() || validEmail(f.email));
  const subPhoneOk = f.notifySms
    ? phoneDigits(f.phone).length === 10
    : (!f.phone.trim() || phoneDigits(f.phone).length === 10);
  const step1Ok = !!(f.company.trim() && f.contact.trim()
    && (f.notifyEmail || f.notifySms) && subEmailOk && subPhoneOk);
  const step2Ok = !!(f.categories.length && f.caps.length && coverageOk);
  const step3Ok = cleanCrews.length > 0;
  const stepOk = step === 1 ? step1Ok : step === 2 ? step2Ok : step3Ok;

  return (
    <div className="form">
      <h2>{existing ? "Edit subcontractor" : "Add subcontractor"}</h2>
      <p className="form-sub">Step {step} of 3 · {STEPS[step - 1].label}</p>

      <div className="steps-bar sf-steps">
        {STEPS.map((st) => (
          <button key={st.n} type="button"
            data-state={st.n === step ? "now" : st.n < step ? "done" : undefined}
            onClick={() => { if (st.n < step || existing) setStep(st.n); }}
            disabled={st.n > step && !existing}>
            <span className="sb-n">{st.n < step ? <Check size={12} /> : st.n}</span>
            {st.label}
          </button>
        ))}
      </div>

      {step === 1 && (<>
      <div className="fld-row">
        <label className="fld">Company<input value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="Company name" /></label>
        <label className="fld">Contact<input value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="Primary contact" /></label>
      </div>
      <div className="fld-row">
        <label className="fld">WA L&amp;I license # <span className="fld-note">verified against the state registry</span>
          <input value={f.license} onChange={(e) => set("license", e.target.value.toUpperCase().trim())} placeholder="CASCADR842KL" />
        </label>
        <label className="fld">UBI
          <input inputMode="numeric" value={f.ubi} onChange={(e) => set("ubi", e.target.value.trim())} placeholder="603221887" />
        </label>
      </div>

      <div className="fld-row">
        <label className="fld">Phone<input type="tel" inputMode="numeric" maxLength={13} value={f.phone} onChange={(e) => set("phone", formatPhone(e.target.value))} placeholder="(206)555-0100" /></label>
        <label className="fld">Email<input type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" /></label>
      </div>
      <div className="fld-row">
        <label className="fld">City<input value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Seattle" /></label>
        <label className="fld">State<input value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} placeholder="WA" maxLength={2} /></label>
        <label className="fld">ZIP<input inputMode="numeric" value={f.zip2} onChange={(e) => set("zip2", e.target.value)} placeholder="98101" /></label>
      </div>
      <div className="fld-row">
        <label className="fld">Status
          <select value={f.available ? "y" : "n"} onChange={(e) => set("available", e.target.value === "y")}>
            <option value="y">Available</option><option value="n">Not available</option></select>
        </label>
        <div className="fld">Overall rating
          <div className="rating-edit">
            <StarRate value={Math.round(f.rating)} onRate={(n) => set("rating", n)} label="Set" />
            <input type="number" min="0" max="5" step="0.1" value={f.rating}
              onChange={(e) => set("rating", e.target.value)} />
          </div>
        </div>
      </div>
      <div className="fld">Notifications <span className="fld-note">how they receive automated alerts</span>
        <div className="notify-opts compact">
          <label className={`notify-opt ${f.notifyEmail ? "on" : ""}`}>
            <input type="checkbox" checked={f.notifyEmail}
              onChange={(e) => set("notifyEmail", e.target.checked)} />
            <Mail size={15} /><span className="no-name">Email</span>
          </label>
          <label className={`notify-opt ${f.notifySms ? "on" : ""}`}>
            <input type="checkbox" checked={f.notifySms}
              onChange={(e) => set("notifySms", e.target.checked)} />
            <Phone size={15} /><span className="no-name">SMS</span>
          </label>
        </div>
        {!f.notifyEmail && !f.notifySms
          ? <p className="fld-err"><AlertTriangle size={12} /> Pick at least one — they'd miss job requests otherwise.</p>
          : <p className="cov-hint">Email &amp; SMS is for automated notifications only — one-way, no replies. Contractors can change this in their own account.</p>}
      </div>

      <div className="fld">Mailing address <span className="fld-note">for uniforms &amp; paperwork</span>
        <input value={f.mailStreet} onChange={(e) => set("mailStreet", e.target.value)} placeholder="1234 Industrial Way, Suite B" />
      </div>
      <div className="fld-row">
        <label className="fld">City<input value={f.mailCity} onChange={(e) => set("mailCity", e.target.value)} placeholder="Seattle" /></label>
        <label className="fld">State<input value={f.mailState} maxLength={2} onChange={(e) => set("mailState", e.target.value.toUpperCase().slice(0, 2))} placeholder="WA" /></label>
        <label className="fld">ZIP<input inputMode="numeric" value={f.mailZip} onChange={(e) => set("mailZip", e.target.value)} placeholder="98108" /></label>
      </div>

      </>)}

      {step === 3 && (<>
      <div className="fld">Crews &amp; members
        <div className="crew-edit">
          {f.crews.map((cr, ci) => (
            <div key={cr.id} className="crew-edit-card">
              <div className="crew-edit-head">
                <input className="crew-name-input" value={cr.name} onChange={(e) => setCrewName(ci, e.target.value)} placeholder={`Crew ${ci + 1}`} />
                {f.crews.length > 1 && <button type="button" className="icon-x" onClick={() => removeCrew(ci)}><X size={13} /></button>}
              </div>
              {cr.members.map((m, mi) => (
                <div key={mi} className="member-row">
                  <input value={m.name} onChange={(e) => setMember(ci, mi, "name", e.target.value)} placeholder="Member name" />
                  <input value={m.role} onChange={(e) => setMember(ci, mi, "role", e.target.value)} placeholder="Role" />
                  {cr.members.length > 1 && <button type="button" className="icon-x" onClick={() => removeMember(ci, mi)}><X size={12} /></button>}
                </div>
              ))}
              <button type="button" className="add-line" onClick={() => addMember(ci)}><Plus size={12} /> Member</button>
            </div>
          ))}
          <button type="button" className="add-crew" onClick={addCrew}><Plus size={13} /> Add crew</button>
        </div>
      </div>
      </>)}

      {step === 2 && (<>
      {(properties || []).length > 0 && (
        <div className="fld">Properties they cover
          <p className="fine">Leave all unticked and they're available at every property on the
            account — which is how a general contractor would use it.</p>
          <div className="pick-grid">
            {properties.map((p) => (
              <button key={p.id} type="button"
                className={`pick ${(f.propertyIds || []).includes(p.id) ? "on" : ""}`}
                onClick={() => toggle("propertyIds", p.id)}>{p.name}</button>
            ))}
          </div>
          <p className="cov-hint">
            {(f.propertyIds || []).length
              ? `Scoped to ${f.propertyIds.length} propert${f.propertyIds.length === 1 ? "y" : "ies"}.`
              : "Available at all properties."}
          </p>
        </div>
      )}

      <div className="fld">Categories (choose one or more)
        <div className="pick-grid">{CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`pick ${f.categories.includes(c.id) ? "on" : ""}`}
            onClick={() => toggleCategory(c.id)}>{c.label}</button>
        ))}</div>
      </div>
      {caps.length > 0 && (
        <div className="fld">Capabilities<div className="pick-grid">
          {caps.map((c) => <button key={c} type="button" className={`pick ${f.caps.includes(c) ? "on" : ""}`} onClick={() => toggle("caps", c)}>{c}</button>)}
        </div></div>
      )}
      <div className="fld">Coverage
        <div className="cov-toggle">
          <button type="button" className={f.covMode === "cities" ? "on" : ""} onClick={() => set("covMode", "cities")}>Specific cities</button>
          <button type="button" className={f.covMode === "radius" ? "on" : ""} onClick={() => set("covMode", "radius")}>ZIP radius</button>
        </div>
        {f.covMode === "cities" ? (
          <div className="pick-grid">
            {AREAS.map((a) => <button key={a} type="button" className={`pick ${f.cities.includes(a) ? "on" : ""}`} onClick={() => toggle("cities", a)}>{a}</button>)}
          </div>
        ) : (
          <div className="radii-edit">
            {(f.radii || []).map((r, i) => (
              <div key={i} className="radius-row">
                <input inputMode="numeric" value={r.zip} placeholder="ZIP"
                  onChange={(e) => set("radii", f.radii.map((x, j) => j === i ? { ...x, zip: e.target.value.trim() } : x))} />
                <span>within</span>
                <input type="number" min="1" value={r.miles}
                  onChange={(e) => set("radii", f.radii.map((x, j) => j === i ? { ...x, miles: e.target.value } : x))} />
                <span>mi</span>
                {f.radii.length > 1 && (
                  <button type="button" className="icon-x" onClick={() => set("radii", f.radii.filter((_, j) => j !== i))}><X size={12} /></button>
                )}
              </div>
            ))}
            <button type="button" className="add-line" onClick={() => set("radii", [...f.radii, { zip: "", miles: 25 }])}>
              <Plus size={12} /> Add another radius
            </button>
          </div>
        )}
        <p className="cov-hint">Coverage is either named cities or one-or-more ZIP radii — not both.</p>
      </div>
      <label className="fld">Notes<textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth remembering…" /></label>
      <div className="fld">Documents
        <div className="doc-manage">
          {[["w9", "IRS Form W-9", Receipt],
            ["insurance", "Certificate of insurance", FileText],
            ["bond", "Surety bond", Shield],
            ["contract", "Subcontractor agreement", ScrollText]].map(([k, l, Icon]) => (
            <div key={k} className={`doc-manage-row ${f[k] ? "has" : "none"}`}>
              <Icon size={16} />
              <div className="dm-info">
                <span className="dm-label">{l}</span>
                {f[k] && <span className="dm-file">{f.docFiles[k] || "document.pdf"}</span>}
              </div>
              {f[k] ? (
                <div className="dm-actions">
                  <label className="dm-replace"><Upload size={12} /> Replace
                    <input type="file" hidden onChange={(e) => { if (e.target.files.length) uploadDoc(k, e.target.files[0].name); }} /></label>
                  <button type="button" className="dm-delete" onClick={() => deleteDoc(k)}><Trash2 size={12} /> Delete</button>
                </div>
              ) : (
                <label className="dm-upload"><Upload size={13} /> Upload
                  <input type="file" hidden onChange={(e) => { if (e.target.files.length) uploadDoc(k, e.target.files[0].name); }} /></label>
              )}
            </div>
          ))}
        </div>
      </div>
      </>)}

      <div className="form-actions">
        {step === 1
          ? <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          : <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3
          ? <button className="btn-solid" onClick={() => setStep(step + 1)} disabled={!stepOk}>
              Continue
            </button>
          : <button className="btn-solid" onClick={build} disabled={!valid}>
              {existing ? <><Check size={15} /> Save changes</> : <><Plus size={15} /> Add subcontractor</>}
            </button>}
      </div>
      {!stepOk && (
        <p className="cov-hint">
          {step === 1
            ? !subEmailOk ? (f.notifyEmail && !f.email.trim()
                ? "Add an email address, or turn off email notifications."
                : "That email address does not look right — check for a missing @.")
            : !subPhoneOk ? (f.notifySms && !f.phone.trim()
                ? "Add a mobile number, or turn off text notifications."
                : "A mobile number needs 10 digits.")
            : "Company, contact and at least one notification method are needed."
            : step === 2 ? "Pick at least one trade, one capability, and set a coverage area."
            : "Add at least one crew with a named member."}
        </p>
      )}
    </div>
  );
}

// ---- Styles --------------------------------------------------------------
const CSS = `
:root{--ink:#1a2b23;--ink-soft:#4a5c53;--paper:#f6f4ee;--card:#fffdf8;--line:#e2ddd0;
  --brand:#1f6b4a;--brand-dk:#14523a;--amber:#c8871e;--red:#b5442e;--shadow:0 1px 2px rgba(26,43,35,.06)}
*{box-sizing:border-box}
/* Without this the browser's default 8px body margin frames every full-bleed
   bar in paper -- most visibly the console header, which is meant to run edge
   to edge. */
html,body{margin:0;padding:0}
body{background:var(--paper)}
.ss-root{font-family:'Inter',system-ui,sans-serif;background:var(--paper);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased}
.ss-header{display:flex;flex-direction:column;gap:12px;padding:14px 24px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.header-top{display:flex;justify-content:space-between;align-items:center;gap:14px}
.ss-header .tabs{align-self:flex-start}
/* The h1 is now only a wrapper -- the button inside it carries the layout,
   so that the whole mark, name and address is one hit target rather than
   three. font:inherit undoes the heading's own size and weight, which the
   name span sets for itself. */
.brand{margin:0;font:inherit;display:flex;min-width:0}
.brand-home{display:flex;align-items:center;gap:12px;min-width:0;
  background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;
  /* Padding for the fingertip, negative margin so adding it moved nothing. */
  padding:6px 8px;margin:-6px -8px;border-radius:11px;
  transition:background .12s}
.brand-home:hover{background:var(--paper)}
.brand-home:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.logo{width:38px;height:38px;border-radius:9px;background:var(--brand);color:#fff;display:grid;place-items:center}
.tabs{display:flex;gap:4px;background:var(--paper);padding:4px;border-radius:10px}
.tabs button{border:0;background:none;padding:8px 14px;border-radius:7px;font-size:13.5px;font-weight:600;color:var(--ink-soft);cursor:pointer;display:flex;align-items:center;gap:7px}
.tabs button.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.tabs .count{background:var(--brand);color:#fff;font-size:11px;padding:1px 7px;border-radius:20px;font-weight:700}
.tabs button:not(.on) .count{background:var(--line);color:var(--ink-soft)}
.ss-main{max-width:1160px;margin:0 auto;padding:22px 24px 60px}

.searchbar{display:flex;margin-bottom:14px}
.searchbar .search-input{width:100%}
.search-input{flex:1;display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:0 14px;box-shadow:var(--shadow)}
.search-input svg{color:var(--ink-soft);flex:none}
.search-input input{flex:1;border:0;background:none;padding:13px 0;font-size:14.5px;color:var(--ink);outline:none}
.clear-x{border:0;background:none;color:var(--ink-soft);cursor:pointer;display:grid;place-items:center;padding:4px}
.add-btn{border:0;background:var(--brand);color:#fff;font-weight:600;font-size:13.5px;padding:10px 16px;border-radius:11px;cursor:pointer;display:flex;align-items:center;gap:7px}
.add-btn:hover{background:var(--brand-dk)}
.add-wrap{position:relative;flex:none}
.add-scrim{position:fixed;inset:0;z-index:30}
/* Hangs below the header, so on a short window -- an iPad in landscape, a
   Stage Manager pane -- a menu listing several accounts runs off the bottom
   with nothing to scroll. Cap it against the visible height instead. */
.add-menu{position:absolute;top:100%;right:0;margin-top:6px;background:#ffffff;color:#12211c;border:1px solid #cfd8d2;
  border-radius:11px;box-shadow:0 14px 36px rgba(26,43,35,.22);z-index:60;min-width:200px;padding:5px;display:flex;flex-direction:column;
  max-height:calc(100dvh - 96px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.add-menu button{display:flex;align-items:center;gap:9px;border:0;background:transparent;padding:10px 12px;font-size:13.5px;
  font-weight:600;color:#12211c;cursor:pointer;border-radius:8px;text-align:left}
.add-menu button svg{color:#1f6b4a;flex:none}
.add-menu button:hover{background:#f2f8f4;color:#1f6b4a}
.add-menu .um-name{color:#12211c}
.add-menu .um-role{color:#5d6f67}
.add-menu .user-menu-label{color:#5d6f67}

.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.ms{position:relative;display:flex;flex-direction:column;gap:5px}
.ms>label{font-size:11.5px;font-weight:600;color:var(--ink-soft);display:flex;align-items:center;gap:5px}
.ms-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:132px;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:13px;color:var(--ink);cursor:pointer;font-weight:500}
.ms-btn.disabled{opacity:.5;cursor:not-allowed}
.ms-scrim{position:fixed;inset:0;z-index:30}
.ms-menu{position:absolute;top:100%;left:0;margin-top:4px;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(26,43,35,.15);z-index:31;min-width:160px;max-height:260px;overflow-y:auto;padding:4px}
.ms-opt{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:8px 10px;font-size:13px;color:var(--ink);cursor:pointer;border-radius:7px;text-align:left}
.ms-opt:hover{background:var(--paper)}
.ms-opt.on{color:var(--brand);font-weight:600}
.ms-check{width:16px;height:16px;border:1.5px solid var(--line);border-radius:4px;display:grid;place-items:center;flex:none}
.ms-opt.on .ms-check{background:var(--brand);border-color:var(--brand);color:#fff}
.ready-toggle{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--ink-soft);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 12px;cursor:pointer;height:37px}
.ready-toggle input{accent-color:var(--brand)}
.clear-filters{background:none;border:0;color:var(--brand);font-weight:600;font-size:13px;cursor:pointer;padding:9px 4px;height:37px}
.result-meta{font-size:12.5px;color:var(--ink-soft);margin:18px 2px 14px}

.zip-filter{display:flex;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:0 8px 0 11px;min-width:132px}
.zip-filter input{border:0;background:none;padding:9px 0;font-size:13px;color:var(--ink);outline:none;width:100%;min-width:0}
.zip-x{border:0;background:none;color:var(--ink-soft);cursor:pointer;display:grid;place-items:center;padding:2px}
.zip-note{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--brand);font-weight:600;margin-top:10px}
.prox-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:7px;margin-bottom:10px}
.prox-badge.in{background:#e2f0e7;color:#1f6b4a}
.prox-badge.out{background:#f7e5df;color:var(--red)}
.prox{display:flex;align-items:center;gap:8px;font-size:13px;padding:10px 12px;border-radius:9px;margin-bottom:14px}
.prox.in{background:#e2f0e7;color:#1f6b4a}
.prox.out{background:#f7e5df;color:#b5442e}
.prox strong{font-weight:800}
.dist-out{color:var(--red);font-weight:600}
.muted{font-size:13px;color:var(--ink-soft)}
.radius-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ink);margin-top:2px}
.radius-toggle input{accent-color:var(--brand)}
.cov-hint{font-size:11.5px;color:var(--ink-soft);margin:8px 0 0;font-weight:400;font-style:italic}

/* Invite links. The URL stays visible and selectable: clipboard access gets
   refused often enough that "Copy" cannot be the only way to get at it. */
.inv-panel{max-width:560px}
.inv-make{display:flex;gap:10px;align-items:flex-end;margin:16px 0 14px}
.inv-make .fld{flex:1;margin:0}
.inv-row-out{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;
  border:1px solid var(--line);border-radius:11px;padding:12px 13px;margin-top:9px;background:var(--card)}
.inv-row-out.spent{opacity:.6}
.inv-main{min-width:0;display:flex;flex-direction:column;gap:4px}
.inv-main b{font-size:13.5px}
.inv-url{font-size:11.5px;color:var(--ink-soft);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
/* Which building a tenant link is tied to, or that it lets them choose. */
.inv-chip{display:inline-block;margin-left:8px;font-size:10.5px;font-weight:700;
  background:var(--paper);border:1px solid var(--line);color:var(--ink-soft);
  padding:2px 8px;border-radius:20px;vertical-align:1px}
.inv-acts{display:flex;gap:7px;flex:none}
.inv-acts .pick{display:flex;align-items:center;gap:5px}
.inv-past{margin:20px 0 0;font-size:11.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink-soft)}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;cursor:pointer;box-shadow:var(--shadow);transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--brand);transform:translateY(-2px)}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px}
.cat-row{display:flex;flex-wrap:wrap;gap:5px}
.cat-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:#eef1ee;color:var(--brand-dk)}
.cat-roofing{background:#eaf3ee;color:#1f6b4a}
.cat-siding{background:#fdf1e3;color:#a86a18}
.cat-windows_doors{background:#e9f0f6;color:#2b5c85}
.cat-gutters{background:#eef1f4;color:#4a5c6b}
.cat-deck_fence{background:#f2eee5;color:#7a5a2e}
.cat-hardscaping{background:#f0ecf0;color:#6b4a6b}
.cat-soffit_fascia{background:#eaf0f2;color:#3d6470}
.cat-coping{background:#f4efe8;color:#7a6142}
.avail-dot{width:11px;height:11px;border-radius:50%;flex:none;margin-top:3px}
.avail-dot.up{background:#3a9b63;box-shadow:0 0 0 3px #d9ecdf}
.avail-dot.down{background:#c05a3f;box-shadow:0 0 0 3px #f2ddd5}
.name-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.name-row.big{margin:8px 0 6px}
.name-row h3{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}
.name-row h2{margin:0;font-size:22px;letter-spacing:-.02em}
.stars{font-size:12.5px;font-weight:700;color:var(--amber);display:inline-flex;align-items:center;gap:3px;flex:none}
.contact{margin:2px 0 11px;font-size:13px;color:var(--ink-soft);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.caps{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:11px}
.cap{font-size:11.5px;background:var(--paper);border:1px solid var(--line);padding:3px 8px;border-radius:6px;color:var(--ink-soft)}
.cap.more{font-weight:700;color:var(--brand)}
.areas{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-soft);margin-bottom:10px}
.stat-strip{display:flex;gap:8px;margin-bottom:11px}
.stat{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:6px;background:var(--paper);border:1px solid var(--line);color:var(--ink-soft)}
.stat.ok{color:#1f6b4a}.stat.no{color:var(--red)}.stat.rate{color:var(--ink);margin-left:auto}
.card-docs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.doc-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px}
.doc-ok{background:#e8f2ea;color:#1f6b4a}.doc-missing{background:#faece7;color:var(--red)}
.card-actions{display:flex;gap:7px}
.mini{flex:1;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:12.5px;font-weight:600;padding:8px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px}
.mini:hover{background:var(--paper)}
.mini.primary{background:var(--brand);color:#fff;border-color:var(--brand)}
.mini.primary:hover{background:var(--brand-dk)}
.mini:disabled{opacity:.45;cursor:not-allowed}
.blocked-note{font-size:11.5px;color:var(--red);margin-top:9px;text-align:center}
.blocked-note.big{font-size:13px;background:#faece7;padding:10px;border-radius:8px;margin-top:14px}

.empty{text-align:center;padding:70px 20px;color:var(--ink-soft)}
.empty svg{opacity:.5;margin-bottom:12px}
.empty p{margin:0 0 14px;font-size:15px}
.empty button{border:1px solid var(--line);background:var(--card);padding:9px 18px;border-radius:9px;font-weight:600;color:var(--brand);cursor:pointer}

.jobs-list{display:flex;flex-direction:column;gap:12px}
.job-row{display:flex;align-items:center;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px 18px;box-shadow:var(--shadow)}
.job-cat{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;flex:none}
.job-main{flex:1;min-width:0}
.job-head{display:flex;align-items:center;gap:10px}
.job-head h3{margin:0;font-size:15.5px;font-weight:700}
.job-status{font-size:11px;font-weight:700;text-transform:capitalize;padding:2px 9px;border-radius:20px}
.st-pending{background:#fbf0dd;color:#a86a18}
.st-accepted{background:#e8f2ea;color:#1f6b4a}
.st-declined{background:#faece7;color:var(--red)}
.job-sub{margin:3px 0 8px;font-size:13px;color:var(--ink-soft)}
.job-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink-soft)}
.job-meta span{display:flex;align-items:center;gap:5px}
.wo-sent{color:var(--brand);font-weight:600}
.job-respond{display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex:none}
.respond-label{font-size:11px;color:var(--ink-soft)}
.respond-btns{display:flex;gap:7px}
.resp{display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;background:var(--card)}
.resp.accept{color:#1f6b4a;border-color:#bfe0cb}.resp.accept:hover{background:#e8f2ea}
.resp.decline{color:var(--red);border-color:#f0d1c8}.resp.decline:hover{background:#faece7}
.job-final{display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:700;flex:none}
.job-final.accepted{color:var(--brand)}.job-final.declined{color:var(--red)}

.cal-legend{display:flex;gap:20px;margin-bottom:16px;font-size:12.5px;color:var(--ink-soft)}
.cal-legend span{display:flex;align-items:center;gap:7px}
.lg{width:13px;height:13px;border-radius:4px;display:inline-block}
.lg.up{background:#3a9b63}.lg.down{background:#c05a3f}.lg.booked{background:#2b5c85}
.cal-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:4px;box-shadow:var(--shadow)}
.cal-grid{display:grid;grid-template-columns:170px repeat(14,minmax(42px,1fr));gap:3px;min-width:760px}
.cal-corner{font-size:11.5px;font-weight:700;color:var(--ink-soft);padding:8px;display:flex;align-items:center}
.cal-dayhead{display:flex;flex-direction:column;align-items:center;padding:6px 2px;font-size:11px}
.cal-dayhead .dow{color:var(--ink-soft)}
.cal-dayhead .dom{font-weight:700;font-size:13px}
.cal-sub{display:flex;align-items:center;gap:8px;padding:8px;font-size:12.5px;font-weight:600;border-top:1px solid var(--line)}
.cal-sub-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-cell{border-top:1px solid var(--line);border-radius:5px;min-height:34px;display:grid;place-items:center;margin-top:-1px}
.cal-cell.up{background:#e2f0e7}.cal-cell.down{background:#f7e5df}.cal-cell.booked{background:#dbe8f2}
.cal-cell.clickable{cursor:pointer}
.cal-cell.clickable:hover{background:#cfe6d8;box-shadow:inset 0 0 0 2px var(--brand)}
.cal-job{font-size:11px;font-weight:700;color:#2b5c85;background:#fff;width:20px;height:20px;border-radius:50%;display:grid;place-items:center}
.cal-plus{font-size:16px;font-weight:700;color:#3a9b63;opacity:0;transition:opacity .12s}
.cal-cell.clickable:hover .cal-plus{opacity:1}
.cal-hint{margin-left:auto;font-style:italic;color:var(--ink-soft)}

.modal-backdrop{position:fixed;inset:0;background:rgba(26,43,35,.4);display:grid;place-items:center;padding:20px;z-index:50;backdrop-filter:blur(2px)}
.modal{background:var(--card);border-radius:16px;padding:26px;max-width:440px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 50px rgba(26,43,35,.25)}
.modal-wide{max-width:560px}
.modal-close{position:absolute;top:16px;right:16px;border:0;background:var(--paper);width:30px;height:30px;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--ink-soft)}
.modal-close:hover{background:var(--line)}

.detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:2px}
.edit-btn{display:flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;flex:none}
.edit-btn:hover{background:var(--paper);border-color:var(--brand);color:var(--brand)}
.detail-contact{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:6px}
.detail-contact a{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--brand);text-decoration:none;font-weight:600}
.detail-person{font-size:13px;color:var(--ink-soft);margin:0 0 16px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.avail-inline{font-weight:700;margin-left:2px}.avail-inline.up{color:#3a9b63}.avail-inline.down{color:#c05a3f}
.stat-cards{display:flex;gap:10px;margin-bottom:18px}
.stat-card{flex:1;background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:12px;text-align:center}
.sc-num{display:block;font-size:22px;font-weight:800;letter-spacing:-.02em}
.sc-lab{display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;color:var(--ink-soft);margin-top:3px;font-weight:600}
.detail section{margin-bottom:22px}
.detail h4{margin:0 0 9px;font-size:12.5px;font-weight:700;color:var(--ink-soft);display:flex;align-items:center;gap:5px}
.area-chips{display:flex;flex-wrap:wrap;gap:7px}
.area-chips + .cov-radius{margin-top:10px}
.area-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;background:var(--paper);border:1px solid var(--line);padding:4px 9px;border-radius:7px;color:var(--ink-soft)}
.cov-radius{display:flex;align-items:center;gap:7px;font-size:13.5px;color:var(--ink);background:var(--paper);border:1px solid var(--line);padding:10px 12px;border-radius:9px;margin-top:10px}
.notes-area{width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:13.5px;font-family:inherit;color:var(--ink);background:var(--card);resize:vertical}
.notes-save{margin-top:8px;border:0;background:var(--brand);color:#fff;font-weight:600;font-size:12.5px;padding:7px 14px;border-radius:8px;cursor:pointer}
.doc-rows{display:flex;flex-direction:column;gap:8px}
.doc-row{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:10px;border:1px solid var(--line)}
.doc-row.ok{background:#f2f8f4;border-color:#d4e7db}
.doc-row.missing{background:#fbf1ed;border-color:#f0d9d1}
.doc-label{flex:1;font-size:13.5px;font-weight:600}
.doc-status{display:flex;align-items:center;gap:5px;font-size:12.5px;color:var(--brand);font-weight:600}
.doc-upload{display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--red);cursor:pointer;background:var(--card);border:1px solid #f0d9d1;padding:5px 10px;border-radius:7px}
.detail-actions{display:flex;gap:9px;margin-top:20px}

.form h2{margin:0 0 4px;font-size:20px;letter-spacing:-.01em}
.form-sub{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-soft);margin:0 0 20px}
/* The flex above is for a one-line lead with an icon beside it. A paragraph
   with a bold phrase or an interpolated word in it becomes three items sitting
   in a row instead of a sentence, so prose opts out of it. */
.form-sub.prose{display:block;line-height:1.55}
.fld{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-bottom:14px}
.fld input,.fld select,.fld textarea{width:100%;margin-top:6px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:14px;color:var(--ink);background:var(--card);font-family:inherit}
.fld textarea{resize:vertical}
.fld-row{display:flex;gap:12px}.fld-row .fld{flex:1}
.pick-grid{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.pick{border:1px solid var(--line);background:var(--card);font-size:12.5px;padding:6px 11px;border-radius:7px;cursor:pointer;color:var(--ink-soft);font-weight:600}
.pick.on{background:var(--brand);color:#fff;border-color:var(--brand)}

/* Used by the account-type picker and the trades panel. Thirty chips need to
   wrap; six short groups read better than one block of them. */
.picks{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.trade-group{margin-top:15px}
.trade-group h5{margin:0 0 8px;font-size:11.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink-soft)}
.cov-toggle{display:flex;gap:6px;margin-top:8px;margin-bottom:4px}
.cov-toggle button{flex:1;border:1px solid var(--line);background:var(--card);padding:8px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--ink-soft);cursor:pointer}
.cov-toggle button.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.radius-row{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--ink-soft)}
.radius-row input{width:auto;flex:1;margin-top:0}.radius-row input[type=number]{max-width:80px;flex:none}
.doc-manage{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.doc-manage-row{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;border:1px solid var(--line)}
.doc-manage-row.has{background:#f2f8f4;border-color:#d4e7db}
.doc-manage-row.none{background:var(--card)}
.dm-info{flex:1;min-width:0;display:flex;flex-direction:column}
.dm-label{font-size:13px;font-weight:600;color:var(--ink)}
.dm-file{font-size:11px;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-actions{display:flex;gap:6px;flex:none}
.dm-upload{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--brand);cursor:pointer;background:var(--card);border:1px solid var(--brand);padding:6px 11px;border-radius:7px}
.dm-replace{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:var(--ink-soft);cursor:pointer;background:var(--card);border:1px solid var(--line);padding:6px 9px;border-radius:7px}
.dm-replace:hover{border-color:var(--brand);color:var(--brand)}
.dm-delete{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:var(--red);cursor:pointer;background:var(--card);border:1px solid #f0d1c8;padding:6px 9px;border-radius:7px}
.dm-delete:hover{background:#faece7}
.doc-label-wrap{flex:1;min-width:0;display:flex;flex-direction:column}
.doc-file{font-size:11px;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc-add{display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--red);cursor:pointer;background:var(--card);border:1px solid #f0d9d1;padding:5px 10px;border-radius:7px}
.doc-add:hover{background:#faece7}
.wo-box{background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:14px;margin-bottom:18px}
.wo-box-head{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:700;margin-bottom:11px}
.wo-upload{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--brand);cursor:pointer;background:var(--card);border:1px dashed var(--brand);padding:10px;border-radius:9px;margin-bottom:11px}
.wo-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink)}
.wo-check input{accent-color:var(--brand)}
.form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:8px}
.btn-ghost{border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:600;font-size:13.5px;padding:10px 18px;border-radius:10px;cursor:pointer}
.btn-solid{border:0;background:var(--brand);color:#fff;font-weight:600;font-size:13.5px;padding:10px 20px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:7px}
.btn-solid:hover{background:var(--brand-dk)}
.btn-solid:disabled{opacity:.45;cursor:not-allowed}
.sent-state{text-align:center;padding:14px 0}
.sent-state svg{color:var(--brand);margin-bottom:8px}
.sent-state p{color:var(--ink-soft);margin:0 0 20px}
@media(max-width:640px){.fld-row{flex-direction:column;gap:0}.detail-actions,.card-actions{flex-wrap:wrap}.stat-cards{flex-wrap:wrap}}

/* crews — detail */
.crew-list{display:flex;flex-direction:column;gap:10px}
.crew-card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.crew-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.crew-name{font-size:13.5px;font-weight:700}
.crew-size{font-size:11px;font-weight:600;color:var(--ink-soft);background:var(--card);border:1px solid var(--line);padding:2px 8px;border-radius:20px}
.crew-members{display:flex;flex-wrap:wrap;gap:6px}
.member{display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:7px;padding:4px 9px;font-size:12px}
.m-name{font-weight:600;color:var(--ink)}
.m-role{color:var(--ink-soft);font-size:11px;background:var(--paper);padding:1px 6px;border-radius:5px}
/* crews — editor */
.crew-edit{display:flex;flex-direction:column;gap:10px;margin-top:8px}
.crew-edit-card{border:1px solid var(--line);border-radius:10px;padding:11px;background:var(--card)}
.crew-edit-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.crew-name-input{flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:700;font-family:inherit;color:var(--ink)}
.member-row{display:flex;gap:7px;align-items:center;margin-bottom:6px}
.member-row input{flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;font-family:inherit;color:var(--ink);min-width:0}
.member-row input:last-of-type{max-width:110px;flex:none}
.icon-x{border:0;background:var(--paper);color:var(--ink-soft);width:26px;height:26px;border-radius:7px;display:grid;place-items:center;cursor:pointer;flex:none}
.icon-x:hover{background:#f2ddd5;color:var(--red)}
.add-line{border:1px dashed var(--line);background:none;color:var(--brand);font-size:12px;font-weight:600;padding:6px 10px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;margin-top:3px}
.add-crew{border:1px solid var(--brand);background:var(--card);color:var(--brand);font-size:12.5px;font-weight:700;padding:8px 12px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;align-self:flex-start}

/* schedule preview */
.when-preview{display:flex;align-items:center;gap:8px;background:#eef5f1;border:1px solid #cfe0d6;color:var(--brand-dk);font-size:13px;padding:9px 12px;border-radius:9px;margin-bottom:14px}
.when-preview strong{font-weight:800}
.wo-flag{display:inline-flex;align-items:center;gap:6px;background:#fbf0dd;color:#a86a18;font-size:12px;font-weight:700;padding:5px 10px;border-radius:7px;margin-bottom:14px}

/* work order sheet */
.wo-sheet{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;box-shadow:var(--shadow);max-width:720px;margin:0 auto}
.wo-section{border-top:1px solid var(--line);padding-top:16px;margin-top:16px}
.wo-section:first-of-type{border-top:0;margin-top:0;padding-top:0}
.wo-section h4{margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:.06em;color:var(--brand-dk);text-transform:uppercase}
.wo-checks{display:flex;flex-direction:column;gap:9px}
.wo-check-row{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink)}
.wo-check-row input{accent-color:var(--brand);width:16px;height:16px}
.wo-complete{width:100%;justify-content:center;margin-top:20px;padding:13px}
.wo-complete-note{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:20px;background:#e8f2ea;color:var(--brand);font-weight:700;font-size:13.5px;padding:12px;border-radius:10px}

/* recommendations */
.wo-recs{max-width:720px;margin:22px auto 0}
.wo-recs h3{margin:0 0 3px;font-size:17px;letter-spacing:-.01em}
.wo-recs-sub{margin:0 0 16px;font-size:12.5px;color:var(--ink-soft)}
.rec-row{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow);margin-bottom:10px}
.rec-rank{width:28px;height:28px;border-radius:50%;background:var(--brand);color:#fff;font-weight:800;font-size:13px;display:grid;place-items:center;flex:none}
.rec-main{flex:1;min-width:0}
.rec-head{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.rec-head h4{margin:0;font-size:15px;font-weight:700}
.rec-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rec-ok{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#1f6b4a;background:#e8f2ea;padding:3px 8px;border-radius:6px}
.rec-warn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--red);background:#faece7;padding:3px 8px;border-radius:6px}
.rec-send{flex:none;padding:9px 14px;font-size:13px}

/* work order guide */
.wo-guide{background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:13px 16px;margin-bottom:18px}
.wo-guide h5{margin:0 0 9px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--brand-dk)}
.wo-guide ol{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.wo-guide li{font-size:12.5px;color:var(--ink-soft);line-height:1.45}
.wo-guide strong{color:var(--ink)}

/* jobs: multi-trade cards */
.jobs-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.jobs-head h3{margin:0;font-size:16px}
.add-btn.small{padding:8px 13px;font-size:12.5px;border-radius:9px}
.add-btn:disabled{opacity:.45;cursor:not-allowed}
.job-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:var(--shadow)}
.job-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.job-card-head h3{margin:0 0 6px;font-size:16.5px;font-weight:700;letter-spacing:-.01em}
.fill-badge{flex:none;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;background:#fbf0dd;color:#a86a18}
.fill-badge.full{background:#e8f2ea;color:#1f6b4a}
.job-scope{font-size:13px;color:var(--ink-soft);margin:10px 0 0;line-height:1.45}
.trade-rows{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.trade-row{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:10px;border:1px solid var(--line)}
.trade-row.open{background:var(--paper);border-style:dashed}
.trade-row.filled{background:#f7faf8}
.trade-icon{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;flex:none}
.trade-main{flex:1;min-width:0}
.trade-name{display:block;font-size:13.5px;font-weight:700}
.trade-open-note{font-size:12px;color:var(--ink-soft)}
.trade-assigned{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:3px}
.ta-company{font-size:12.5px;font-weight:600;color:var(--brand)}
.ta-crew{font-size:11.5px;border:1px solid var(--line);border-radius:6px;padding:2px 6px;background:var(--card);color:var(--ink-soft);font-family:inherit}
.ta-crew-flat{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--ink-soft)}
.ta-wo{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--ink-soft)}
.ta-in{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:#1f6b4a;font-weight:600}
.ta-out{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--red);font-weight:600}
.trade-actions{display:flex;align-items:center;gap:7px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.trade-row .star-rate{margin-right:4px}
.trade-assign{display:flex;align-items:center;gap:6px;border:1px solid var(--brand);background:var(--card);color:var(--brand);font-size:12.5px;font-weight:700;padding:8px 13px;border-radius:8px;cursor:pointer;flex:none}
.trade-assign:hover{background:#eef5f1}
.trade-swap{border:1px solid var(--line);background:var(--card);color:var(--ink-soft);font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:7px;cursor:pointer}
.trade-swap:hover{border-color:var(--brand);color:var(--brand)}

/* pick lists (assign modals) */
.pick-list{display:flex;flex-direction:column;gap:9px;margin-bottom:16px;max-height:54vh;overflow-y:auto}
.pick-row{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:11px;padding:12px 13px;background:var(--card)}
.rec-dup{font-size:10.5px;font-weight:700;color:#a86a18;background:#fbf0dd;padding:3px 7px;border-radius:5px}

/* header right: add + user switcher */
.header-right{display:flex;align-items:center;gap:10px;flex:none}
.user-wrap{position:relative}
.user-btn{display:flex;align-items:center;gap:9px;background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:6px 11px 6px 7px;cursor:pointer}
.user-btn:hover{border-color:var(--brand)}
.user-avatar{width:28px;height:28px;border-radius:50%;background:var(--brand);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;flex:none}
.user-avatar.lg{width:36px;height:36px;font-size:12.5px}
.user-meta{display:flex;flex-direction:column;align-items:flex-start;line-height:1.2}
.user-name{font-size:12.5px;font-weight:700;color:var(--ink)}
.user-role{font-size:10.5px;color:var(--ink-soft);font-weight:600}
.user-menu{min-width:210px}
.user-menu-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);padding:7px 12px 5px}
.user-menu button{flex-direction:column;align-items:flex-start !important;gap:1px !important}
.user-menu button.on{background:#eef5f1}
.um-name{font-size:13px;font-weight:600}
.um-role{font-size:11px;color:var(--ink-soft);font-weight:500}

/* users tab */
.user-list{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.user-row{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow)}
.user-row-main{flex:1;min-width:0}
.user-row-head{display:flex;align-items:center;gap:9px}
.user-row-head h4{margin:0;font-size:15px;font-weight:700}
.user-row-sub{margin:3px 0 0;font-size:12.5px;color:var(--ink-soft)}
.user-row-perms{font-size:11.5px;color:var(--ink-soft);max-width:230px;text-align:right;flex:none}
.role-badge{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em}
.r-admin{background:#eae4f2;color:#5b3f7a}
.r-pm{background:#e9f0f6;color:#2b5c85}
.r-contractor{background:#eaf3ee;color:#1f6b4a}
.you-badge{font-size:10px;font-weight:700;background:var(--paper);border:1px solid var(--line);color:var(--ink-soft);padding:2px 7px;border-radius:20px}
.role-pick{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.role-pick button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:11px 13px;cursor:pointer;text-align:left}
.role-pick button.on{border-color:var(--brand);background:#f2f8f4}
.rp-label{font-size:13.5px;font-weight:700;color:var(--ink)}
.rp-desc{font-size:11.5px;color:var(--ink-soft)}

/* contractor portal */
.portal-head{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.portal-head h2{margin:0;font-size:21px;letter-spacing:-.02em}
.portal-sub{margin:3px 0 0;font-size:13px;color:var(--ink-soft)}
.avail-switch{display:flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:10px 14px;font-size:13px;font-weight:700;color:var(--ink-soft);cursor:pointer}
.avail-switch.on{border-color:#bfe0cb;background:#f2f8f4;color:#1f6b4a}
.avail-switch input{accent-color:var(--brand)}
.portal-tabs{display:flex;gap:4px;background:var(--paper);padding:4px;border-radius:10px;margin-bottom:18px;align-self:flex-start;width:fit-content}
.portal-tabs button{border:0;background:none;padding:9px 15px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--ink-soft);cursor:pointer;display:flex;align-items:center;gap:7px}
.portal-tabs button.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.portal-tabs .count{background:var(--amber);color:#fff;font-size:11px;padding:1px 7px;border-radius:20px;font-weight:700}
.portal-panel{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:20px;box-shadow:var(--shadow)}
.portal-panel h4{margin:0 0 4px;font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--brand-dk)}
.portal-crew{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-soft);margin:10px 0 0}
.portal-respond{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.portal-final{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}

/* doc-blocked notice + notify button */
.doc-block{display:flex;align-items:flex-start;gap:10px;background:#fbf0dd;border:1px solid #ecd9b0;color:#8a5a12;font-size:12.5px;line-height:1.45;padding:12px 14px;border-radius:10px;margin-bottom:16px}
.doc-block svg{flex:none;margin-top:1px}
.doc-block strong{color:#6d460c}
.doc-block.with-cta{align-items:center;flex-wrap:wrap}
.doc-block.with-cta>div{flex:1;min-width:180px}
.doc-block.with-cta .btn-notify{flex:none}
.btn-notify{border:0;background:var(--amber);color:#fff;font-weight:600;font-size:13px;padding:9px 14px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;flex:none}
.btn-notify:hover{background:#a86a18}
.for-sub{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;padding:11px 13px;border-radius:9px;margin-bottom:16px;background:#f2f8f4;border:1px solid #d4e7db;color:#1f6b4a;line-height:1.4}
.for-sub.warn{background:#fbf0dd;border-color:#ecd9b0;color:#8a5a12}
.for-sub svg{flex:none;margin-top:1px}

/* user row actions */
.user-row-actions{display:flex;align-items:center;gap:7px;flex:none}
.um-sec{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;
  color:var(--ink-soft);padding:10px 14px 5px;border-top:1px solid var(--line);margin-top:4px}
.um-acct{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;
  padding:9px 14px;cursor:pointer;text-align:left;font:inherit}
.um-acct:hover{background:var(--paper)}
.ua-name{font-size:13.5px;font-weight:600;color:var(--ink)}
.ua-role{font-size:11px;color:var(--ink-soft)}
.ua-tick{margin-left:auto;color:var(--brand);flex:none}
.um-account{border-bottom:1px solid var(--line);border-radius:8px 8px 0 0 !important;margin-bottom:3px;color:var(--brand) !important;font-weight:700 !important}
.role-locked{display:flex;align-items:center;gap:10px;margin-top:8px;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:10px 12px}
.rl-note{font-size:11.5px;color:var(--ink-soft);font-weight:400}

/* auto-schedule */
.auto-badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;color:#8a5a12;background:#fbf0dd;padding:3px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.03em}
.auto-badge.card{margin-bottom:10px;width:fit-content}
.auto-card{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px 18px;margin-bottom:18px;box-shadow:var(--shadow)}
.auto-card.on{border-color:#ecd9b0;background:#fffdf6}
.auto-card>svg{color:var(--ink-soft);flex:none}
.auto-card.on>svg{color:var(--amber)}
.auto-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.auto-title{font-size:14.5px;font-weight:700}
.auto-desc{font-size:12.5px;color:var(--ink-soft);line-height:1.4}
.auto-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink-soft);cursor:pointer;flex:none}
.auto-toggle input{accent-color:var(--amber);width:17px;height:17px}
.auto-booked{display:flex;align-items:center;gap:7px;color:#8a5a12;font-weight:700;font-size:13.5px}

/* star rating */
.star-rate{display:flex;align-items:center;gap:2px;flex:none}
.sr-label{font-size:10.5px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.04em;margin-right:5px}
.sr-star{border:0;background:none;padding:1px;cursor:pointer;color:var(--line);display:grid;place-items:center}
.sr-star.on{color:var(--amber)}
.sr-star:hover{color:var(--amber)}
.sr-val{font-size:11.5px;font-weight:800;color:var(--amber);margin-left:4px}
.rating-edit{display:flex;align-items:center;gap:10px;margin-top:6px}
.rating-edit input{width:70px;flex:none;margin-top:0}
.rating-wrap{display:flex;align-items:center;gap:7px}
.rated-count{font-size:10.5px;color:var(--ink-soft);font-weight:600}

/* portal panel extras */
.panel-note{font-size:12.5px;color:var(--ink-soft);margin:0 0 14px;line-height:1.4}
.panel-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.panel-count{font-size:12.5px;color:var(--ink-soft);font-weight:600}
.saved-note{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--brand)}

/* mini calendar (contractor availability) */
.mini-cal-nav{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:14px 0 10px;font-size:13px;font-weight:700}
.mini-cal-nav button{border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;cursor:pointer}
.mini-cal-nav button:hover:not(:disabled){border-color:var(--brand);color:var(--brand)}
.mini-cal-nav button:disabled{opacity:.4;cursor:not-allowed}
.mini-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.mc-dow{text-align:center;font-size:10.5px;font-weight:700;color:var(--ink-soft);padding-bottom:3px;text-transform:uppercase}
.mc-day{aspect-ratio:1;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:0}
.mc-num{font-size:12.5px;font-weight:700;color:var(--ink)}
.mc-day.free{background:#e2f0e7;border-color:#cfe0d6}
.mc-day.free:hover{background:#cfe6d8;border-color:var(--brand)}
.mc-day.off{background:#f7e5df;border-color:#f0d1c8}
.mc-day.off .mc-num{color:var(--red);text-decoration:line-through}
.mc-day.off:hover{background:#f2ddd5}
.mc-day.booked{background:#dbe8f2;border-color:#c3d8e8;cursor:not-allowed;color:#2b5c85}
.mc-day.booked .mc-num{color:#2b5c85}

/* day-level availability in assign flows */
.day-badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:6px}
.d-free{background:#e2f0e7;color:#1f6b4a}
.d-booked{background:#dbe8f2;color:#2b5c85}
.d-off{background:#f7e5df;color:var(--red)}
.d-unavailable{background:#f2ddd5;color:var(--red)}
.btn-warn{border:0;background:var(--amber);color:#fff;font-weight:600;font-size:13px;padding:9px 14px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;flex:none}
.btn-warn:hover{background:#a86a18}
.pick-hint{font-size:11.5px;color:var(--ink-soft);font-style:italic;margin:-12px 0 14px}
.off-days{display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:#f7e5df;border:1px solid #f0d1c8;color:var(--red);font-size:12px;font-weight:600;padding:9px 12px;border-radius:9px;margin-bottom:14px}
.off-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;background:#f7e5df;border:1px solid #f0d1c8;padding:4px 9px;border-radius:7px;color:var(--red);font-weight:600}

/* ---- request documentation CTAs ---- */
.req-docs-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;background:#fbf0dd;border:1px solid #ecd9b0;border-radius:9px;padding:7px 9px}
.rd-text{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:#8a5a12}
.rd-btn{display:inline-flex;align-items:center;gap:5px;border:0;background:var(--amber);color:#fff;font-size:11.5px;font-weight:700;padding:6px 10px;border-radius:7px;cursor:pointer;flex:none}
.rd-btn:hover{background:#a86a18}
.detail-doc-block{margin-top:16px;align-items:center;flex-wrap:wrap}
.detail-doc-block>div{flex:1;min-width:160px}
.btn-notify.sm{padding:6px 10px;font-size:11.5px;border-radius:7px}
.doc-row-actions{display:flex;gap:6px;flex:none}
.doc-req{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;color:#fff;background:var(--amber);border:0;padding:6px 10px;border-radius:7px;cursor:pointer}
.doc-req:hover{background:#a86a18}
.cal-hint svg{vertical-align:-2px;color:var(--amber)}

/* ---- crew ratings ---- */
.crew-head-right{display:flex;align-items:center;gap:7px;flex:none}
.crew-rating{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:var(--amber);background:var(--card);border:1px solid var(--line);padding:2px 8px;border-radius:20px}
.crew-rating em{font-style:normal;font-weight:600;color:var(--ink-soft);font-size:10.5px}
.crew-unrated{font-size:10.5px;color:var(--ink-soft);font-weight:600}
.rollup-note{font-size:11.5px;color:var(--ink-soft);margin:11px 0 0;line-height:1.45;font-style:italic}
.rollup-note strong{color:var(--amber);font-style:normal}

/* ---- login / splash ---- */
.login-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;background:var(--paper)}
.login-card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px;box-shadow:0 8px 30px rgba(26,43,35,.08)}
.login-brand{text-align:center;margin-bottom:24px}
.logo.lg{width:52px;height:52px;border-radius:13px;margin:0 auto 12px}
.login-brand h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.03em}
.login-brand p{margin:3px 0 0;font-size:13px;color:var(--ink-soft)}
.login-form .fld{margin-bottom:13px}
.login-btn{width:100%;justify-content:center;padding:13px;margin-top:4px}
.login-err{display:flex;align-items:center;gap:7px;background:#faece7;border:1px solid #f0d1c8;color:var(--red);font-size:12.5px;font-weight:600;padding:9px 11px;border-radius:9px;margin-bottom:12px}
.login-forgot{display:block;width:100%;border:0;background:none;color:var(--ink-soft);font-size:12.5px;font-weight:600;padding:11px 0 0;cursor:pointer;text-align:center}
.login-forgot:hover{color:var(--brand)}
.login-foot{font-size:11.5px;color:var(--ink-soft);margin-top:18px;text-align:center}
.um-signout{border-top:1px solid var(--line);border-radius:0 0 8px 8px !important;margin-top:3px;color:var(--red) !important;font-weight:700 !important}

/* splash logo — centered, square, no squash */
.login-logo{width:60px;height:60px;border-radius:16px;background:var(--brand);color:#fff;
  display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 4px 14px rgba(31,107,74,.28)}
.login-logo svg{display:block;width:28px;height:28px;flex:none}

/* header availability toggle (contractor) */
.hdr-avail{display:flex;align-items:center;gap:8px;background:var(--paper);border:1px solid var(--line);
  border-radius:11px;padding:8px 12px;font-size:12.5px;font-weight:700;color:var(--ink-soft);cursor:pointer;flex:none}
.hdr-avail.on{border-color:#bfe0cb;background:#f2f8f4;color:#1f6b4a}
.hdr-avail input{accent-color:var(--brand);width:15px;height:15px}
.hdr-avail .avail-dot{margin-top:0}
.count.amber{background:var(--amber) !important;color:#fff !important}

/* contractor dashboard */
/* Getting started. Reads as a runway, so only the current step carries its
   explanation and its buttons -- the rest are a list of what is coming, and
   what is behind. */
.gs-card{background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:18px 20px 8px;box-shadow:var(--shadow);margin-bottom:18px}
.gs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.gs-head h3{margin:0;font-size:15.5px}
.gs-head p{margin:3px 0 0;font-size:12px;color:var(--ink-soft)}
.gs-hide{border:0;background:none;color:var(--ink-soft);cursor:pointer;padding:2px;line-height:0;flex:none}
.gs-hide:hover{color:var(--ink)}
.gs-bar{height:4px;border-radius:3px;background:var(--line);margin:13px 0 4px;overflow:hidden}
.gs-bar > span{display:block;height:100%;background:var(--brand);border-radius:3px;
  transition:width .35s ease}
.gs-steps{list-style:none;margin:0;padding:0}
.gs-step{display:flex;gap:11px;padding:11px 0;border-bottom:1px solid var(--line)}
.gs-step:last-child{border-bottom:0}
.gs-tick{flex:none;width:19px;height:19px;border-radius:50%;border:1.5px solid var(--line);
  display:flex;align-items:center;justify-content:center;margin-top:1px;color:#fff}
.gs-step.done .gs-tick{background:var(--brand);border-color:var(--brand)}
.gs-step.done b{color:var(--ink-soft);text-decoration:line-through;font-weight:500}
.gs-step.later b{color:var(--ink-soft)}
.gs-body{min-width:0}
.gs-body b{font-size:13.5px;display:block}
.gs-body p{margin:5px 0 0;font-size:12.5px;color:var(--ink-soft);line-height:1.5;max-width:56ch}
.gs-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}
.gs-acts button{padding:8px 14px;font-size:12.5px;border-radius:9px}

/* The payment panel. Stripe's form sits inside it, so the chrome around it
   is ours: our mark, our card, our page still behind. */
/* Account chooser. Rows, not cards: the question is "which of these", and a
   list answers that faster than a grid of tiles. */
.ac-card{max-width:440px;text-align:left}
.ac-card .wl-brand{justify-content:flex-start}
/* width:100% because the card centres its children, which otherwise leaves
   the rows narrower than the text above them. */
.ac-list{display:flex;flex-direction:column;gap:9px;margin:20px 0 18px;width:100%}
.ac-row{display:flex;align-items:center;gap:13px;width:100%;text-align:left;cursor:pointer;
  background:var(--wl-card);border:1px solid rgba(128,128,128,.28);border-radius:12px;
  padding:13px 14px;color:var(--wl-text);font:inherit}
.ac-row:hover{border-color:var(--wl-accent)}
.ac-mark{flex:none;display:flex;align-items:center;justify-content:center;min-width:34px}
.ac-ini{font:700 13px Inter,sans-serif;letter-spacing:.04em;color:var(--wl-accent);opacity:.85}
.ac-txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.ac-txt b{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac-txt span{font-size:12px;opacity:.7}

.co-scrim{position:fixed;inset:0;z-index:80;background:rgba(18,33,28,.55);backdrop-filter:blur(2px);
  display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;
  overscroll-behavior:contain}
.co-panel{background:var(--card);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.28);
  width:min(560px,100%);padding:18px 18px 22px;margin:auto}
.co-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
/* Flush left with the form below it, rather than inset by the panel's own
   padding on top of it -- the mark was sitting in from the edge twice. */
.co-head > div{display:flex;flex-direction:column;gap:6px;margin-left:-2px}
.co-sub{font-size:12px;color:var(--ink-soft);margin-left:2px}

/* ---- cancelling, in the app ------------------------------------------- */
.cancel-modal{padding:4px 2px}
.cancel-modal h3{font-size:18px;letter-spacing:-.02em;margin:0 0 12px}
.cancel-modal p{font-size:14px;line-height:1.6;color:var(--ink);margin:0 0 12px}
.cancel-modal .cancel-after{font-size:13px;color:var(--ink-soft)}
.cancel-modal .form-actions{margin-top:18px}
.cancel-note{display:flex;align-items:flex-start;gap:9px;margin-top:14px;padding:12px 14px;
  border:1px solid #e6c98f;background:#fffdf6;border-radius:11px;font-size:13.5px;line-height:1.55}
.cancel-note svg{color:var(--amber);flex:none;margin-top:2px}
.co-x{border:0;background:none;color:var(--ink-soft);cursor:pointer;padding:2px;line-height:0;flex:none}
.co-x:hover{color:var(--ink)}
/* Stripe measures its iframe against this, so it needs a height to grow into
   rather than collapsing to nothing before the form loads. */
.co-mount{min-height:460px}
.co-err{margin:0;padding:14px;border-radius:10px;background:#fdf1ef;border:1px solid #e9c4bd;
  color:#8a2f1c;font-size:13.5px}
@media (max-width:560px){
  .co-scrim{padding:0}
  .co-panel{border-radius:0;min-height:100dvh;width:100%}
}

.billing-note{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:60;
  display:flex;align-items:center;gap:12px;background:var(--ink);color:#fff;
  padding:12px 14px 12px 18px;border-radius:12px;font-size:13.5px;box-shadow:var(--shadow);
  max-width:calc(100vw - 32px)}
.billing-note button{border:0;background:none;color:inherit;opacity:.65;cursor:pointer;
  padding:0;line-height:0}
.billing-note button:hover{opacity:1}

.billing-err{margin:0 0 14px;padding:11px 13px;border-radius:10px;background:#fdf1ef;
  border:1px solid #e9c4bd;color:#8a2f1c;font-size:13px}
.billing-manage{display:flex;align-items:center;justify-content:space-between;gap:14px;
  flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:14px 16px;
  margin-bottom:14px;background:var(--card)}
.billing-manage b{font-size:13.5px}
.billing-manage p{margin:3px 0 0;font-size:12px;color:var(--ink-soft)}

.dash-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-bottom:18px}
/* An account that keeps a building list gets a fifth card. Five across on a
   wide screen; on anything narrower the portfolio count takes the full width
   above the others, which reads better than one card marooned next to a gap. */
.dash-grid.g5{grid-template-columns:repeat(5,1fr)}
/* A building owner's row is three: their buildings, what is scheduled, and
   what is still waiting on the account to agree to it. */
.dash-grid.g3{grid-template-columns:repeat(3,1fr)}

/* ---- tenant portal ----
   Deliberately roomier than the rest of the app. Everything else here is a
   working tool somebody uses all day and wants dense; this is a page most
   people will see twice a year, on a phone, while annoyed. */
.tn-main{max-width:660px}
.tn-hello h2{margin:0 0 3px;font-size:22px;font-weight:800;letter-spacing:-.02em}
.tn-hello p{margin:0 0 20px;font-size:13.5px;color:var(--ink-soft)}
.tn-cta{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;
  background:var(--brand);color:#fff;border:0;border-radius:13px;padding:17px;
  font:700 15.5px Inter,sans-serif;cursor:pointer;box-shadow:var(--shadow)}
.tn-cta:hover{background:var(--brand-dk)}
.tn-sent{display:flex;align-items:flex-start;gap:9px;background:#eef6f1;border:1px solid #cfe4d8;
  color:#1d5740;border-radius:11px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.45}
.tn-h3{margin:26px 0 10px;font-size:12.5px;font-weight:800;text-transform:uppercase;
  letter-spacing:.06em;color:var(--ink-soft)}
.tn-list{display:flex;flex-direction:column;gap:9px}
.tn-row{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
  border-radius:12px;padding:14px 15px;box-shadow:var(--shadow)}
.tn-row-main{flex:1;min-width:0}
.tn-row-title{font-size:14.5px;font-weight:700;letter-spacing:-.01em}
.tn-row-meta{display:block;margin-top:3px;font-size:12px;color:var(--ink-soft)}
.tn-chip{flex:none;font-size:11.5px;font-weight:700;padding:5px 10px;border-radius:20px;white-space:nowrap}
.tn-chip.wait{background:#fbf0dd;color:#8a5a12}
.tn-chip.busy{background:#e8eff8;color:#2b4d7a}
.tn-chip.ok{background:#e6f2ec;color:#1d5740}
.tn-form{max-width:none}
/* Eighty things is a lot to put in front of somebody, so it is never all of
   them at once: six areas, or whatever a typed word matches. */
.tn-search{width:100%;margin-top:8px}
.tn-groups{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.tn-group{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:15px 13px;
  font:700 13.5px Inter,sans-serif;color:var(--ink);text-align:left;cursor:pointer;line-height:1.3}
.tn-group:hover{border-color:var(--brand)}
.tn-picks{display:flex;flex-direction:column;gap:7px;margin-top:10px}
.tn-pick{display:flex;flex-direction:column;gap:2px;text-align:left;background:var(--card);
  border:1px solid var(--line);border-radius:11px;padding:12px 13px;cursor:pointer;font-family:inherit}
.tn-pick:hover{border-color:var(--brand)}
.tn-pick-l{font-size:13.5px;font-weight:600;color:var(--ink);line-height:1.35}
.tn-pick-h{font-size:11px;color:var(--ink-soft);line-height:1.3}
.tn-back{background:none;border:0;color:var(--brand);font:600 12.5px Inter,sans-serif;
  padding:9px 0 0;cursor:pointer}
/* What they picked, once they have picked it. */
.tn-chosen{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-top:8px;
  background:#f2f8f5;border:1px solid var(--brand);border-radius:11px;padding:12px 13px}
.tn-chosen span{font-size:13.5px;font-weight:600;line-height:1.35}
.tn-change{flex:none;background:none;border:0;color:var(--brand);font:700 12px Inter,sans-serif;cursor:pointer}
.tn-when{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}

/* ---- tenants, on the manager's side ---- */
.tn-head-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
/* Which way the invite goes. Email is shown ticked and fixed rather than
   hidden, because "how will they hear about this" is the question somebody
   is asking at that moment and an absent control does not answer it. */
.tn-channels{display:flex;flex-direction:column;gap:9px;margin-top:9px}
.tn-channel{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:500;
  color:var(--ink);cursor:pointer}
.tn-channel input{width:16px;height:16px;accent-color:var(--brand);flex:none}
.tn-channel b{font-weight:700;color:var(--ink-soft);font-size:11px;text-transform:uppercase;
  letter-spacing:.05em;margin-left:4px}
.tn-channel.is-fixed{cursor:default}
.tn-channel.is-off{color:var(--ink-soft);cursor:default}
/* Said under the field it is about, while they are still in it. */
.fld-warn{display:block;margin-top:5px;font-size:11.5px;font-weight:600;color:#a8532f}
/* A note under a control rather than beside a label. The .fld wrapping it is
   a label and puts label weight on everything inside; this is a sentence. */
.fld-hint{margin:9px 0 0;font-size:12px;font-weight:400;line-height:1.5;color:var(--ink-soft)}
/* Holds the other half of a row open so a single field keeps a field's
   width instead of running the width of the page. */
.fld-spacer{visibility:hidden}
@media(max-width:640px){ .fld-spacer{display:none} }
.tn-saved{margin:10px 0 0;border-top:1px solid var(--line);padding-top:10px}
.tn-saved p{display:flex;align-items:center;gap:7px;margin:0 0 5px;font-size:12.5px;color:var(--ink-soft)}
.tn-saved svg{color:var(--brand);flex:none}
.tn-problems{margin:8px 0 0;padding-left:18px;line-height:1.6}
.tn-preview{margin-top:10px;border:1px solid var(--line);border-radius:11px;overflow:hidden}
.tn-preview-row{display:flex;justify-content:space-between;gap:12px;padding:9px 12px;
  font-size:12.5px;background:var(--card);border-bottom:1px solid var(--line)}
.tn-preview-row:last-child{border-bottom:0}
.tn-preview-row span{color:var(--ink-soft);text-align:right}
/* The reveal under a password field: a tenant typing on a phone, once, needs
   to be able to see what they typed. */
.tn-reveal,.wl-reveal{background:none;border:0;padding:6px 0 0;cursor:pointer;
  font:600 12px Inter,sans-serif;color:var(--wl-accent,var(--brand))}
@media(max-width:640px){
  .tn-preview-row{flex-direction:column;gap:2px}
  .tn-preview-row span{text-align:left}
}
@media(max-width:560px){
  .tn-groups{grid-template-columns:1fr}
}
.dash-card.prop .dc-num{color:var(--brand)}
.dash-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px;box-shadow:var(--shadow);
  display:flex;flex-direction:column;gap:4px}
.dash-card.accent{border-color:#ecd9b0;background:#fffdf6}
.dc-num{font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.dash-card.accent .dc-num{color:var(--amber)}
.dc-lab{font-size:11.5px;color:var(--ink-soft);font-weight:600;line-height:1.3}
.auto-strip{display:flex;align-items:center;gap:8px;background:#fbf0dd;border:1px solid #ecd9b0;color:#8a5a12;
  font-size:12.5px;font-weight:600;padding:10px 13px;border-radius:10px;margin-bottom:18px}
.dash-sec{margin-bottom:24px}
.dash-sec h3{display:flex;align-items:center;gap:8px;margin:0 0 11px;font-size:14px;font-weight:800;
  text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft)}
.sec-count{background:var(--line);color:var(--ink);font-size:11px;font-weight:800;padding:1px 8px;border-radius:20px}
.sec-count.amber{background:var(--amber);color:#fff}
.dash-sec .job-card{margin-bottom:10px}
.jr-card.past{opacity:.72}
.dash-empty{text-align:center;padding:28px 16px;color:var(--ink-soft);background:var(--card);
  border:1px dashed var(--line);border-radius:12px}
.dash-empty svg{opacity:.5;margin-bottom:8px}
.dash-empty p{margin:0;font-size:13.5px}
.dash-empty-btn{display:inline-flex;align-items:center;gap:7px;margin-top:13px}

/* assign: choose existing vs new */
.assign-choice{display:flex;flex-direction:column;gap:10px;margin-bottom:16px}
.ac-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:3px;
  border:1px solid var(--line);background:var(--card);border-radius:12px;padding:16px 44px 16px 16px;cursor:pointer;text-align:left}
.ac-card:hover:not(:disabled){border-color:var(--brand);background:#f7faf8}
.ac-card:disabled{opacity:.5;cursor:not-allowed}
.ac-card>svg:first-child{color:var(--brand);margin-bottom:5px}
.ac-title{font-size:14.5px;font-weight:700;color:var(--ink)}
.ac-desc{font-size:12px;color:var(--ink-soft);line-height:1.35}
.ac-arrow{position:absolute;right:16px;top:50%;transform:translateY(-50%);color:var(--ink-soft)}

/* segmented sub-tabs (Job Settings) */
.seg-tabs{display:flex;gap:4px;background:var(--paper);border:1px solid var(--line);padding:4px;border-radius:10px;margin:4px 0 16px;width:fit-content}
.seg-tabs button{border:0;background:none;padding:8px 16px;border-radius:7px;font-size:13px;font-weight:700;color:var(--ink-soft);cursor:pointer}
.seg-tabs button.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}

/* documents notices */
.doc-alert{display:flex;align-items:flex-start;gap:10px;background:#faece7;border:1px solid #f0d1c8;color:var(--red);
  font-size:12.5px;line-height:1.45;padding:12px 14px;border-radius:10px;margin:0 0 16px}
.doc-alert svg{flex:none;margin-top:1px}
.doc-alert strong{display:block;color:#8f2f1c}
.doc-ok-banner{display:flex;align-items:center;gap:8px;background:#e8f2ea;border:1px solid #bfe0cb;color:var(--brand);
  font-size:12.5px;font-weight:700;padding:11px 14px;border-radius:10px;margin:0 0 16px}
.count.red{background:var(--red) !important;color:#fff !important}

/* coverage editor */
.cov-sub{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);margin-bottom:4px}
.cov-preview{display:flex;align-items:flex-start;gap:8px;background:var(--paper);border:1px solid var(--line);
  border-radius:9px;padding:11px 13px;margin-top:18px;font-size:12.5px;color:var(--ink);line-height:1.45}
.cov-preview svg{flex:none;margin-top:2px;color:var(--brand)}
.cov-preview em{font-style:normal;color:var(--red);font-weight:600}
.detail-addr{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-soft);margin:0 0 6px}

/* admin dashboard */
.dash-hello{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:18px}
.dash-hello h2{margin:0;font-size:21px;letter-spacing:-.02em}
.dash-hello p{margin:4px 0 0;font-size:13px;color:var(--ink-soft)}
.dash-cta{display:flex;gap:8px;flex:none}
.dash-card{text-align:left;border:1px solid var(--line);cursor:pointer;font-family:inherit}
.dash-card:hover{border-color:var(--brand)}
.dash-card.warn{border-color:#f0d1c8;background:#fdf7f5}
.dash-card.warn .dc-num{color:var(--red)}
.dash-row{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
  border-radius:11px;padding:12px 14px;margin-bottom:8px}
.dash-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dr-title{font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-meta{font-size:11.5px;color:var(--ink-soft)}
.dash-row-btn{flex:none;padding:8px 13px;font-size:12.5px}
.dash-avatar{width:34px;height:34px;border-radius:9px;background:var(--paper);border:1px solid var(--line);
  display:grid;place-items:center;font-size:11.5px;font-weight:800;color:var(--ink-soft);flex:none}
.dash-date{width:40px;flex:none;display:flex;flex-direction:column;align-items:center;background:var(--paper);
  border:1px solid var(--line);border-radius:9px;padding:4px 0}
.dd-mon{font-size:9.5px;font-weight:800;text-transform:uppercase;color:var(--ink-soft)}
.dd-day{font-size:15px;font-weight:800;line-height:1.1}
.dash-more{border:0;background:none;color:var(--brand);font-size:12.5px;font-weight:700;cursor:pointer;padding:6px 2px}
.sec-count.red{background:var(--red);color:#fff}

/* coverage: custom cities + multiple radii */
.add-city-row{display:flex;gap:8px;margin-top:12px}
.add-city-row input{flex:1;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:14px;
  font-family:inherit;color:var(--ink);background:var(--card);min-width:0}
.add-city-row .btn-solid{flex:none;padding:10px 14px}
.radii-edit{display:flex;flex-direction:column;gap:4px}
.radii-edit .radius-row{margin-top:4px}
.radii-list{display:flex;flex-direction:column;gap:8px}

/* job lifecycle */
.form-sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--brand-dk);
  margin:22px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.form-sec:first-of-type{margin-top:8px}
.sec-note{font-size:11.5px;color:var(--ink-soft);margin:-6px 0 10px;font-style:italic}
.job-title-row{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.job-title-row h3{margin:0 !important}
.job-phase{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;
  background:#e9f0f6;color:#2b5c85;padding:3px 8px;border-radius:20px}
.job-phase.done{background:#e8f2ea;color:#1f6b4a}
.job-card.done{background:#fbfcfb}
.job-meas{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
.meas-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;background:var(--paper);
  border:1px solid var(--line);padding:4px 9px;border-radius:6px;color:var(--ink-soft)}
.ta-val{font-size:11.5px;font-weight:700;color:var(--ink)}
.ta-wo-link{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;color:var(--brand);
  background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.ta-signed{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--brand)}
.job-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
  margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.jf-note{font-size:12px;color:var(--ink-soft);flex:1;min-width:140px}
.jf-note.done{display:flex;align-items:center;gap:6px;color:var(--brand);font-weight:600}
.jf-btn{flex:none}
.job-notes{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.job-notes .fld{margin-bottom:0}

/* measurement docs */
.meas-list{display:flex;flex-direction:column;gap:7px;margin-top:8px}
.meas-row{display:flex;align-items:center;gap:9px;background:var(--paper);border:1px solid var(--line);
  border-radius:9px;padding:9px 11px;font-size:12.5px}
.meas-row.view{background:var(--card)}
.meas-name{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meas-dl{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--brand);
  background:none;border:1px solid var(--line);padding:4px 9px;border-radius:6px;cursor:pointer}
.meas-upload{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;font-weight:600;
  color:var(--brand);cursor:pointer;background:var(--card);border:1px dashed var(--brand);
  padding:12px;border-radius:9px;margin-top:2px}

/* work order document */
.wo-inherit{display:flex;align-items:flex-start;gap:9px;background:var(--paper);border:1px solid var(--line);
  border-radius:9px;padding:11px 13px;margin-bottom:16px;font-size:12px;color:var(--ink-soft);line-height:1.45}
.wo-inherit svg{flex:none;margin-top:1px;color:var(--brand)}
.wo-inherit strong{color:var(--ink)}
.wo-doc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;
  padding-bottom:16px;margin-bottom:16px;border-bottom:2px solid var(--ink)}
.wdh-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-soft)}
.wo-doc-head h2{margin:2px 0 0;font-size:24px;letter-spacing:-.02em}
.wdh-sub{margin:3px 0 0;font-size:12.5px;color:var(--ink-soft)}
.wo-doc-sec{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
  color:var(--brand-dk);margin:20px 0 9px}
.wo-doc-grid{display:flex;flex-direction:column;gap:0}
.wd-row{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
.wd-row span{color:var(--ink-soft)}
.wd-row strong{text-align:right;font-weight:600}
.wo-doc-scope{font-size:13px;line-height:1.55;color:var(--ink);background:var(--paper);
  border:1px solid var(--line);border-radius:9px;padding:12px 14px;margin:0;white-space:pre-wrap}
.wo-value{font-size:22px;font-weight:800;letter-spacing:-.02em;color:var(--brand)}
.wo-value span{font-size:12px;font-weight:600;color:var(--ink-soft);margin-left:7px;letter-spacing:0}
.wo-open-btn{display:flex;align-items:center;gap:7px;width:100%;background:var(--paper);border:1px solid var(--line);
  border-radius:9px;padding:11px 13px;font-size:12.5px;font-weight:700;color:var(--brand);cursor:pointer;margin-top:12px}
.wo-open-btn:hover{border-color:var(--brand)}
.wo-open-meas{margin-left:auto;font-size:11px;font-weight:600;color:var(--ink-soft)}

/* ---- white label branding ---- */
/* width:max-content because the wrapper otherwise sizes to the mark's text
   content and ignores its padding and min-width -- a 34px square inside a
   13px box, overlapping whatever sits next to it. */
.brand-logo{display:flex;align-items:center;color:var(--ink);flex:none;width:max-content}
.brand-logo.sm{color:var(--ink)}
.brand-logo.lg,.brand-logo.xl{color:var(--ink)}
.brand-initials{display:grid;place-items:center;background:var(--brand);color:#fff;border-radius:8px;
  font-size:12px;font-weight:800;padding:0 8px;letter-spacing:.02em}
.brand-txt{display:flex;flex-direction:column;min-width:0}
.brand-name{font-size:17px;font-weight:700;letter-spacing:-.02em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brand-url{margin-top:1px;font-size:11.5px;font-weight:400;color:var(--ink-soft);
  font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
  max-width:1160px;margin:0 auto;padding:18px 24px 28px;font-size:11.5px;color:var(--ink-soft);
  border-top:1px solid var(--line)}
.ss-foot-by{opacity:.75}
.login-logo-wrap{display:flex;align-items:center;justify-content:center;color:var(--ink);margin-bottom:14px;min-height:40px}
.login-foot{display:flex;flex-direction:column;align-items:center;gap:5px}

/* ===== white-label pages (sign-in + public signup) ===== */
.wl-themed{background:var(--wl-bg) !important;color:var(--wl-text) !important}
.wl-themed .login-card{background:var(--wl-surface) !important;color:var(--wl-text) !important}
.wl-themed .login-card h1,.wl-themed .login-card h2{color:var(--wl-text) !important}
.wl-themed .btn-solid,.wl-themed .login-btn{background:var(--wl-accent) !important;color:var(--wl-btn-text) !important}
.login-signup{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;
  margin-top:16px;padding:14px 16px;border-radius:10px;border:1px solid var(--line);
  background:var(--paper);font-family:inherit;cursor:pointer;text-align:left}
.login-signup > span{font-size:12px;color:var(--ink-soft)}
.login-signup b{font-size:14.5px;font-weight:700;color:var(--wl-accent,var(--brand))}
.login-signup:hover{border-color:var(--wl-accent,var(--brand));background:var(--card)}
.wl-themed .login-signup{background:transparent;border-color:rgba(128,128,128,.32)}
.wl-themed .login-signup > span{color:var(--wl-text);opacity:.65}
.wl-themed .login-signup b{color:var(--wl-accent)}

.wl-page{min-height:100vh;background:var(--wl-bg);color:var(--wl-text);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:40px 20px;font-family:inherit}
.wl-card{width:100%;max-width:560px;background:var(--wl-surface);border-radius:14px;
  padding:34px;box-shadow:0 18px 50px rgba(0,0,0,.12)}
.wl-brand{display:flex;align-items:center;gap:11px;margin-bottom:22px}
.wl-brand-name{font-size:17px;font-weight:700;letter-spacing:-.02em;color:var(--wl-text)}
.wl-card h1{font-size:25px;letter-spacing:-.03em;margin:0;color:var(--wl-text)}
.wl-lede{font-size:15px;opacity:.72;margin-top:9px;line-height:1.5}
.wl-steps{display:flex;gap:7px;margin:22px 0 20px;flex-wrap:wrap}
.wl-step{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;
  padding:6px 11px;border-radius:20px;border:1px solid currentColor;opacity:.45}
.wl-step.on{opacity:1;background:var(--wl-accent);color:var(--wl-btn-text);border-color:var(--wl-accent)}
.wl-step.done{opacity:.85}
.wl-fld{display:block;margin-bottom:14px;font-size:13.5px;font-weight:600}
.wl-fld input,.wl-fld select{display:block;width:100%;margin-top:6px;padding:13px 14px;
  border:1px solid rgba(128,128,128,.35);border-radius:9px;font:400 16px inherit;
  background:var(--wl-surface);color:var(--wl-text)}
.wl-fld input:focus,.wl-fld select:focus{outline:2px solid var(--wl-accent);outline-offset:-1px}
.wl-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.wl-label{font-size:13.5px;font-weight:600;margin:4px 0 9px}
.wl-picks{display:flex;flex-wrap:wrap;gap:7px}
.wl-pick{border:1px solid rgba(128,128,128,.35);background:none;color:var(--wl-text);
  border-radius:20px;padding:8px 13px;font:500 13px inherit;cursor:pointer}
.wl-pick.on{background:var(--wl-accent);color:var(--wl-btn-text);border-color:var(--wl-accent);font-weight:600}
.wl-checks{display:flex;gap:9px;flex-wrap:wrap}
.wl-check{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(128,128,128,.35);
  border-radius:9px;padding:12px 15px;font-size:14px;font-weight:600;cursor:pointer}
.wl-check.on{border-color:var(--wl-accent)}
.wl-check input{accent-color:var(--wl-accent);width:16px;height:16px;margin:0}
.wl-summary{margin-top:18px;border:1px solid rgba(128,128,128,.25);border-radius:10px;overflow:hidden}
.wl-summary div{display:flex;justify-content:space-between;gap:14px;padding:11px 14px;font-size:13.5px;
  border-bottom:1px solid rgba(128,128,128,.18)}
.wl-summary div:last-child{border-bottom:0}
.wl-summary span{opacity:.65}
.wl-summary b{text-align:right;font-weight:600}
.wl-actions{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:24px;flex-wrap:wrap}
.wl-btn{background:var(--wl-accent);color:var(--wl-btn-text);border:0;border-radius:9px;
  padding:14px 22px;font:700 15px inherit;cursor:pointer}
.wl-btn:disabled{opacity:.45;cursor:not-allowed}
.wl-btn-ghost{background:none;border:1px solid rgba(128,128,128,.4);color:var(--wl-text);
  border-radius:9px;padding:13px 18px;font:600 14px inherit;cursor:pointer}
.wl-fine{font-size:12.5px;opacity:.6;line-height:1.5;margin-top:10px}
.wl-err{font-size:12.5px;color:#b1391f;margin-top:10px;font-weight:600}
.wl-foot{margin-top:20px;font-size:12px;opacity:.5}
.wl-done{text-align:center}
.wl-done .wl-brand{justify-content:center}
.wl-tick{color:var(--wl-accent);margin:6px 0 14px;display:flex;justify-content:center}
/* A dead link is not a success, so the tick's colour would be a lie. */
.wl-tick.warn{color:#b5442e}
/* Lead-in under the heading on the tenant sign-up, and the "optional" tag
   that keeps somebody from hunting for their unit number. */
.wl-sub{margin:0 0 18px;font-size:13.5px;line-height:1.5;color:var(--wl-text);opacity:.8}
.wl-opt{font-weight:500;font-size:11px;opacity:.6;margin-left:6px}
.wl-done p{font-size:15px;opacity:.78;line-height:1.55;margin-top:10px}
.wl-done .wl-btn{margin-top:22px}
@media (max-width:560px){
  .wl-card{padding:24px 20px}
  .wl-row{grid-template-columns:1fr}
  .wl-actions{flex-direction:column-reverse;align-items:stretch}
  .wl-actions button{width:100%}
}

/* ===== theme editor ===== */
.theme-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}
.theme-row{display:flex;flex-direction:column;gap:6px}
.theme-label{font-size:12.5px;font-weight:600;color:var(--ink)}
.theme-input{display:flex;align-items:center;gap:8px;border:1px solid var(--line);
  border-radius:8px;padding:6px 8px;background:var(--card)}
.theme-input input[type="color"]{width:30px;height:30px;border:0;padding:0;background:none;cursor:pointer;flex:none}
.theme-hex{border:0;background:none;font:500 13px ui-monospace,monospace;color:var(--ink);
  width:100%;min-width:0;text-transform:uppercase;outline:none}
.theme-preview{margin-top:16px;border:1px solid var(--line);border-radius:11px;overflow:hidden}
.tp-bar{background:var(--paper);border-bottom:1px solid var(--line);padding:8px 12px;
  font-size:11.5px;color:var(--ink-soft)}
.tp-body{background:var(--wl-bg);padding:22px}
.tp-card{background:var(--wl-surface);color:var(--wl-text);border-radius:10px;padding:18px;
  box-shadow:0 8px 22px rgba(0,0,0,.10)}
.tp-brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin-bottom:12px}
.tp-h{font-size:16px;font-weight:700;letter-spacing:-.02em}
.tp-p{font-size:12.5px;opacity:.7;margin-top:5px;line-height:1.45}
.tp-field{height:32px;border:1px solid rgba(128,128,128,.3);border-radius:7px;margin-top:10px}
.tp-btn{margin-top:14px;background:var(--wl-accent);color:var(--wl-btn-text);border-radius:8px;
  padding:11px 16px;font-size:13.5px;font-weight:700;text-align:center}
.theme-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-top:14px;flex-wrap:wrap}
.theme-link{font-size:13px;font-weight:600;color:var(--brand);text-decoration:underline;text-underline-offset:2px}
@media (max-width:640px){.theme-grid{grid-template-columns:1fr}}

/* "Powered by" + SubSub logo on the white-labeled sign-in / sign-up pages */
.powered-by{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;
  letter-spacing:.01em;opacity:.7;text-decoration:none;color:inherit;cursor:pointer;
  transition:opacity .12s;
  /* The text is 13px tall and a fingertip is not. The padding makes the tap
     target reachable on a phone; the matching negative margin means adding
     it moved nothing on the page. */
  padding:7px 4px;margin:-7px -4px}
.powered-by:hover,.powered-by:focus-visible{opacity:1;text-decoration:none}
.powered-by:focus-visible{outline:2px solid var(--brand);outline-offset:1px;border-radius:5px}
.powered-by > span{white-space:nowrap}
.powered-by .ss-logo{position:relative;top:.5px}
.wl-foot.powered-by{margin-top:20px;opacity:.6;color:var(--wl-text)}
.login-foot .powered-by{opacity:.75}
.bp-foot .powered-by{opacity:.85;font-size:10.5px}

/* contractor: who they work for */
.dash-hello .who-bar{margin-bottom:0;flex:none}
.who-bar{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
  border-radius:12px;padding:13px 16px;margin-bottom:16px;box-shadow:var(--shadow)}
.who-txt{display:flex;flex-direction:column;min-width:0}
.who-me{font-size:14.5px;font-weight:700;letter-spacing:-.01em}
.who-for{font-size:11.5px;color:var(--ink-soft);font-weight:600}

/* brand settings */
/* Profile and Company were capped at 620px while Subscription, Users and
   every other pane used the page, so two of the five screens behind the same
   tab were a narrow column and the rest were not. The cap is gone; the
   fields inside already collapse to one column on a narrow screen. */
.settings-panel{max-width:none}
/* Each of these is a separate decision -- what kind of account this is, which
   trades it hires, what its contractors see -- so they need the gap that says
   so. Set on the panel rather than at each render site, where half of them
   were carrying it inline and half were not. */
.settings-panel + .settings-panel{margin-top:18px}
/* Said where the link to the live form would be, when there is no live form
   to link to yet. */
.theme-note{font-size:12.5px;color:var(--ink-soft);text-align:right}
.theme-link{display:inline-flex;align-items:center;gap:5px}
.pc-renew{display:block;margin-top:5px;font-size:12.5px;color:var(--ink-soft)}
.pc-renew.warn{color:#8a2f1c;font-weight:600}
.pc-renew.comp{color:#8a5a12;font-weight:600}
.brand-preview{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:14px 0 4px;background:var(--card)}
.bp-chrome{display:flex;align-items:center;gap:6px;background:var(--paper);border-bottom:1px solid var(--line);padding:9px 12px}
.bp-dot{width:8px;height:8px;border-radius:50%;background:var(--line)}
.bp-url{margin-left:8px;font-size:11.5px;color:var(--ink-soft);font-weight:600;
  background:var(--card);border:1px solid var(--line);border-radius:20px;padding:3px 12px}
.bp-body{display:flex;align-items:center;gap:14px;padding:20px 18px}
.bp-name{font-size:16px;font-weight:700;letter-spacing:-.02em}
.bp-sub{font-size:12px;color:var(--ink-soft)}
.bp-foot{border-top:1px solid var(--line);padding:9px 18px;font-size:10.5px;color:var(--ink-soft);
  text-align:right;font-weight:600}
.subdomain-row{display:flex;align-items:center;gap:0;margin-top:6px}
.subdomain-row input{border-radius:9px 0 0 9px;margin-top:0;border-right:0}
.sd-suffix{background:var(--paper);border:1px solid var(--line);border-left:0;border-radius:0 9px 9px 0;
  padding:10px 12px;font-size:13.5px;color:var(--ink-soft);font-weight:600;white-space:nowrap}
.logo-opts{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px}
.logo-current{display:flex;flex-direction:column;gap:8px;background:var(--paper);border:1px solid var(--line);
  border-radius:11px;padding:16px 18px;min-width:190px}
.lc-label{font-size:11px;color:var(--ink-soft);font-weight:600}
.logo-actions{display:flex;flex-direction:column;gap:7px;flex:1;min-width:150px}
.logo-actions .dm-upload,.logo-actions .dm-delete,.logo-actions .dm-replace{justify-content:center}

/* logo mark editing (My account) */
.mark-row{display:flex;align-items:center;gap:13px;background:var(--paper);border:1px solid var(--line);
  border-radius:11px;padding:13px 14px;margin-top:8px;flex-wrap:wrap}
.mark-preview{display:flex;align-items:center;justify-content:center;min-width:46px;min-height:38px;
  background:var(--card);border:1px solid var(--line);border-radius:9px;padding:6px 10px;color:var(--ink);flex:none}
.mark-meta{flex:1;min-width:90px;display:flex;flex-direction:column}
.mark-name{font-size:14px;font-weight:700;letter-spacing:-.01em}
.mark-hint{font-size:11px;color:var(--ink-soft);font-weight:600}
.mark-actions{display:flex;gap:6px;flex:none}
.brand-save{margin-bottom:14px}

/* log in as (users tab) */
.login-as-btn{display:flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--card);
  color:var(--brand);font-size:12.5px;font-weight:700;padding:6px 11px;border-radius:8px;cursor:pointer;flex:none}
.login-as-btn:hover{background:#eef5f1;border-color:var(--brand)}

/* calendar: per-day docs prompt */
.cal-grid .cal-cell.needdocs{background:#fbf0dd;box-shadow:inset 0 0 0 1px #ecd9b0;cursor:pointer}
.cal-grid .cal-cell.needdocs:hover{background:#f6dfb4;box-shadow:inset 0 0 0 2px var(--amber)}
.cal-doc{display:grid;place-items:center;color:#a86a18;opacity:.75}
.cal-cell.needdocs:hover .cal-doc{opacity:1}
.lg.needdocs{background:var(--amber)}

/* subscription plans */
.plan-current{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;
  background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;
  margin-bottom:14px;box-shadow:var(--shadow)}
.pc-label{display:block;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft)}
.pc-name{font-size:20px;font-weight:800;letter-spacing:-.02em}
.pc-usage{font-size:12.5px;color:var(--ink-soft);display:flex;flex-direction:column;gap:3px;text-align:right}
.pc-usage strong{font-size:16px;color:var(--ink)}
.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:4px}
.plan-card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:20px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow)}
.plan-card.on{border-color:var(--brand);background:#f7faf8}
.plan-badge{position:absolute;top:14px;right:14px;font-size:10px;font-weight:800;text-transform:uppercase;
  background:var(--brand);color:#fff;padding:3px 9px;border-radius:20px}
.plan-name{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft)}
.plan-price{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1}
.plan-price span{font-size:13px;font-weight:600;color:var(--ink-soft);letter-spacing:0}
.plan-feats{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:7px;flex:1}
.plan-feats li{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;color:var(--ink-soft);line-height:1.4}
.plan-feats svg{flex:none;margin-top:2px;color:var(--brand)}
.plan-feats li.feat-off{color:#A9B3AD}
.plan-feats li.feat-off svg{color:#A9B3AD}
.plan-btn{width:100%;justify-content:center;margin-top:6px}
.usage-panel{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:18px;margin-top:14px;box-shadow:var(--shadow)}
.usage-panel h4{margin:0 0 10px;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand-dk)}
.usage-rows{display:flex;flex-direction:column}
.stat.earn{color:var(--brand);font-weight:700}

/* uniforms */
.uni-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:11px;margin-top:10px}
.uni-card{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:13px;
  display:flex;flex-direction:column;gap:4px}
.uni-card.on{border-color:var(--brand);background:#f7faf8}
.uni-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.uni-name{font-size:13.5px;font-weight:700}
.uni-safety{font-size:9.5px;font-weight:800;text-transform:uppercase;background:#fbf0dd;color:#8a5a12;
  padding:2px 7px;border-radius:20px}
.uni-note{font-size:11px;color:var(--ink-soft)}
.uni-controls{display:flex;align-items:center;gap:8px;margin-top:8px}
.uni-controls select{flex:1;border:1px solid var(--line);border-radius:7px;padding:6px 8px;
  font-size:12.5px;font-family:inherit;background:var(--card);color:var(--ink);min-width:0}
.uni-qty{display:flex;align-items:center;gap:0;border:1px solid var(--line);border-radius:7px;overflow:hidden;flex:none}
.uni-qty button{border:0;background:var(--paper);width:26px;height:28px;font-size:15px;font-weight:700;
  color:var(--ink);cursor:pointer;line-height:1}
.uni-qty button:disabled{opacity:.4;cursor:not-allowed}
.uni-qty span{min-width:26px;text-align:center;font-size:13px;font-weight:700}
.uni-order{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
  border-radius:11px;padding:12px 14px;margin-bottom:8px}
.uni-order.admin{align-items:flex-start}
.uo-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.uo-co{font-size:14px;font-weight:700}
.uo-items{font-size:12.5px;color:var(--ink);font-weight:600}
.uo-note{font-size:11.5px;color:var(--ink-soft);font-style:italic}
.uo-date{font-size:11px;color:var(--ink-soft)}
.seg-tabs.sm button{padding:7px 12px;font-size:12.5px}
.seg-n{font-size:10.5px;font-weight:800;opacity:.6;margin-left:3px}

/* filter bar: collapse/expand + sort */
.filter-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.filter-toggle{display:flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;padding:9px 13px;font-size:13px;font-weight:700;color:var(--ink);cursor:pointer}
.filter-toggle:hover{border-color:var(--brand)}
.ft-count{background:var(--brand);color:#fff;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:20px}
.ft-chev{transition:transform .15s;color:var(--ink-soft)}
.ft-chev.open{transform:rotate(180deg)}
.sort-ctl{display:flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;padding:0 11px;color:var(--ink-soft)}
.sort-ctl select{border:0;background:none;padding:9px 0;font-size:13px;font-weight:600;color:var(--ink);
  font-family:inherit;cursor:pointer;outline:none;max-width:190px}
.filters{padding-bottom:4px}

/* plan notice spacing */
.plan-notice{margin-top:18px;margin-bottom:4px}

/* crew-based availability */
.crew-picker{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}
.cp-btn{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:var(--card);
  border:1px solid var(--line);border-radius:10px;padding:10px 14px;cursor:pointer;text-align:left;min-width:132px}
.cp-btn:hover{border-color:var(--brand)}
.cp-btn.on{border-color:var(--brand);background:#f2f8f4}
.cp-btn.paused{opacity:.7}
.cp-btn.paused .cp-meta{color:var(--red)}
.cp-btn.all{background:var(--paper)}
.cp-name{font-size:13.5px;font-weight:700;color:var(--ink)}
.cp-meta{font-size:10.5px;color:var(--ink-soft);font-weight:600}
.crew-switch-row{margin-bottom:14px}
.crew-switch-row .avail-switch{width:100%;justify-content:center}
.cal-crews{font-size:11px;font-weight:800;color:#1f6b4a;opacity:.65}
.cal-cell.clickable:hover .cal-crews{opacity:1}
.cc-note{display:block;font-size:9.5px;font-weight:600;color:var(--ink-soft);text-transform:none;letter-spacing:0}

/* all-crews overview grid */
.all-crew-grid{display:grid;grid-template-columns:110px repeat(14,1fr);gap:3px;margin-top:12px}
.acg-head{font-size:10.5px;font-weight:800;text-transform:uppercase;color:var(--ink-soft);
  display:flex;align-items:flex-end;padding-bottom:4px}
.acg-day{display:flex;flex-direction:column;align-items:center;font-size:10px}
.acg-day .dow{color:var(--ink-soft)}
.acg-day .dom{font-weight:700;font-size:11.5px}
.acg-name{font-size:11.5px;font-weight:600;display:flex;align-items:center;padding:6px 0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:1px solid var(--line)}
.acg-cell{min-height:26px;border-radius:4px;border-top:1px solid var(--line);margin-top:-1px}
.acg-cell.up{background:#e2f0e7}
.acg-cell.down{background:#f7e5df}
.acg-cell.booked{background:#dbe8f2}

/* notification preferences */
.notify-opts{display:flex;flex-direction:column;gap:9px;margin-top:10px}
.notify-opts.compact{flex-direction:row;gap:8px;margin-top:8px}
.notify-opt{display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);
  border-radius:11px;padding:13px 15px;cursor:pointer}
.notify-opts.compact .notify-opt{flex:1;padding:10px 12px;gap:8px}
.notify-opt:hover{border-color:var(--brand)}
.notify-opt.on{border-color:var(--brand);background:#f2f8f4}
.notify-opt input{accent-color:var(--brand);width:17px;height:17px;flex:none}
.notify-opt>svg{color:var(--ink-soft);flex:none}
.notify-opt.on>svg{color:var(--brand)}
.no-txt{display:flex;flex-direction:column;min-width:0}
.no-name{font-size:13.5px;font-weight:700;color:var(--ink)}
.no-sub{font-size:11px;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notify-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
  background:var(--paper);border:1px solid var(--line);color:var(--ink-soft);padding:3px 9px;border-radius:20px}
.notify-note{display:flex;align-items:flex-start;gap:8px;background:var(--paper);border:1px solid var(--line);
  border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--ink-soft);line-height:1.45}
.notify-note svg{flex:none;margin-top:1px}

/* notification previews */
.msg-preview{border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--card);margin-bottom:4px}
.mp-head{display:flex;gap:10px;align-items:baseline;background:var(--paper);border-bottom:1px solid var(--line);padding:10px 13px}
.mp-head span{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);flex:none}
.mp-head strong{font-size:12.5px;font-weight:700;color:var(--ink)}
.mp-body{margin:0;padding:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  line-height:1.6;color:var(--ink);white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto}
.sms-bubble{background:#e2f0e7;border:1px solid #cfe0d6;border-radius:14px 14px 14px 4px;padding:12px 14px;
  font-size:13px;line-height:1.5;color:var(--ink);max-width:340px;word-break:break-word}
.no-tag{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;background:var(--brand);
  color:#fff;padding:2px 6px;border-radius:20px;margin-left:6px;vertical-align:1px}
.notify-opt.disabled{opacity:.5;cursor:not-allowed}
.fld-err{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--red);font-weight:600;margin:8px 0 0}

/* upgrade gate — left aligned, the delta table carries the argument */
.up-form{gap:0}
.up-top{margin-bottom:20px}
.up-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;
  text-transform:uppercase;letter-spacing:.05em;background:#fbf0dd;color:#8a5a12;
  padding:5px 10px;border-radius:20px;margin-bottom:12px}
.up-form h2{font-size:23px;letter-spacing:-.03em;margin:0}
.up-sub{margin-top:8px;font-size:14.5px;color:var(--ink-soft);line-height:1.5;max-width:46ch}

.up-gets{font-size:14px;color:var(--ink-soft);line-height:1.55;background:var(--paper);
  border:1px solid var(--line);border-radius:10px;padding:13px 15px;margin-top:16px}
.up-gets strong{color:var(--ink);font-weight:700}
.up-cycle{margin-top:16px;width:100%}
.up-cycle button{flex:1;justify-content:center}

.up-buy{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  margin-top:18px;padding:16px 18px;background:#f2f8f4;border:1px solid #d4e7db;border-radius:11px}
.up-price-block{display:flex;flex-direction:column}
.up-amt{font-family:inherit;font-size:27px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--ink)}
.up-amt em{font-style:normal;font-size:14px;font-weight:600;letter-spacing:0;color:var(--ink-soft)}
.up-terms{font-size:12px;color:var(--ink-soft);margin-top:5px}
.up-go{flex:none;padding:14px 22px;font-size:15.5px}

.up-stay{display:block;width:100%;border:0;background:none;color:var(--ink-soft);
  font:600 13.5px Inter,sans-serif;padding:16px 0 2px;cursor:pointer;text-align:center}
.up-stay:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}

.plan-pill{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;
  background:var(--line);color:var(--ink-soft);padding:2px 7px;border-radius:20px}
.plan-pill.scale{background:#fbf0dd;color:#8a5a12}

/* document review */
.rv-file{display:flex;align-items:center;gap:13px;background:var(--paper);border:1px solid var(--line);
  border-radius:11px;padding:14px 16px;margin-bottom:16px;flex-wrap:wrap}
.rv-file>svg{color:var(--brand);flex:none}
.rv-file-main{flex:1;min-width:130px;display:flex;flex-direction:column}
.rv-name{font-size:13.5px;font-weight:700;word-break:break-all}
.rv-meta{font-size:11px;color:var(--ink-soft)}
.rv-file-actions{display:flex;gap:7px;flex:none}
.rv-btn{padding:8px 12px;font-size:12.5px;display:flex;align-items:center;gap:5px}
.rv-checks{display:flex;flex-direction:column;gap:8px}
.rv-check{display:flex;align-items:flex-start;gap:10px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;padding:12px 14px;cursor:pointer;font-size:13px;line-height:1.4}
.rv-check:hover{border-color:var(--brand)}
.rv-check.on{border-color:var(--brand);background:#f2f8f4}
.rv-check input{accent-color:var(--brand);width:17px;height:17px;flex:none;margin-top:1px}
.rv-close{display:block;width:100%;border:0;background:none;color:var(--ink-soft);font-size:12px;
  font-weight:600;padding:12px 0 0;cursor:pointer;text-align:center}
.rv-close:hover{color:var(--ink)}

/* document status chips */
.doc-state{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;margin-top:3px;line-height:1.35}
.doc-state.s-verified{color:var(--brand)}
.doc-state.s-pending{color:var(--amber)}
.doc-state.s-rejected{color:var(--red)}
.doc-state.s-missing{color:var(--ink-soft)}
.doc-row.st-doc-verified{background:#f2f8f4;border-color:#d4e7db}
.doc-row.st-doc-pending{background:#fffdf6;border-color:#ecd9b0}
.doc-row.st-doc-rejected{background:#fbf1ed;border-color:#f0d9d1}
.doc-row.st-doc-missing{background:var(--card)}
.doc-manage-row.st-doc-verified{background:#f2f8f4;border-color:#d4e7db}
.doc-manage-row.st-doc-pending{background:#fffdf6;border-color:#ecd9b0}
.doc-manage-row.st-doc-rejected{background:#fbf1ed;border-color:#f0d9d1}
.doc-review{display:flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--card);
  color:var(--ink);font-size:12px;font-weight:700;padding:7px 12px;border-radius:8px;cursor:pointer;flex:none}
.doc-review:hover{border-color:var(--brand);color:var(--brand)}
.doc-review.urgent{background:var(--amber);border-color:var(--amber);color:#fff}
.doc-review.urgent:hover{background:#a86a18;color:#fff}

/* coverage schedule review */
.cov-table{display:flex;flex-direction:column;gap:7px}
.cov-line{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;padding:10px 13px}
.cov-line.ok{border-color:#cfe0d6;background:#f7faf8}
.cov-line.short{border-color:#f0d1c8;background:#fbf1ed}
.cl-label{flex:1;min-width:0;display:flex;flex-direction:column}
.cl-name{font-size:13px;font-weight:700;color:var(--ink)}
.cl-opt{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  background:var(--paper);border:1px solid var(--line);color:var(--ink-soft);padding:1px 6px;border-radius:20px;margin-left:7px}
.cl-req{font-size:10.5px;color:var(--ink-soft)}
.cl-input{display:flex;align-items:center;gap:7px;flex:none;width:150px}
.cl-input input{margin-top:0;width:100%;font-size:13.5px;padding:8px 10px}
.cl-ok{color:var(--brand);flex:none}
.cl-bad{color:var(--red);flex:none}

/* requirements reference (contractor side) */
.req-box{border:1px solid var(--line);border-radius:11px;background:var(--paper);margin-bottom:16px}
.req-box summary{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;
  font-size:13px;font-weight:700;color:var(--ink);list-style:none}
.req-box summary::-webkit-details-marker{display:none}
.req-box summary svg{color:var(--brand)}
.req-body{padding:0 14px 14px;border-top:1px solid var(--line)}
.req-sec{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;
  color:var(--brand-dk);margin:14px 0 7px}
.req-table{width:100%;border-collapse:collapse;font-size:12.5px}
.req-table td{padding:5px 0;border-bottom:1px solid var(--line);color:var(--ink-soft)}
.req-table td:first-child{color:var(--ink)}
.rt-sub{color:var(--ink-soft);font-size:11px}
.rt-amt{text-align:right;font-weight:700;color:var(--ink) !important;white-space:nowrap}
.req-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
.req-list li{display:flex;align-items:flex-start;gap:6px;font-size:12px;color:var(--ink-soft);line-height:1.4}
.req-list svg{flex:none;margin-top:2px;color:var(--brand)}
.req-note{font-size:12px;color:var(--ink-soft);margin:0;line-height:1.45}

/* coverage overrides */
.cov-line{flex-direction:column;align-items:stretch;gap:0}
.cov-line-top{display:flex;align-items:center;gap:12px}
.cov-line.waived{border-color:#cdd9e6;background:#f6f9fc}
.cl-waived{color:#2b5c85;flex:none}
.cl-override{border-top:1px dashed var(--line);margin-top:10px;padding-top:10px}
.cl-override.standalone{border-top:0;margin-top:8px;padding-top:0}
.cl-ovr-toggle{display:flex;align-items:flex-start;gap:8px;font-size:12px;font-weight:600;
  color:var(--ink);cursor:pointer;line-height:1.4}
.cl-ovr-toggle input{accent-color:#2b5c85;width:15px;height:15px;flex:none;margin-top:1px}
.cl-ovr-reason{width:100%;margin-top:8px;border:1px solid #cdd9e6;border-radius:8px;padding:8px 11px;
  font-size:12.5px;font-family:inherit;color:var(--ink);background:var(--card)}
.ovr-summary{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#2b5c85;font-weight:600;
  background:#f0f5fa;border:1px solid #cdd9e6;border-radius:8px;padding:9px 11px;margin:10px 0 0}
.doc-waived{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#2b5c85;
  background:#eaf0f6;border:1px solid #cdd9e6;padding:3px 8px;border-radius:20px;flex:none;cursor:help}

/* WA license verification */
.lic-card{display:flex;align-items:flex-start;gap:12px;border:1px solid var(--line);border-radius:11px;
  padding:14px 16px;background:var(--card);flex-wrap:wrap}
.lic-card.ok{background:#f2f8f4;border-color:#d4e7db}
.lic-card.ok>svg{color:var(--brand);flex:none;margin-top:1px}
.lic-card.bad{background:#fbf1ed;border-color:#f0d9d1}
.lic-card.bad>svg{color:var(--red);flex:none;margin-top:1px}
.lic-card.none{background:var(--paper)}
.lic-card.none>svg{color:var(--ink-soft);flex:none;margin-top:1px}
.lic-main{flex:1;min-width:150px;display:flex;flex-direction:column;gap:2px}
.lic-num{font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lic-status{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:20px}
.lic-status.s-active{background:#e8f2ea;color:#1f6b4a}
.lic-status.s-expired,.lic-status.s-suspended,.lic-status.s-revoked{background:#faece7;color:var(--red)}
.lic-status.s-unknown{background:var(--line);color:var(--ink-soft)}
.lic-meta{font-size:11.5px;color:var(--ink-soft);line-height:1.4}
.lic-state{font-size:11px;color:var(--ink-soft);font-style:italic;margin-top:2px}
.lic-actions{display:flex;align-items:center;gap:8px;flex:none}
.lic-link{font-size:11.5px;font-weight:700;color:var(--brand);text-decoration:underline;text-underline-offset:2px;white-space:nowrap}

/* billing cycle */
/* The billing toggle sat 6px above the plan cards, which read as though it
   belonged to them rather than to the panel above. Give it room on both
   sides so it is clearly its own control. */
.cycle-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:22px 0 18px}
.cycle{display:inline-flex;gap:4px;background:var(--paper);border:1px solid var(--line);
  padding:4px;border-radius:10px}
.cycle button{appearance:none;border:0;background:none;font:600 13.5px Inter,sans-serif;
  color:var(--ink-soft);padding:9px 14px;border-radius:7px;cursor:pointer;
  display:flex;align-items:center;gap:7px}
.cycle button[aria-selected="true"]{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.cy-save{font-size:10px;font-weight:800;background:#e8f2ea;color:#1f6b4a;padding:2px 7px;border-radius:20px}
.cycle button[aria-selected="true"] .cy-save{background:var(--amber);color:#fff}
.cycle-note{font-size:12.5px;color:var(--brand);font-weight:600}
.plan-bill{font-size:11.5px;color:var(--ink-soft);margin-top:6px;display:block}
.pc-cycle{display:block;font-size:12px;color:var(--ink-soft);margin-top:2px}

/* response deadlines */
.ddl{display:flex;align-items:flex-start;gap:9px;border-radius:9px;padding:11px 13px;
  margin-top:12px;font-size:13px;line-height:1.45;border:1px solid}
.ddl svg{flex:none;margin-top:1px}
.ddl b{font-weight:700}
.ddl-ok{background:#f2f8f4;border-color:#d4e7db;color:var(--brand-dk)}
.ddl-today{background:#fffdf6;border-color:#ecd9b0;color:#8a5a12}
.ddl-soon{background:#fbf2e4;border-color:#e6c98f;color:#8a5a12}
.ddl-expired{background:#fbf1ed;border-color:#f0d9d1;color:var(--red)}
.ddl-when{opacity:.8;margin-left:5px}
.ddl-chip{display:inline-flex;align-items:center;gap:5px}
.ddl-chip.u-soon{background:#f6dfb4;color:#7a4e0c}
.ddl-chip.u-expired{background:#faece7;color:var(--red)}
.st-expired{display:inline-flex;align-items:center;gap:5px;background:#faece7;color:var(--red);
  font-size:11px;font-weight:700;padding:4px 9px;border-radius:20px;text-transform:lowercase}
.trade-rematch{display:inline-flex;align-items:center;gap:5px;background:var(--brand);color:#fff;
  border:0;font-size:12px;font-weight:700;padding:7px 12px;border-radius:8px;cursor:pointer}
.trade-rematch:hover{background:var(--brand-dk)}

/* callbacks & warranty */
.cov-banner{display:flex;align-items:flex-start;gap:11px;border:1px solid;border-radius:10px;
  padding:13px 15px;margin-bottom:16px}
.cov-banner svg{flex:none;margin-top:1px}
.cov-banner strong{display:block;font-size:14px}
.cov-sub{display:block;font-size:12px;opacity:.85;margin-top:2px}
.cov-callback{background:#fffdf6;border-color:#ecd9b0;color:#8a5a12}
.cov-warranty{background:#f0f5fa;border-color:#cdd9e6;color:#2b5c85}
.cov-expired,.cov-none{background:#fbf1ed;border-color:#f0d9d1;color:var(--red)}
.cov-pill{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap}
.cov-pill.cov-callback{background:#fbf0dd;color:#8a5a12;border:0}
.cov-pill.cov-warranty{background:#eaf0f6;color:#2b5c85;border:0}
.cov-pill.cov-expired,.cov-pill.cov-none{background:#faece7;color:var(--red);border:0}
.sc-cta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.trade-issue{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);
  background:var(--card);color:var(--ink);font-size:12px;font-weight:700;padding:7px 12px;
  border-radius:8px;cursor:pointer}
.trade-issue:hover{border-color:var(--amber);color:#8a5a12}
.sc-open-pill{font-size:10.5px;font-weight:700;background:var(--amber);color:#fff;
  padding:3px 9px;border-radius:20px}
.sc-block{border-top:1px solid var(--line);padding:14px 16px;background:#fafbfa}
.sc-row{display:flex;align-items:flex-start;gap:12px;background:var(--card);
  border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap}
.sc-row.sc-resolved{opacity:.72}
.sc-kind{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;
  text-transform:uppercase;letter-spacing:.04em;padding:4px 9px;border-radius:20px;flex:none}
.sc-kind.k-callback{background:#fbf0dd;color:#8a5a12}
.sc-kind.k-warranty{background:#eaf0f6;color:#2b5c85}
.sc-main{flex:1;min-width:180px;display:flex;flex-direction:column;gap:2px}
.sc-job{font-size:13.5px;font-weight:700}
.sc-issue{font-size:13px;color:var(--ink)}
.sc-meta{font-size:11px;color:var(--ink-soft)}
.sc-note{font-size:11.5px;color:var(--ink-soft);font-style:italic}
.sc-side{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:none}
.sc-status{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px}
.sc-status.s-awaiting-confirmation{background:#fbf0dd;color:#8a5a12}
.sc-status.s-scheduled{background:#e8f2ea;color:#1f6b4a}
.sc-status.s-resolved{background:var(--line);color:var(--ink-soft)}
.sc-propose{display:flex;gap:6px;align-items:center}
.sc-propose input{border:1px solid var(--line);border-radius:7px;padding:6px 9px;font-size:12.5px;font-family:inherit}
.warranty-grid{grid-template-columns:repeat(auto-fill,minmax(92px,1fr))}
.portal-sec-note{font-size:13px;color:var(--ink-soft);margin:-4px 0 12px}
.role.dim span{opacity:.6}

/* per-trade work order lines */
.bundle-box{display:flex;align-items:flex-start;gap:11px;background:#f2f8f4;border:1px solid #d4e7db;
  border-radius:10px;padding:13px 15px;margin-bottom:16px;color:var(--brand-dk)}
.bundle-box svg{flex:none;margin-top:1px}
.bundle-box strong{display:block;font-size:13.5px}
.bundle-sub{display:block;font-size:12.5px;color:var(--ink-soft);margin-top:3px;line-height:1.45}
.wo-line{border:1px solid var(--line);border-radius:10px;margin-bottom:10px;overflow:hidden;background:var(--card)}
.wo-line.on{border-color:var(--brand)}
.wol-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 14px;background:var(--paper)}
.wo-line.on .wol-head{background:#f2f8f4}
.wol-title,.wol-check{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;cursor:default}
.wol-check{cursor:pointer;font-weight:600}
.wol-check input{accent-color:var(--brand);width:16px;height:16px;margin:0}
.wol-tag{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;
  background:var(--brand);color:#fff;padding:2px 7px;border-radius:20px}
.wol-tag.alt{background:var(--line);color:var(--ink-soft)}
.wol-val{font-family:inherit;font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums}
.wol-body{padding:13px 14px;display:flex;flex-direction:column;gap:12px}
.wol-total{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:13px 15px;background:var(--paper);border:1px solid var(--line);border-radius:10px;
  font-size:13.5px;color:var(--ink-soft);margin-bottom:4px}
.wol-total strong{font-size:15px;color:var(--ink)}
.rec-bundle{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;
  background:#e8f2ea;color:#1f6b4a;padding:3px 8px;border-radius:20px}

/* multi-step contractor form */
.sf-steps{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;
  margin:14px 0 20px}
.sf-steps button{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;
  appearance:none;border:0;border-right:1px solid var(--line);background:var(--paper);
  padding:12px 10px;font:600 13px Inter,sans-serif;color:var(--ink-soft);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-steps button:last-child{border-right:0}
.sf-steps button:disabled{cursor:default}
.sf-steps button:not(:disabled):hover{background:#eef2ef}
.sf-steps button[data-state="now"]{background:var(--card);color:var(--ink)}
.sf-steps button[data-state="done"]{background:var(--card);color:var(--brand)}
.sf-steps .sb-n{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--line);
  background:var(--card);display:grid;place-items:center;font-size:11px;flex:none}
.sf-steps button[data-state="now"] .sb-n{background:var(--brand);border-color:var(--brand);color:#fff}
.sf-steps button[data-state="done"] .sb-n{background:var(--brand);border-color:var(--brand);color:#fff}

/* ===== white-label pages (sign-in + public signup) ===== */
.wl-themed{background:var(--wl-bg) !important;color:var(--wl-text) !important}
.wl-themed .login-card{background:var(--wl-surface) !important;color:var(--wl-text) !important}
.wl-themed .login-card h1,.wl-themed .login-card h2{color:var(--wl-text) !important}
.wl-themed .btn-solid,.wl-themed .login-btn{background:var(--wl-accent) !important;color:var(--wl-btn-text) !important}
.login-signup{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;
  margin-top:16px;padding:14px 16px;border-radius:10px;border:1px solid var(--line);
  background:var(--paper);font-family:inherit;cursor:pointer;text-align:left}
.login-signup > span{font-size:12px;color:var(--ink-soft)}
.login-signup b{font-size:14.5px;font-weight:700;color:var(--wl-accent,var(--brand))}
.login-signup:hover{border-color:var(--wl-accent,var(--brand));background:var(--card)}
.wl-themed .login-signup{background:transparent;border-color:rgba(128,128,128,.32)}
.wl-themed .login-signup > span{color:var(--wl-text);opacity:.65}
.wl-themed .login-signup b{color:var(--wl-accent)}

.wl-page{min-height:100vh;background:var(--wl-bg);color:var(--wl-text);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:40px 20px;font-family:inherit}
.wl-card{width:100%;max-width:560px;background:var(--wl-surface);border-radius:14px;
  padding:34px;box-shadow:0 18px 50px rgba(0,0,0,.12)}
.wl-brand{display:flex;align-items:center;gap:11px;margin-bottom:22px}
.wl-brand-name{font-size:17px;font-weight:700;letter-spacing:-.02em;color:var(--wl-text)}
.wl-card h1{font-size:25px;letter-spacing:-.03em;margin:0;color:var(--wl-text)}
.wl-lede{font-size:15px;opacity:.72;margin-top:9px;line-height:1.5}
.wl-steps{display:flex;gap:7px;margin:22px 0 20px;flex-wrap:wrap}
.wl-step{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;
  padding:6px 11px;border-radius:20px;border:1px solid currentColor;opacity:.45}
.wl-step.on{opacity:1;background:var(--wl-accent);color:var(--wl-btn-text);border-color:var(--wl-accent)}
.wl-step.done{opacity:.85}
.wl-fld{display:block;margin-bottom:14px;font-size:13.5px;font-weight:600}
.wl-fld input,.wl-fld select{display:block;width:100%;margin-top:6px;padding:13px 14px;
  border:1px solid rgba(128,128,128,.35);border-radius:9px;font:400 16px inherit;
  background:var(--wl-surface);color:var(--wl-text)}
.wl-fld input:focus,.wl-fld select:focus{outline:2px solid var(--wl-accent);outline-offset:-1px}
.wl-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.wl-label{font-size:13.5px;font-weight:600;margin:4px 0 9px}
.wl-picks{display:flex;flex-wrap:wrap;gap:7px}
.wl-pick{border:1px solid rgba(128,128,128,.35);background:none;color:var(--wl-text);
  border-radius:20px;padding:8px 13px;font:500 13px inherit;cursor:pointer}
.wl-pick.on{background:var(--wl-accent);color:var(--wl-btn-text);border-color:var(--wl-accent);font-weight:600}
.wl-checks{display:flex;gap:9px;flex-wrap:wrap}
.wl-check{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(128,128,128,.35);
  border-radius:9px;padding:12px 15px;font-size:14px;font-weight:600;cursor:pointer}
.wl-check.on{border-color:var(--wl-accent)}
.wl-check input{accent-color:var(--wl-accent);width:16px;height:16px;margin:0}
.wl-summary{margin-top:18px;border:1px solid rgba(128,128,128,.25);border-radius:10px;overflow:hidden}
.wl-summary div{display:flex;justify-content:space-between;gap:14px;padding:11px 14px;font-size:13.5px;
  border-bottom:1px solid rgba(128,128,128,.18)}
.wl-summary div:last-child{border-bottom:0}
.wl-summary span{opacity:.65}
.wl-summary b{text-align:right;font-weight:600}
.wl-actions{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:24px;flex-wrap:wrap}
.wl-btn{background:var(--wl-accent);color:var(--wl-btn-text);border:0;border-radius:9px;
  padding:14px 22px;font:700 15px inherit;cursor:pointer}
.wl-btn:disabled{opacity:.45;cursor:not-allowed}
.wl-btn-ghost{background:none;border:1px solid rgba(128,128,128,.4);color:var(--wl-text);
  border-radius:9px;padding:13px 18px;font:600 14px inherit;cursor:pointer}
.wl-fine{font-size:12.5px;opacity:.6;line-height:1.5;margin-top:10px}
.wl-err{font-size:12.5px;color:#b1391f;margin-top:10px;font-weight:600}
.wl-foot{margin-top:20px;font-size:12px;opacity:.5}
.wl-done{text-align:center}
.wl-done .wl-brand{justify-content:center}
.wl-tick{color:var(--wl-accent);margin:6px 0 14px;display:flex;justify-content:center}
/* A dead link is not a success, so the tick's colour would be a lie. */
.wl-tick.warn{color:#b5442e}
/* Lead-in under the heading on the tenant sign-up, and the "optional" tag
   that keeps somebody from hunting for their unit number. */
.wl-sub{margin:0 0 18px;font-size:13.5px;line-height:1.5;color:var(--wl-text);opacity:.8}
.wl-opt{font-weight:500;font-size:11px;opacity:.6;margin-left:6px}
.wl-done p{font-size:15px;opacity:.78;line-height:1.55;margin-top:10px}
.wl-done .wl-btn{margin-top:22px}
@media (max-width:560px){
  .wl-card{padding:24px 20px}
  .wl-row{grid-template-columns:1fr}
  .wl-actions{flex-direction:column-reverse;align-items:stretch}
  .wl-actions button{width:100%}
}

/* ===== theme editor ===== */
.theme-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}
.theme-row{display:flex;flex-direction:column;gap:6px}
.theme-label{font-size:12.5px;font-weight:600;color:var(--ink)}
.theme-input{display:flex;align-items:center;gap:8px;border:1px solid var(--line);
  border-radius:8px;padding:6px 8px;background:var(--card)}
.theme-input input[type="color"]{width:30px;height:30px;border:0;padding:0;background:none;cursor:pointer;flex:none}
.theme-hex{border:0;background:none;font:500 13px ui-monospace,monospace;color:var(--ink);
  width:100%;min-width:0;text-transform:uppercase;outline:none}
.theme-preview{margin-top:16px;border:1px solid var(--line);border-radius:11px;overflow:hidden}
.tp-bar{background:var(--paper);border-bottom:1px solid var(--line);padding:8px 12px;
  font-size:11.5px;color:var(--ink-soft)}
.tp-body{background:var(--wl-bg);padding:22px}
.tp-card{background:var(--wl-surface);color:var(--wl-text);border-radius:10px;padding:18px;
  box-shadow:0 8px 22px rgba(0,0,0,.10)}
.tp-brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin-bottom:12px}
.tp-h{font-size:16px;font-weight:700;letter-spacing:-.02em}
.tp-p{font-size:12.5px;opacity:.7;margin-top:5px;line-height:1.45}
.tp-field{height:32px;border:1px solid rgba(128,128,128,.3);border-radius:7px;margin-top:10px}
.tp-btn{margin-top:14px;background:var(--wl-accent);color:var(--wl-btn-text);border-radius:8px;
  padding:11px 16px;font-size:13.5px;font-weight:700;text-align:center}
.theme-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-top:14px;flex-wrap:wrap}
.theme-link{font-size:13px;font-weight:600;color:var(--brand);text-decoration:underline;text-underline-offset:2px}
@media (max-width:640px){.theme-grid{grid-template-columns:1fr}}

/* properties (portfolio / property managers) */
.prop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.prop-card{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:18px 20px;display:flex;flex-direction:column;box-shadow:var(--shadow)}
.prop-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.prop-card h3{font-size:17px;letter-spacing:-.02em;margin:0}
.prop-addr{display:block;font-size:12.5px;color:var(--ink-soft);margin-top:3px}
.prop-actions{display:flex;align-items:center;gap:6px;flex:none}
.prop-stats{display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;padding:11px 0;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  font-size:12.5px;color:var(--ink-soft)}
.prop-stats strong{font-size:15px;color:var(--ink);font-weight:700}
.prop-vendors{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.prop-vendor{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);
  background:var(--paper);border-radius:20px;padding:5px 11px;font:600 12px Inter,sans-serif;
  color:var(--ink);cursor:pointer}
.prop-vendor:hover{border-color:var(--brand);color:var(--brand)}
.prop-vendor svg{color:var(--amber)}
.prop-more{font-size:11.5px;color:var(--ink-soft);align-self:center}
.prop-none{font-size:12.5px;color:var(--ink-soft);margin-top:13px;line-height:1.45}
.prop-notes{font-size:12.5px;color:var(--ink-soft);margin-top:10px;font-style:italic}
.prop-job{margin-top:14px;align-self:flex-start;display:inline-flex;align-items:center;gap:6px;
  border:1px dashed var(--line);background:none;border-radius:8px;padding:9px 13px;
  font:600 12.5px Inter,sans-serif;color:var(--brand);cursor:pointer}
.prop-job:hover{border-color:var(--brand);background:#f2f8f4}
.prop-cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.prop-cta .prop-job{margin-top:0}
@media (max-width:560px){
  .prop-grid{grid-template-columns:1fr}
  .prop-stats{gap:12px}
}

/* "Powered by" + SubSub logo on the white-labeled sign-in / sign-up pages */
.powered-by{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;
  letter-spacing:.01em;opacity:.7;text-decoration:none;color:inherit;cursor:pointer;
  transition:opacity .12s;
  /* The text is 13px tall and a fingertip is not. The padding makes the tap
     target reachable on a phone; the matching negative margin means adding
     it moved nothing on the page. */
  padding:7px 4px;margin:-7px -4px}
.powered-by:hover,.powered-by:focus-visible{opacity:1;text-decoration:none}
.powered-by:focus-visible{outline:2px solid var(--brand);outline-offset:1px;border-radius:5px}
.powered-by > span{white-space:nowrap}
.powered-by .ss-logo{position:relative;top:.5px}
.wl-foot.powered-by{margin-top:20px;opacity:.6;color:var(--wl-text)}
.login-foot .powered-by{opacity:.75}
.bp-foot .powered-by{opacity:.85;font-size:10.5px}

/* change orders */
.co-context{display:grid;grid-template-columns:1fr;gap:0;border:1px solid var(--line);border-radius:10px;
  overflow:hidden;margin-bottom:16px}
.co-context div{display:flex;justify-content:space-between;padding:10px 14px;font-size:13.5px;
  border-bottom:1px solid var(--line)}
.co-context div:last-child{border-bottom:0}
.co-context span{color:var(--ink-soft)}
.co-context b{font-variant-numeric:tabular-nums}
.co-context .co-cur{background:var(--paper)}
.co-context .co-cur b{font-size:15px}
.co-preview{display:flex;align-items:baseline;gap:10px;background:#f2f8f4;border:1px solid #d4e7db;
  border-radius:10px;padding:13px 15px;margin-top:4px}
.co-preview span{font-size:13px;color:var(--ink-soft);flex:1}
.co-preview b{font-size:19px;font-weight:800;letter-spacing:-.02em}
.co-preview em{font-style:normal;font-size:12.5px;font-weight:700;color:var(--brand)}
.co-row{display:flex;align-items:flex-start;gap:12px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap}
.co-row.co-declined,.co-row.co-void,.co-row.co-expired{opacity:.65}
.co-seq{font:800 11px ui-monospace,monospace;background:var(--ink);color:#fff;padding:4px 8px;
  border-radius:6px;flex:none;letter-spacing:.03em}
.co-main{flex:1;min-width:180px;display:flex;flex-direction:column;gap:3px}
.co-scope{font-size:13.5px;color:var(--ink)}
.co-meta{font-size:11px;color:var(--ink-soft);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.co-note{font-size:11.5px;color:var(--ink-soft);font-style:italic}
.co-side{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:none}
.co-delta{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.co-delta.up{color:var(--brand)}
.co-delta.down{color:var(--red)}
.co-status{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px}
.co-status.s-pending{background:#fbf0dd;color:#8a5a12}
.co-status.s-accepted{background:#e8f2ea;color:#1f6b4a}
.co-status.s-declined,.co-status.s-expired{background:#faece7;color:var(--red)}
.co-status.s-void{background:var(--line);color:var(--ink-soft)}
.co-revised{display:block;font-size:11px;color:var(--ink-soft);margin-top:2px;font-weight:500}
.co-revised b{color:var(--ink);font-weight:700}
.co-revised em{font-style:normal;color:#8a5a12;font-weight:600}
.job-val-note{font-style:normal;font-weight:500;opacity:.75}
.wo-change-btn{margin-top:6px;border-style:dashed}
.wo-co-sched{margin:14px 0 4px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.wo-co-hd{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;
  color:var(--ink-soft);padding:8px 14px;background:var(--paper);border-bottom:1px solid var(--line)}
.wo-co-line{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:baseline;
  padding:9px 14px;border-bottom:1px solid var(--line);font-size:13px}
.wo-co-seq{font:800 10.5px ui-monospace,monospace;color:var(--ink-soft)}
.wo-co-delta{font-weight:700;font-variant-numeric:tabular-nums}
.wo-co-delta.up{color:var(--brand)}
.wo-co-delta.down{color:var(--red)}
.wo-co-total{display:flex;justify-content:space-between;padding:11px 14px;font-size:13.5px;background:#f2f8f4}
.wo-co-total b{font-size:15px}
@media (max-width:560px){
  .co-row{flex-direction:column}
  .co-side{align-items:stretch;width:100%}
  .wo-co-line{grid-template-columns:auto 1fr;}
  .wo-co-delta{grid-column:2;text-align:right}
}

.imp-banner{display:flex;align-items:center;gap:10px;background:var(--amber);color:#1a1207;padding:9px 18px;
  font-size:13px;font-weight:600}
.imp-banner span{flex:1}
.imp-banner button{background:#1a1207;color:#fff;border:0;border-radius:7px;padding:7px 12px;
  font:700 12.5px Inter,sans-serif;cursor:pointer}

/* console — tablet and phone */
@media (max-width:1000px){
  
  
}
@media (max-width:760px){
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  .imp-banner{flex-wrap:wrap;padding:9px 14px;font-size:12.5px}
  .imp-banner button{width:100%}
  
}

/* ===== one menu on mobile/tablet: nav + user in the same drawer ===== */
.nav-burger{display:none;width:40px;height:40px;border:1px solid var(--line);border-radius:9px;background:var(--card);
  cursor:pointer;align-items:center;justify-content:center;padding:0;flex:none}
.nav-burger span{display:block;width:18px;height:2px;background:var(--ink);border-radius:2px;position:relative;transition:background .15s}
.nav-burger span::before,.nav-burger span::after{content:"";position:absolute;left:0;width:18px;height:2px;background:var(--ink);border-radius:2px;transition:transform .18s,top .18s}
.nav-burger span::before{top:-6px}
.nav-burger span::after{top:6px}
.nav-burger[aria-expanded="true"] span{background:transparent}
.nav-burger[aria-expanded="true"] span::before{top:0;transform:rotate(45deg)}
.nav-burger[aria-expanded="true"] span::after{top:0;transform:rotate(-45deg)}
.nav-scrim{position:fixed;inset:0;background:rgba(18,33,28,.45);z-index:54}

@media (max-width:1000px){
  /* tenant app */
  .nav-burger{display:flex}
  .user-wrap{display:none}
  /* 100vh is taller than what a phone or tablet browser actually shows once
     its own chrome is counted, so the last thing in the drawer -- which is
     "My account" and "Sign out" -- ends up below the fold with no way to
     scroll to it. dvh is the visible height; vh stays as the fallback for
     anything that does not know dvh. The bottom padding clears the home
     indicator on a device that has one. */
  .ss-header .tabs{position:fixed;inset:0 0 0 auto;width:min(86vw,340px);height:100vh;height:100dvh;
    max-height:100dvh;background:var(--card);
    flex-direction:column;align-items:stretch;gap:0;border-radius:0;z-index:55;
    overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
    padding:0 0 max(24px,env(safe-area-inset-bottom));
    transform:translateX(100%);transition:transform .2s;box-shadow:-12px 0 40px rgba(0,0,0,.18)}
  .ss-header .tabs.open{transform:none}
  .ss-header .tabs > button{width:100%;justify-content:flex-start;padding:15px 20px;border-radius:0;
    border-bottom:1px solid var(--line);font-size:15.5px;color:var(--ink);white-space:normal;flex:none}
  .ss-header .tabs > button.on{background:#f2f8f4;color:var(--brand)}
  .drawer-user{display:flex;align-items:center;gap:11px;padding:18px 20px;border-bottom:1px solid var(--line);background:var(--paper)}
  .drawer-user .user-avatar{width:36px;height:36px;font-size:13px}
  .drawer-user-txt{display:flex;flex-direction:column;line-height:1.2;min-width:0}
  .drawer-user-txt b{font-size:15px}
  .drawer-user-txt span{font-size:12px;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .drawer-actions{display:flex;flex-direction:column;margin-top:auto;padding-top:8px;
    border-top:1px solid var(--line);flex:none}
  .drawer-actions button{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:14px 20px;
    font:600 14.5px Inter,sans-serif;color:var(--ink);cursor:pointer;text-align:left}
  .drawer-actions button svg{color:var(--brand)}
  .drawer-actions button:hover{background:var(--paper)}
  .drawer-actions .drawer-out,.drawer-actions .drawer-out svg{color:var(--red)}

  
  
  
  
  
  
  
  
  
  
  
}

/* ============ RESPONSIVE ============ */
/* Base: allow horizontal safety everywhere */
.ss-root{overflow-x:hidden}
.trade-side{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end}

/* ---- Tablet (<=1024px) ---- */
@media (max-width:1024px){
  .ss-main{padding:18px 18px 60px}
  .ss-header{padding:12px 18px}
  .grid{grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:13px}
  .wo-sheet,.wo-recs{max-width:none}
  .user-row-perms{max-width:180px}
  .cal-grid{grid-template-columns:150px repeat(14,minmax(38px,1fr))}
}

/* ---- Small tablet / large phone (<=820px) ---- */
@media (max-width:820px){

  .filters{gap:8px}
  .ms,.ms-btn{min-width:0}
  .ms-btn{min-width:118px}
  .user-row-perms{display:none}
  .dash-grid{grid-template-columns:repeat(2,1fr)}
  .dash-grid.g5,.dash-grid.g3{grid-template-columns:repeat(2,1fr)}
  .dash-card.prop{grid-column:1/-1}
  .trade-row{flex-wrap:wrap}
  .trade-side{width:100%;justify-content:space-between;padding-top:10px;margin-top:4px;border-top:1px solid var(--line)}
  .job-card-head{flex-direction:column;align-items:flex-start;gap:8px}
  .fill-badge{align-self:flex-start}
}

/* ---- Phone (<=640px) ---- */
@media (max-width:640px){
  .ss-main{padding:14px 14px 48px}
  .ss-header{padding:10px 14px;gap:10px}
  .brand h1{font-size:17px}
  .brand p{font-size:11px}
  .logo{width:32px;height:32px}
  .user-meta{display:none}
  .user-btn{padding:6px}
  .add-btn{padding:9px 13px;font-size:13px}

  /* stacked form rows */
  .fld-row{flex-direction:column;gap:0}
  .fld-row .fld{width:100%}

  /* filters become a 2-up grid so nothing is cramped */
  .filters{display:grid;grid-template-columns:1fr 1fr;gap:9px;align-items:end}
  .ms{min-width:0}
  .ms-btn{width:100%;min-width:0}
  .ms-menu{left:0;right:0;min-width:0}
  .zip-filter{min-width:0;width:100%}
  .ready-toggle{height:auto;padding:9px 10px;font-size:12px;justify-content:center}
  .clear-filters{grid-column:1 / -1;text-align:center;padding:6px}

  /* cards full width */
  .grid{grid-template-columns:1fr;gap:12px}
  .card{padding:14px}
  .card-actions{gap:6px}
  .mini{font-size:12px;padding:9px 6px}

  /* modals become sheets */
  .modal-backdrop{padding:0;align-items:flex-end}
  .modal,.modal-wide{max-width:none;width:100%;max-height:92vh;border-radius:16px 16px 0 0;padding:22px 16px 26px}
  .modal-close{top:12px;right:12px}
  .form-actions{flex-direction:column-reverse;gap:8px}
  .form-actions button{width:100%;justify-content:center}

  /* jobs + trades */
  .job-card{padding:15px}
  .job-meta{gap:9px;font-size:11.5px}
  .trade-row{padding:12px;gap:10px}
  .trade-side{flex-direction:column;align-items:stretch;gap:10px}
  .trade-actions{justify-content:space-between;width:100%}
  .trade-assign{width:100%;justify-content:center}
  .trade-assigned{gap:7px}
  /* rating: give it a labelled full-width row with big tap targets */
  .trade-side .star-rate{width:100%;justify-content:space-between;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:9px 12px}
  .sr-star{padding:4px}
  .sr-star svg{width:20px;height:20px}
  .resp{padding:9px 12px;font-size:12.5px}

  /* pick lists / recommendations */
  .rec-row,.pick-row{flex-wrap:wrap;padding:13px}
  .rec-main{width:calc(100% - 42px)}
  .rec-send,.btn-notify,.btn-warn{width:100%;justify-content:center;margin-top:4px}
  .rec-rank{width:26px;height:26px;font-size:12px}
  .pick-list{max-height:none}

  /* users */
  .user-row{flex-wrap:wrap}
  .user-row-main{width:calc(100% - 52px)}
  .user-row-actions{width:100%;justify-content:flex-end;padding-top:8px;border-top:1px solid var(--line)}

  /* contractor portal */
  .portal-head{flex-direction:column;align-items:stretch}
  .avail-switch{justify-content:center}
  .portal-tabs{width:100%;overflow-x:auto;scrollbar-width:none}
  .portal-tabs::-webkit-scrollbar{display:none}
  .portal-tabs button{white-space:nowrap;flex:none;padding:9px 12px;font-size:12.5px}
  .portal-panel{padding:15px}
  .auto-card{flex-wrap:wrap}
  .auto-card-main{width:calc(100% - 32px)}
  .auto-toggle{width:100%;justify-content:center;padding-top:8px;border-top:1px solid var(--line)}
  .portal-respond{flex-direction:column;align-items:stretch}
  .portal-respond .respond-btns{display:flex;gap:8px}
  .portal-respond .resp{flex:1;justify-content:center}

  /* availability grids */
  .cal-legend{gap:12px;font-size:11.5px;flex-wrap:wrap}
  .cal-hint{margin-left:0;width:100%}
  .cal-grid{grid-template-columns:112px repeat(14,44px)}
  .cal-sub{font-size:11.5px;padding:8px 6px}
  .mini-cal{gap:4px}
  .mc-day{border-radius:7px}
  .mc-num{font-size:12px}
  .mini-cal-nav{font-size:11.5px;gap:6px}
  .mini-cal-nav span{text-align:center}

  /* crew editor */
  .member-row{flex-wrap:wrap;gap:6px}
  .member-row input{min-width:0;flex:1 1 100%}
  .member-row input:last-of-type{max-width:none;flex:1 1 100%}
  .crew-edit-card{padding:12px}

  /* docs */
  .doc-manage-row{flex-wrap:wrap}
  .dm-info{width:calc(100% - 30px)}
  .dm-actions,.dm-upload{width:100%;justify-content:center;margin-top:6px}
  .dm-replace,.dm-delete{flex:1;justify-content:center}
  .doc-row{flex-wrap:wrap}
  .doc-label-wrap{width:calc(100% - 30px)}

  /* work order */
  .wo-sheet{padding:16px}
  .wo-guide{padding:12px 14px}
  .wo-guide li{font-size:12px}
  .jobs-head{flex-wrap:wrap;gap:10px}

  /* notification previews on phones */
  .mp-body{font-size:11px;padding:12px;max-height:200px}
  .mp-head{flex-direction:column;gap:2px}
  .sms-bubble{max-width:none;font-size:12.5px}

  /* notifications on phones */
  .notify-opts.compact{flex-direction:column}

  /* crew availability on phones */
  .crew-picker{gap:6px}
  .cp-btn{flex:1 1 calc(50% - 3px);min-width:0;padding:9px 11px}
  .all-crew-grid{grid-template-columns:78px repeat(14,minmax(16px,1fr));gap:2px}
  .acg-name{font-size:10.5px}
  .acg-cell{min-height:22px}
  .acg-day .dom{font-size:10px}

  /* filter bar on phones */
  .filter-bar{gap:8px}
  .filter-toggle{flex:1;justify-content:center}
  .sort-ctl{flex:1;min-width:0}
  .sort-ctl select{max-width:none;flex:1;min-width:0}
  .plan-notice{margin-top:14px}

  /* license card on phones */
  .lic-actions{width:100%;justify-content:space-between;padding-top:8px;border-top:1px solid var(--line)}
  .lic-actions .doc-review{width:auto;margin-top:0}

  /* coverage schedule on phones */
  .cov-line-top{flex-wrap:wrap;gap:8px}
  .cl-input{width:100%}
  .req-table td{font-size:12px}

  /* callbacks on phones */
  .sc-row{flex-direction:column}
  .sc-side{align-items:stretch;width:100%}
  .sc-side .trade-actions{width:100%}
  .cov-pill{white-space:normal}

  /* document review on phones */
  .rv-file{flex-direction:column;align-items:stretch;gap:10px}
  .rv-file-actions{width:100%}
  .rv-btn{flex:1;justify-content:center}
  .doc-row,.doc-manage-row{flex-wrap:wrap}
  .doc-review{width:100%;justify-content:center;margin-top:8px}

  /* stepped form on phones */
  .sf-steps button{font-size:0;gap:0;padding:12px 6px}
  .sf-steps button .sb-n{font-size:11px}
  .sf-steps button[data-state="now"]{font-size:12.5px;gap:7px}

  /* upgrade gate on phones */
  .up-buy{flex-direction:column;align-items:stretch;gap:12px}
  .up-go{width:100%;justify-content:center}
  .up-form h2{font-size:20px}

  /* plans + uniforms on phones */
  .plan-grid{grid-template-columns:1fr}
  .cycle{width:100%}
  .cycle button{flex:1;justify-content:center}
  .cycle-row{gap:10px}
  .plan-current{flex-direction:column;align-items:flex-start;gap:8px}
  .pc-usage{text-align:left}
  .uni-grid{grid-template-columns:1fr 1fr;gap:9px}
  .uni-card{padding:11px}
  .uni-controls{flex-direction:column;align-items:stretch;gap:6px}
  .uni-qty{align-self:stretch;justify-content:space-between}
  .uni-qty span{flex:1}
  .uni-order{flex-wrap:wrap}
  .uni-order .trade-actions{width:100%;padding-top:8px;border-top:1px solid var(--line)}

  /* branding on phones */
  .mark-row{gap:10px}
  .mark-actions{width:100%;justify-content:stretch}
  .mark-actions>*{flex:1;justify-content:center}
  .brand-txt p{display:none}
  .ss-footer{flex-direction:column;align-items:flex-start;gap:6px;padding:16px 14px 24px}
  .logo-opts{flex-direction:column;align-items:stretch}
  .logo-current{align-items:center}
  .bp-body{padding:16px 14px}
  .subdomain-row{flex-direction:column;align-items:stretch}
  .subdomain-row input{border-radius:9px;border-right:1px solid var(--line)}
  .sd-suffix{border-radius:9px;border-left:1px solid var(--line);border-top:0;text-align:center}
  .who-bar{padding:11px 13px}
  .dash-hello .who-bar{width:100%}

  /* job lifecycle on phones */
  .job-footer{flex-direction:column;align-items:stretch}
  .jf-btn{width:100%;justify-content:center}
  .wd-row{flex-direction:column;gap:2px}
  .wd-row strong{text-align:left}
  .wo-doc-head{flex-direction:column}
  .wo-doc-head h2{font-size:20px}
  .job-title-row{flex-wrap:wrap}

  /* admin dashboard on phones */
  .dash-hello{flex-direction:column}
  .dash-cta{width:100%}
  .dash-cta button{flex:1;justify-content:center}
  .dash-row{flex-wrap:wrap}
  .dash-row-main{width:calc(100% - 92px)}
  .dash-row-btn{width:100%;justify-content:center;margin-top:8px}
  .add-city-row{flex-direction:column}
  .add-city-row .btn-solid{width:100%;justify-content:center}
  .radius-row{flex-wrap:wrap}
  .radius-row input{flex:1 1 100%}
  .radius-row input[type=number]{max-width:90px;flex:none}

  /* job settings / docs on phones */
  .seg-tabs{width:100%}
  .seg-tabs button{flex:1;padding:9px 6px;font-size:12.5px}
  .cov-preview{font-size:12px}

  /* contractor dashboard on phones */
  .dash-grid,.dash-grid.g5,.dash-grid.g3{grid-template-columns:1fr 1fr;gap:9px}
  .dash-card{padding:12px}
  .dc-num{font-size:20px}
  .hdr-avail{padding:7px 9px}
  .hdr-avail-text{display:none}
  .dash-sec h3{font-size:12.5px}
  .ac-card{padding:14px 40px 14px 14px}

  /* login + request-docs on phones */
  .login-card{padding:22px 16px;border-radius:14px}
  .login-brand h1{font-size:23px}
  .req-docs-bar{flex-direction:column;align-items:stretch;gap:7px}
  .rd-btn{justify-content:center;padding:9px}
  .detail-doc-block{flex-direction:column;align-items:stretch}
  .doc-block.with-cta{flex-direction:column;align-items:stretch}
  .doc-block.with-cta .btn-notify{width:100%;justify-content:center}
  .detail-doc-block .btn-notify{width:100%;justify-content:center}
  .doc-row-actions{width:100%;margin-top:6px}
  .doc-row-actions button{flex:1;justify-content:center}
  .crew-head{flex-wrap:wrap;gap:6px}
  .user-row-actions{flex-wrap:wrap}
  .login-as-btn{flex:1;justify-content:center}
  .user-row-actions .btn-notify.sm{flex:1;justify-content:center}

  /* misc */
  .searchbar .search-input input{font-size:16px} /* prevents iOS zoom-on-focus */
  .fld input,.fld select,.fld textarea{font-size:16px}
  .stat-cards{gap:7px}
  .stat-card{padding:10px}
  .sc-num{font-size:18px}
  .detail-actions{flex-direction:column}
  .detail-actions .mini{width:100%}
  .pick-grid{gap:6px}
  .pick{padding:8px 12px;font-size:12.5px}
}

/* ---- Very small (<=380px) ---- */
@media (max-width:380px){
  .filters{grid-template-columns:1fr}
  .card-actions{flex-direction:column}
  .mini{width:100%}
  .cal-grid{grid-template-columns:96px repeat(14,42px)}
}

/* Touch targets & no hover-stick on touch devices */
@media (hover:none){
  .card:hover{transform:none;border-color:var(--line)}
  .cal-cell.clickable:hover{box-shadow:none}
  .cal-plus{opacity:1}
  button,.pick,.mini,.resp{touch-action:manipulation}
}


/* ---- Platform console -------------------------------------------------
   The console's markup and its styles change together, so they are kept
   together: this whole block is replaced as a unit rather than patched
   rule by rule. Half of one and half of the other is worse than either. */
/* ===== platform console ===== */
.pf-root{min-height:100vh;background:var(--paper);color:var(--ink)}
.pf-top{display:flex;align-items:center;gap:22px;padding:0 22px;height:56px;background:#0f1a15;color:#fff;
  position:sticky;top:0;z-index:20}
.pf-brand{display:flex;align-items:center;gap:10px;color:#fff;
  background:none;border:0;font:inherit;cursor:pointer;
  padding:7px 8px;margin:-7px -8px;border-radius:9px;transition:background .12s}
.pf-brand:hover{background:rgba(255,255,255,.08)}
.pf-brand:focus-visible{outline:2px solid var(--amber);outline-offset:1px}
.pf-tag{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
  background:var(--amber);color:#1a1207;padding:3px 8px;border-radius:20px}
.pf-nav{display:flex;gap:2px;flex:1}
.pf-nav button{display:inline-flex;align-items:center;gap:7px;background:none;border:0;color:rgba(255,255,255,.7);
  font:600 13.5px Inter,sans-serif;padding:9px 13px;border-radius:8px;cursor:pointer}
.pf-nav button:hover{color:#fff;background:rgba(255,255,255,.07)}
.pf-nav button.on{color:#fff;background:rgba(255,255,255,.12)}
.pf-me{position:relative;margin-left:auto;flex:none}
.pf-user{display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);
  color:#fff;border-radius:10px;padding:5px 10px 5px 5px;cursor:pointer;font-family:inherit}
.pf-user:hover,.pf-user[aria-expanded="true"]{background:rgba(255,255,255,.16)}
.pf-avatar{background:var(--amber);color:#1a1207;width:28px;height:28px;font-size:11px}
.pf-user-txt{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;text-align:left}
.pf-user-txt b{font-size:13px;color:#fff}
.pf-user-txt span{font-size:10.5px;color:rgba(255,255,255,.65)}
/* the menu is a light surface on a dark bar: every colour set explicitly, nothing inherited */
.pf-menu{position:absolute;right:0;top:calc(100% + 8px);width:250px;background:#ffffff;color:#12211c;
  border:1px solid #cfd8d2;border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.28);padding:6px;z-index:60;
  display:flex;flex-direction:column}
.pf-menu-hd{padding:9px 10px 10px;border-bottom:1px solid #e3e8e5;display:flex;flex-direction:column;margin-bottom:4px}
.pf-menu-hd b{font-size:13.5px;color:#12211c}
.pf-menu-hd span{font-size:12px;color:#5d6f67}
.pf-menu-hd em{font-style:normal;font-size:10.5px;font-weight:700;color:#8a5a12;background:#fbf0dd;
  padding:2px 7px;border-radius:20px;align-self:flex-start;margin-top:6px}
.pf-menu > button{display:flex;align-items:center;gap:9px;width:100%;background:transparent;border:0;padding:10px 11px;
  border-radius:8px;font:600 13.5px Inter,sans-serif;color:#12211c;cursor:pointer;text-align:left}
.pf-menu > button svg{color:#1f6b4a;flex:none}
.pf-menu > button:hover{background:#f2f8f4;color:#1f6b4a}
.pf-menu > button.pf-menu-out{border-top:1px solid #e3e8e5;border-radius:0 0 8px 8px;margin-top:4px;color:#b1391f}
.pf-menu > button.pf-menu-out svg{color:#b1391f}
.pf-menu > button.pf-menu-out:hover{background:#faece7}
.pf-burger{display:none;margin-left:auto;width:40px;height:40px;border:1px solid rgba(255,255,255,.2);border-radius:9px;
  background:transparent;cursor:pointer;align-items:center;justify-content:center;padding:0;flex:none}
.pf-burger span{display:block;width:18px;height:2px;background:#fff;border-radius:2px;position:relative;transition:background .15s}
.pf-burger span::before,.pf-burger span::after{content:"";position:absolute;left:0;width:18px;height:2px;background:#fff;border-radius:2px;transition:transform .18s,top .18s}
.pf-burger span::before{top:-6px}
.pf-burger span::after{top:6px}
.pf-burger[aria-expanded="true"] span{background:transparent}
.pf-burger[aria-expanded="true"] span::before{top:0;transform:rotate(45deg)}
.pf-burger[aria-expanded="true"] span::after{top:0;transform:rotate(-45deg)}
.pf-tag.std{background:#cfd8d2;color:#12211c}
.pf-mini{display:inline-flex;align-items:center;gap:5px;background:var(--card);border:1px solid var(--line);
  color:var(--ink);border-radius:8px;padding:7px 11px;font:600 12.5px Inter,sans-serif;cursor:pointer}
.pf-mini:hover{border-color:var(--brand);color:var(--brand)}
.pf-adduser,.pf-adduser-grid{display:grid;grid-template-columns:1.2fr 1.4fr auto auto auto;gap:8px;align-items:center;
  padding:10px;background:var(--paper);border:1px solid var(--line);border-radius:10px;margin-bottom:10px}
.pf-adduser input,.pf-adduser select{border:1px solid var(--line);border-radius:8px;padding:9px 11px;
  font:500 13.5px Inter,sans-serif;background:var(--card);min-width:0}
.pf-main{max-width:1180px;margin:0 auto;padding:26px 22px 60px}
.pf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
.pf-head h2{font-size:22px;letter-spacing:-.03em;margin:0}
.pf-sub{display:block;font-size:12px;color:var(--ink-soft);font-weight:400;margin-top:2px}
.pf-back{background:none;border:0;color:var(--brand);font:600 13.5px Inter,sans-serif;padding:0 0 14px;cursor:pointer}
.pf-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(154px,1fr));gap:10px;align-items:stretch}
.pf-kpis-wrap{margin-bottom:18px}
.pf-kpis-top{margin-top:14px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:0;
  display:flex;flex-direction:column;gap:3px}
.kpi.accent{border-color:var(--brand);background:#f2f8f4}
.kpi.warn{border-color:#e6c98f;background:#fffdf6}
.kpi-v{font-size:22px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.kpi-l{font-size:11.5px;color:var(--ink-soft);font-weight:600}
.kpi-l em{font-style:normal;font-weight:500;opacity:.8}
.kpi-sub{font-size:11px;color:var(--ink-soft);font-weight:500;opacity:.85;line-height:1.35}
.pf-table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:11px}
.pf-table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:760px}
.pf-table th{text-align:left;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;
  color:var(--ink-soft);padding:11px 14px;border-bottom:1px solid var(--line);background:var(--paper);white-space:nowrap}
.pf-table td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.pf-table tbody tr{cursor:pointer}
.pf-table tbody tr:hover{background:var(--paper)}
.pf-table tbody tr:last-child td{border-bottom:0}
.pf-table tr.muted td{opacity:.55}
.pf-table tr.warn td:first-child{border-left:3px solid var(--red)}
.pf-table code{font:600 12px ui-monospace,monospace;background:var(--paper);padding:2px 6px;border-radius:5px}
@media (max-width:820px){
  .pf-table.pf-table-responsive{min-width:0;width:100%;display:block}
  .pf-table.pf-table-responsive thead{display:none}
  .pf-table.pf-table-responsive tbody{display:block}
  .pf-table.pf-table-responsive tr{display:block;background:var(--card);border:1px solid var(--line);
    border-radius:11px;padding:4px 14px;margin-bottom:10px}
  .pf-table.pf-table-responsive tr.warn{border-left:3px solid var(--red)}
  .pf-table.pf-table-responsive td{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
    padding:9px 0;border-bottom:1px solid var(--line);text-align:right}
  .pf-table.pf-table-responsive td:last-child{border-bottom:0}
  .pf-table.pf-table-responsive td[data-label]::before{content:attr(data-label);font-size:10.5px;font-weight:800;
    text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);text-align:left;flex:none;padding-top:1px}
  .pf-table.pf-table-responsive td:not([data-label]),
  .pf-table.pf-table-responsive td[data-label=""]{justify-content:flex-end}
  .pf-table.pf-table-responsive td > b,.pf-table.pf-table-responsive td > span:first-child{text-align:right}
  .pf-table.pf-table-responsive .pf-sub{display:block;text-align:right}
  .pf-table.pf-table-responsive .pf-row-actions{justify-content:flex-end}
}
.pf-num td{font-variant-numeric:tabular-nums;text-align:right}
.pf-num td:first-child,.pf-num th:first-child{text-align:left}
.pf-num th{text-align:right}
@media (max-width:820px){
  .pf-num.pf-table-responsive td:first-child{text-align:right}
}
.pf-flag{color:var(--amber);font-weight:800;font-size:11px}
.pf-multi{color:var(--brand);font-weight:800;font-size:12px}
.pf-status{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:capitalize}
.pf-status.active{background:#e8f2ea;color:#1f6b4a}
.pf-status.comped{background:#eaf0f6;color:#2b5c85}
.pf-status.suspended,.pf-status.expired{background:#faece7;color:var(--red)}
.pf-status.canceled{background:var(--line);color:var(--ink-soft)}
.pf-note{font-size:12.5px;color:var(--ink-soft);margin:10px 0 0;line-height:1.5}
.pf-act{font-size:13.5px;margin:6px 0;line-height:1.5}
.pf-panel{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:18px 20px;margin-top:16px}
.pf-panel h3{font-size:15px;letter-spacing:-.02em;margin:0 0 10px}
.pf-plan-row{display:flex;gap:14px;flex-wrap:wrap}
.pf-plan-row label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:var(--ink-soft)}
.pf-plan-row select{border:1px solid var(--line);border-radius:8px;padding:9px 12px;font:500 13.5px Inter,sans-serif;min-width:150px;background:var(--card)}
.pf-line{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px;flex-wrap:wrap}
.pf-line:last-child{border-bottom:0}
.pf-line-main{flex:1;min-width:0;display:flex;flex-direction:column}
.pf-line-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:480px){
  .pf-line .pf-mini{width:100%;justify-content:center;order:99}
}
.pf-date{font:600 12px ui-monospace,monospace;color:var(--ink-soft);width:86px;flex:none}
.pf-line b.up,.pf-table .up{color:var(--brand)}
.pf-line b.down,.pf-table .down{color:var(--red)}
/* superadmin sign-in */
.sa-page{min-height:100vh;background:#0f1a15;color:#fff;display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:40px 20px}
.sa-card{width:100%;max-width:440px;background:#16241d;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:30px}
.sa-brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;color:#fff}
.sa-card h1{font-size:23px;letter-spacing:-.03em;margin:0}
.sa-lede{font-size:13.5px;color:rgba(255,255,255,.6);margin:6px 0 20px;line-height:1.5}
.sa-google-btn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;
  background:#fff;color:#1f1f1f;border:1px solid rgba(255,255,255,.9);border-radius:9px;
  padding:13px;font:600 15px Inter,sans-serif;cursor:pointer;margin-top:4px}
.sa-google-btn:hover{background:#f5f5f5}
.sa-google-btn:disabled{opacity:.7;cursor:default}
.sa-google-note{font-size:12px;color:rgba(255,255,255,.5);margin-top:12px;line-height:1.5}
.sa-staff{margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.1)}
.sa-staff .ld-label{color:rgba(255,255,255,.5)}
.sa-staff .ld-row{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12)}
.sa-staff .ld-row:hover{border-color:var(--amber);background:rgba(255,255,255,.08)}
.sa-staff .ld-name{color:#fff}
.sa-staff .ld-email{color:rgba(255,255,255,.55)}
.sa-foot{margin-top:18px;font-size:11.5px;color:rgba(255,255,255,.35)}
/* activity log */
.pf-panel-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.pf-panel-hd h3{margin:0}
.pf-panel-hd select{border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:500 13px Inter,sans-serif;background:var(--card)}
.pf-act-row{display:grid;grid-template-columns:96px 104px 1fr auto;gap:12px;align-items:baseline;
  padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.pf-act-row:last-child{border-bottom:0}
.pf-act-when{font:600 11.5px ui-monospace,monospace;color:var(--ink-soft);display:flex;flex-direction:column}
.pf-act-when em{font-style:normal;opacity:.7;font-size:10.5px}
.pf-act-kind{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;
  border-radius:20px;background:var(--paper);color:var(--ink-soft);white-space:nowrap;justify-self:start}
.pf-act-kind.k-doc_verified,.pf-act-kind.k-job_completed{background:#e8f2ea;color:#1f6b4a}
.pf-act-kind.k-doc_rejected{background:#faece7;color:var(--red)}
.pf-act-kind.k-impersonation,.pf-act-kind.k-limit_hit{background:#fbf0dd;color:#8a5a12}
.pf-act-kind.k-wo_issued,.pf-act-kind.k-change_order{background:#eaf0f6;color:#2b5c85}
.pf-act-txt{color:var(--ink);line-height:1.4}
.pf-act-who{font-size:12px;color:var(--ink-soft);white-space:nowrap}
.pf-act-row{grid-template-columns:90px 1fr auto}
.pf-act-kind{display:none}
@media (max-width:600px){
  .pf-act-row{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:11px 0}
  .pf-act-when{flex-direction:row;gap:6px;width:100%}
  .pf-act-txt{width:100%}
  .pf-act-who{font-size:11.5px;opacity:.75}
}
@media (max-width:1000px){
  .pf-burger{display:flex}
  /* Same as the tenant drawer: the console's sign-out sits at the bottom. */
  .pf-nav{position:fixed;inset:0 0 0 auto;width:min(86vw,340px);height:100vh;height:100dvh;
    max-height:100dvh;background:#0f1a15;flex-direction:column;
    gap:0;z-index:55;transform:translateX(100%);transition:transform .2s;
    overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
    padding-bottom:max(16px,env(safe-area-inset-bottom));
    box-shadow:-12px 0 40px rgba(0,0,0,.4)}
  .pf-nav.open{transform:none}
  .pf-nav button{width:100%;justify-content:flex-start;padding:16px 22px;border-radius:0;font-size:16px;
    border-bottom:1px solid rgba(255,255,255,.08);color:#fff}
  .pf-nav button.on{background:rgba(255,255,255,.1)}
}
@media (max-width:820px){
  .pf-top{gap:10px;padding:0 14px}
  .pf-adduser,.pf-adduser-grid{grid-template-columns:1fr;gap:8px}
  .pf-adduser select,.pf-adduser .btn-solid,.pf-adduser .pf-mini,
  .pf-adduser-grid select,.pf-adduser-grid input{width:100%;justify-content:center}
  .pf-main{padding:16px 14px 44px}
  .pf-head h2{font-size:19px}
  .pf-kpis{gap:8px;grid-template-columns:repeat(auto-fit,minmax(138px,1fr))}
  .kpi{padding:10px 12px}
  .kpi-v{font-size:19px}
  .pf-panel{padding:14px 14px}
  .pf-plan-row{flex-direction:column;gap:10px}
  .pf-plan-row select{min-width:0;width:100%}
  .pf-act-when{flex-direction:row;gap:6px}
  .pf-act-who{white-space:normal;font-size:11.5px}
  .pf-menu{width:calc(100vw - 28px);right:-4px}
  .sa-card{padding:22px 18px}
}
@media (max-width:400px){
  .pf-nav button svg{display:none}
}
/* Two tiles across survives a 390px phone; one across only below that. */
@media (max-width:359px){
  .pf-kpis{grid-template-columns:1fr}
}
/* Drawer-only blocks, hidden on desktop where the user chip does this job.
   Scoped to desktop rather than left unconditional: this rule sits below the
   media query that reveals the tenant drawer's own blocks, and being later
   at equal specificity it was winning at every width -- so "My account" and
   "Sign out" were display:none inside the very drawer that exists to hold
   them. Reachable only by rotating to landscape, where the desktop chip
   takes over. */
@media (min-width:1001px){
  .drawer-user,.drawer-actions,.pf-drawer-user,.pf-drawer-actions{display:none}
}
@media (max-width:1000px){
  /* platform console */
  .pf-me{display:none}
  .pf-nav{padding:0 0 24px}
  .pf-drawer-user{display:flex;align-items:center;gap:11px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.1)}
  .pf-drawer-user .pf-avatar{width:36px;height:36px;font-size:13px}
  .pf-drawer-txt{display:flex;flex-direction:column;line-height:1.2;min-width:0;color:#fff}
  .pf-drawer-txt b{font-size:15px}
  .pf-drawer-txt span{font-size:12px;color:rgba(255,255,255,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pf-drawer-actions{display:flex;flex-direction:column;margin-top:auto;padding-top:8px;border-top:1px solid rgba(255,255,255,.1)}
  .pf-drawer-actions button{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:14px 22px;
    font:600 14.5px Inter,sans-serif;color:#fff;cursor:pointer;text-align:left}
  .pf-drawer-actions button:hover{background:rgba(255,255,255,.08)}
  .pf-drawer-actions .pf-drawer-out{color:#f5b8a6}
}
/* superadmin CRUD: create/edit forms, delete confirm, reset panel */
.btn-danger{display:inline-flex;align-items:center;gap:8px;background:var(--red);color:#fff;border:0;
  border-radius:10px;padding:11px 20px;font:700 14px Inter,sans-serif;cursor:pointer}
.btn-danger:hover{background:#9c3119}
.btn-danger:disabled{opacity:.4;cursor:not-allowed}
.pf-hd-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pf-danger-btn{color:var(--red);border-color:#f0d9d1}
.pf-danger-btn:hover{background:#faece7;border-color:var(--red)}
.btn-danger-outline{display:inline-flex;align-items:center;gap:8px;background:var(--card);color:var(--red);
  border:1px solid #f0d9d1;border-radius:10px;padding:10px 18px;font:700 13.5px Inter,sans-serif;cursor:pointer;flex:none}
.btn-danger-outline:hover{background:#faece7;border-color:var(--red)}
.pf-danger-zone{border-color:#f0d9d1;background:#fffaf8}
.pf-danger-zone h3{display:flex;align-items:center;gap:8px;color:var(--red)}
.pf-danger-row{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.pf-danger-row b{display:block;font-size:14px;margin-bottom:4px}
.pf-danger-row .pf-note{margin:0;max-width:52ch}
.pf-company-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px;margin-top:16px}
.pf-comp{border-left:3px solid var(--line)}
.pf-comp.on{border-left-color:var(--gold,#E39B32);background:#fffdf6}
.pf-comp .fld{max-width:480px;margin:12px 0}
.pf-comp-note{font-size:13px;margin:10px 0 12px}
.pf-comp-tag{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;
  letter-spacing:.06em;text-transform:uppercase;color:#8a5a12;background:#fdf1dc;
  border:1px solid #edd9ae;border-radius:5px;padding:2px 6px}

.pf-write-err{margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#fdf1ef;
  border:1px solid #e9c4bd;color:#8a2f1c;font-size:13.5px}
.pf-account-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px;margin-top:16px}
.pf-dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:16px}
.pf-dash-card{cursor:pointer;transition:border-color .12s}
.pf-dash-card:hover{border-color:var(--brand)}
.pf-dash-card h3{display:flex;align-items:center;gap:8px;margin:0 0 12px}
.pf-dash-stat{display:flex;align-items:baseline;gap:7px;margin-bottom:8px}
.pf-dash-stat b{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1}
.pf-dash-stat span{font-size:12.5px;color:var(--ink-soft)}
.pf-dash-flag{font-size:12.5px;color:var(--amber);font-weight:600;margin:4px 0 0}
.pf-act a{color:var(--brand);font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.pf-account-card.muted{opacity:.6}
.pf-company-card{background:var(--card);border:1px solid var(--line);border-radius:11px;
  transition:border-color .12s}
.pf-company-card:hover{border-color:var(--brand)}
.pf-company-card.warn{border-left:3px solid var(--red)}
.pfc-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 14px;cursor:pointer}
.pfc-name{display:flex;flex-direction:column;min-width:0;flex:1 1 150px}
.pfc-name b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfc-name .pf-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfc-summary{display:flex;align-items:center;gap:6px;flex:0 0 auto;flex-wrap:wrap}
.pfc-summary .pf-multi,.pfc-summary .pf-flag{font-size:10.5px}
.pfc-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto;margin-left:auto}
.pf-company-card.is-open{border-color:var(--brand)}
.pfc-rows{display:flex;flex-direction:column;gap:7px;padding:2px 14px 13px;border-top:1px solid var(--line)}
.pfc-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;font-size:12.5px;padding-top:9px}
.pfc-row > span:first-child{color:var(--ink-soft);font-size:10.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.04em;flex:none;padding-top:1px}
.pfc-row > span:last-child{text-align:right}
@media (max-width:480px){
  .pf-company-grid,.pf-account-grid{grid-template-columns:1fr}
  .pfc-name b,.pfc-name .pf-sub{white-space:normal}
  .pf-danger-row{flex-direction:column;align-items:stretch}
  .btn-danger-outline{width:100%;justify-content:center}
}
.pf-newform{border-color:var(--brand);background:#f9fbfa}
.pf-newform h3{margin-bottom:12px}
.pf-adduser-4{grid-template-columns:repeat(4,1fr)}
.pf-adduser-grid{display:grid;gap:8px;margin-bottom:12px}
.pf-row-actions{display:flex;gap:6px;white-space:nowrap}
.pf-mini-danger{color:var(--red);border-color:#f0d9d1}
.pf-mini-danger:hover{background:#faece7;border-color:var(--red);color:var(--red)}
.pf-reset{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.pf-reset p{font-size:13.5px;line-height:1.55;margin:0 0 10px;color:var(--ink)}
.pf-reset-url{display:block;background:var(--card);border:1px solid var(--line);border-radius:8px;
  padding:10px 12px;font:600 12px ui-monospace,monospace;word-break:break-all;color:var(--brand);margin-bottom:4px}
@media (max-width:760px){
  .pf-hd-actions{width:100%;flex-direction:column;align-items:stretch}
  .pf-hd-actions button{width:100%;justify-content:center}
}
@media (max-width:820px){
  .pf-adduser-4{grid-template-columns:1fr 1fr}
}
@media (max-width:480px){
  .pf-adduser-4,.pf-adduser-grid{grid-template-columns:1fr}
}

/* ---- console: sections, ranked lists, labelled forms -------------------
   A screen that answers two questions -- what moved this month, and how big
   the platform is -- has to say which group is which. Without the rule and
   the caption the two sets of numbers read as one list, and a figure that
   resets on the 1st sits next to one that only ever grows. */
.pf-section{margin-top:26px}
.pf-section-hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  padding-bottom:9px;margin-bottom:12px;border-bottom:1px solid var(--line)}
.pf-section-hd h3{margin:0;font-size:11.5px;font-weight:800;text-transform:uppercase;
  letter-spacing:.08em;color:var(--ink-soft)}
.pf-section-hd > span{font-size:12.5px;color:var(--ink-soft);margin-left:auto}

/* Two panels that read together, side by side while there is room for both. */
.pf-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px;align-items:start}
.pf-split > .pf-panel{margin-top:16px}

/* Ranked bars. One hue: these are magnitudes, not identities, so colour
   carries size and nothing else. Square at the baseline, rounded at the
   data end; the value sits in its own column so the digits line up. */
.pf-rank{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.pf-rank li{display:grid;grid-template-columns:minmax(72px,38%) 1fr auto;align-items:center;gap:12px}
.pf-rank-k{font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-rank-track{height:10px;background:var(--paper);border:1px solid var(--line);border-radius:3px;overflow:hidden}
.pf-rank-track i{display:block;height:100%;background:var(--brand);border-radius:0 4px 4px 0}
.pf-rank-n{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;
  color:var(--ink-soft);min-width:2ch;text-align:right}
.pf-rank-sub{margin:0 0 12px}

/* Creation forms: two columns, and a label that stays put once the field has
   something in it. A placeholder is not a label -- it leaves every filled row
   unlabelled at exactly the moment somebody checks their work. */
.pf-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px 14px;
  padding:15px 16px;background:var(--paper);border:1px solid var(--line);border-radius:10px;margin-bottom:14px}
.pf-fld{display:flex;flex-direction:column;gap:5px;min-width:0}
.pf-fld > span{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft)}
.pf-fld input,.pf-fld select{width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;
  padding:9px 11px;font:500 13.5px Inter,sans-serif;background:var(--card);color:var(--ink)}
.pf-fld input:focus,.pf-fld select:focus{outline:2px solid var(--brand);outline-offset:-1px;border-color:var(--brand)}
.pf-fld input::placeholder{color:#a3ada7}
/* break-word, not break-all: a long subdomain still wraps, but a sentence
   stops being chopped mid-word on a phone. */
.pf-fld-hint{font-style:normal;font-size:11.5px;color:var(--ink-soft);line-height:1.45;overflow-wrap:break-word}
@media (max-width:620px){
  .pf-form-grid{grid-template-columns:1fr;padding:13px}
}

.pf-reconcile{border-top:1px solid var(--line);margin-top:12px;padding-top:11px;color:#8a5a12}

/* Where this account actually signs in, next to the hostname it reserves. */
.pf-signin{font-size:12.5px;color:var(--ink-soft);line-height:1.5;margin:8px 0 0;max-width:70ch}
.pf-signin b{color:var(--ink);font-weight:700}

/* Trade picker inside the console's creation form. */
.pf-trades{padding:14px 16px 16px;background:var(--paper);border:1px solid var(--line);
  border-radius:10px;margin-bottom:14px}
.pf-trades-hd{display:block;font-size:10.5px;font-weight:800;text-transform:uppercase;
  letter-spacing:.05em;color:var(--ink-soft)}
.pf-trade-group{margin-top:13px}
.pf-trade-group h5{margin:0 0 7px;font-size:11px;font-weight:700;letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-soft);opacity:.85}
.pf-trades .picks{margin-top:0}
.pf-opt{font-style:normal;font-weight:600;text-transform:none;letter-spacing:0;opacity:.7}

/* Branded hostname: state first, then the address, then what to do about it. */
.pf-host-url{font:700 15px ui-monospace,monospace;margin:2px 0 0;word-break:break-all}
.pf-host-url a{color:var(--brand);text-decoration:none}
.pf-host-url a:hover{text-decoration:underline}
.pf-host-pill{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
  padding:3px 9px;border-radius:20px;white-space:nowrap}
.pf-host-pill.t-ok{background:#e8f2ea;color:#1f6b4a}
.pf-host-pill.t-wait{background:#fbf0dd;color:#8a5a12}
.pf-host-pill.t-bad{background:#faece7;color:var(--red)}
.pf-host-pill.t-off{background:var(--line);color:var(--ink-soft)}
.pf-host-err{font:600 12px ui-monospace,monospace;background:#fdf1ef;border:1px solid #e9c4bd;
  color:#8a2f1c;border-radius:8px;padding:9px 11px;margin:10px 0 0;word-break:break-word;line-height:1.5}
.pf-host-when{font-size:11.5px;color:var(--ink-soft);margin:9px 0 0}
.pf-host .form-actions{margin-top:12px;flex-wrap:wrap;gap:8px}
.pf-diag{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:9px}
.pf-diag li{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.5}
.pf-diag-mark{flex:none;width:16px;font-weight:800;text-align:center}
.pf-diag li.ok .pf-diag-mark{color:var(--brand)}
.pf-diag li.bad .pf-diag-mark{color:var(--red)}
.pf-diag-body{display:flex;flex-direction:column;min-width:0}
.pf-diag-body em{font-style:normal;font-size:12.5px;color:var(--ink-soft);margin-top:2px}

/* ---- customer-facing: where their own address got to -------------------
   Their words, not Cloudflare's. A customer cannot act on a DNS error and
   would only be alarmed by one; the detail belongs in the console. */
.addr-state{border:1px solid var(--line);border-radius:11px;padding:14px 16px;margin:4px 0 18px;background:var(--paper)}
.addr-state.t-ok{border-color:#bcd9c7;background:#f2f8f4}
.addr-state.t-wait{border-color:#e6c98f;background:#fffdf6}
.addr-state.t-bad{border-color:#e9c4bd;background:#fdf1ef}
.addr-head{display:flex;align-items:center;gap:8px;font-size:14px}
.addr-state.t-ok .addr-head svg{color:var(--brand)}
.addr-state.t-wait .addr-head svg{color:var(--amber)}
.addr-state.t-bad .addr-head svg{color:var(--red)}
.addr-host{font:700 14px ui-monospace,monospace;margin:9px 0 6px;word-break:break-all}
.addr-host a{color:var(--brand);text-decoration:none}
.addr-host a:hover{text-decoration:underline}
.addr-state p{font-size:13px;color:var(--ink-soft);line-height:1.55;margin:0}

/* ---- console: which settings the API has ------------------------------ */
.pf-setup{border-top:1px solid var(--line);padding:13px 0 3px}
.pf-setup:first-of-type{border-top:0;padding-top:4px}
.pf-setup-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.pf-setup-hd b{font-size:14px}
.pf-setup-vars{display:flex;flex-wrap:wrap;gap:6px}
.pf-setup-vars span{font:600 11.5px ui-monospace,monospace;padding:4px 9px;border-radius:7px;
  border:1px solid var(--line);background:var(--paper);white-space:nowrap}
.pf-setup-vars span.on{color:#1f6b4a;border-color:#bcd9c7;background:#f2f8f4}
.pf-setup-vars span.off{color:var(--red);border-color:#e9c4bd;background:#fdf1ef}
.pf-setup-hint{font-size:13px;line-height:1.55;margin:10px 0 0;padding:10px 12px;
  border-radius:8px;background:#fffdf6;border:1px solid #e6c98f;color:#7a4e10}
.pf-setup-hint b{font-family:ui-monospace,monospace;font-size:12.5px}

/* ---- console: what was sent, and whether it went ---------------------- */
.pf-maillog{display:flex;flex-direction:column;margin-top:4px}
.pf-mail-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;
  border-bottom:1px solid var(--line)}
.pf-mail-row:last-child{border-bottom:0}
.pf-mail-when{font:600 11.5px ui-monospace,monospace;color:var(--ink-soft);
  flex:none;width:112px;padding-top:2px}
.pf-mail-main{display:flex;flex-direction:column;flex:1;min-width:0;line-height:1.4}
.pf-mail-main b{font-size:13.5px}
.pf-mail-main > span{font-size:12.5px;color:var(--ink-soft);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.pf-mail-main em{font-style:normal;font:600 11.5px ui-monospace,monospace;
  color:#8a2f1c;margin-top:3px;word-break:break-word}
@media (max-width:600px){
  .pf-mail-row{flex-wrap:wrap;gap:6px 10px}
  .pf-mail-when{width:auto;order:3}
}
.addr-spin{width:12px;height:12px;border-radius:50%;border:2px solid #e6c98f;
  border-top-color:transparent;animation:addr-spin 1s linear infinite;margin-left:2px}
@keyframes addr-spin{to{transform:rotate(360deg)}}
/* A spinner that never stops is a distraction for anyone who reads slowly
   or gets motion-sick; the words already say what is happening. */
@media (prefers-reduced-motion:reduce){.addr-spin{animation:none;opacity:.5}}

/* ---- dashboard: range picker ------------------------------------------
   Presets as rows with a check, custom behind a rule in the footer. Nobody
   fights a calendar grid for "last 30 days". */
.pf-range{position:relative}
.pf-range-btn{display:inline-flex;align-items:center;gap:7px;background:var(--card);
  border:1px solid var(--line);border-radius:8px;padding:7px 11px;cursor:pointer;
  font:600 12.5px Inter,sans-serif;color:var(--ink)}
.pf-range-btn:hover{border-color:var(--brand);color:var(--brand)}
.pf-range-scrim{position:fixed;inset:0;z-index:40}
.pf-range-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:50;width:250px;
  background:var(--card);border:1px solid var(--line);border-radius:11px;padding:5px;
  box-shadow:0 18px 44px rgba(26,43,35,.18)}
.pf-range-menu > button{display:flex;align-items:center;gap:8px;width:100%;background:none;
  border:0;padding:9px 10px;border-radius:7px;cursor:pointer;text-align:left;
  font:600 13px Inter,sans-serif;color:var(--ink)}
.pf-range-menu > button:hover{background:var(--paper)}
.pf-range-menu > button.on{color:var(--brand)}
.pf-range-tick{width:14px;flex:none;font-size:13px;font-weight:800;color:var(--brand)}
.pf-range-custom{border-top:1px solid var(--line);margin-top:5px;padding:11px 10px 6px;
  display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pf-range-custom label{display:flex;flex-direction:column;gap:4px;min-width:0}
.pf-range-custom span{font-size:10px;font-weight:800;text-transform:uppercase;
  letter-spacing:.05em;color:var(--ink-soft)}
.pf-range-custom input{width:100%;min-width:0;border:1px solid var(--line);border-radius:7px;
  padding:7px 8px;font:500 12.5px Inter,sans-serif;background:var(--card);color:var(--ink)}
.pf-range-custom .pf-mini{grid-column:1 / -1;justify-content:center}
.pf-section-hd .pf-range{margin-left:8px}

/* ---- dashboard: the trend ---------------------------------------------- */
@media (min-width:1000px){
  .pf-kpis-period{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (min-width:640px) and (max-width:999px){
  .pf-kpis-period{grid-template-columns:repeat(3,minmax(0,1fr))}
}

.pf-chart{margin-top:16px}
.pf-chart-wrap{position:relative;margin-top:6px;touch-action:pan-y}
.pf-chart-wrap svg{display:block;max-width:100%;cursor:crosshair}
.pf-chart-tick{font:500 10.5px Inter,sans-serif;fill:var(--ink-soft)}
.pf-chart-proj{font:700 11px Inter,sans-serif;fill:var(--ink-soft)}
.pf-chart-tabs{display:flex;gap:3px;background:var(--paper);border:1px solid var(--line);
  border-radius:9px;padding:3px}
.pf-chart-tabs button{border:0;background:none;padding:6px 12px;border-radius:6px;cursor:pointer;
  font:600 12.5px Inter,sans-serif;color:var(--ink-soft)}
.pf-chart-tabs button.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
/* Value leads, date follows: the reader already knows which line they are on. */
.pf-chart-tip{position:absolute;top:2px;transform:translateX(-50%);pointer-events:none;
  background:var(--ink);color:#fff;border-radius:8px;padding:6px 10px;
  display:flex;flex-direction:column;line-height:1.3;white-space:nowrap;
  box-shadow:0 8px 22px rgba(26,43,35,.25)}
.pf-chart-tip b{font-size:13.5px;font-weight:800}
.pf-chart-tip span{font-size:11px;opacity:.72}
`;
