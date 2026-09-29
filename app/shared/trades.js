// The trades, once.
//
// There were two records of this list and nothing comparing them: TRADE_IDS in
// the Worker (ids, for validation) and CATEGORIES in App.tsx (ids, labels and
// a lucide icon each). They agreed by luck and by whoever last edited both.
//
// What forced the merge was the Zapier app. A dropdown of trades needs a LABEL
// as well as an id, and the only place a label existed was inside the browser
// bundle, which the Worker cannot import -- so serving one would have meant a
// third copy, in the one place where being wrong is least visible: a field
// somebody picks from once while setting an integration up.
//
// Ids and labels only. The icons stay in App.tsx and are attached by id,
// because a lucide component cannot cross into a Worker and a trade with no
// icon is a cosmetic problem rather than a wrong one. A test pins that every
// trade here has an icon there, so adding one cannot ship a blank square.
//
// ORDER IS MEANINGFUL and it is not alphabetical: it is the order the chip
// grid reads in, grouped by the part of a building somebody is thinking about.
// Anything rendering this list renders it in this order.
export const TRADES = [
  // Exterior
  { id: "roofing", label: "Roofing" },
  { id: "siding", label: "Siding" },
  { id: "windows_doors", label: "Windows / Doors" },
  { id: "gutters", label: "Gutters" },
  { id: "soffit_fascia", label: "Soffit / Fascia" },
  { id: "coping", label: "Coping" },
  { id: "masonry", label: "Masonry / Brick" },
  { id: "solar", label: "Solar" },
  // Structure & site
  { id: "framing", label: "Framing" },
  { id: "concrete", label: "Concrete" },
  { id: "foundation", label: "Foundation" },
  { id: "excavation", label: "Excavation / Grading" },
  { id: "demolition", label: "Demolition" },
  // Mechanical, electrical, plumbing
  { id: "electrical", label: "Electrical" },
  { id: "plumbing", label: "Plumbing" },
  { id: "hvac", label: "HVAC" },
  { id: "insulation", label: "Insulation" },
  // Interior finishes
  { id: "drywall", label: "Drywall / Sheetrock" },
  { id: "painting", label: "Painting" },
  { id: "flooring", label: "Flooring / Carpet" },
  { id: "tile_stone", label: "Tile / Stone" },
  { id: "cabinets_counters", label: "Cabinets / Countertops" },
  { id: "trim_carpentry", label: "Finish Carpentry" },
  // Outdoor
  { id: "deck_fence", label: "Deck / Fence" },
  { id: "hardscaping", label: "Hardscaping" },
  { id: "landscaping", label: "Landscaping" },
  // Specialty
  { id: "garage_doors", label: "Garage Doors" },
  { id: "restoration", label: "Water / Fire Restoration" },
  { id: "cleaning", label: "Final Clean" },
];

export const TRADE_IDS = new Set(TRADES.map((t) => t.id));
export const tradeLabel = (id) =>
  TRADES.find((t) => t.id === id)?.label || String(id ?? "");
