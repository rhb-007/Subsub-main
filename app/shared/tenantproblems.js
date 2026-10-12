// WHAT A TENANT CAN SAY IS WRONG, in their words, with the trade each one
// means behind it.
//
// Moved out of App.tsx so the Worker can read it too: the photo draft asks
// the model to pick one of these labels, and a model choosing from a list the
// server had never seen would be the browser's word for what is allowed. One
// list, imported by both.

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
export const TENANT_PROBLEMS = [
  // ---- Get out and call emergency services ----
  // Listed first so they are the first thing a search turns up, and given
  // their own group so nobody scrolling for a dripping tap has to read them.
  // Their severity lives in shared/emergency.js, next to the Worker's copy
  // of the same decision.
  { g: "Emergency", trade: null, where: "both", label: "There's a fire, or I can smell smoke" },
  { g: "Emergency", trade: null, where: "both", label: "I can smell gas" },
  { g: "Emergency", trade: "electrical", where: "both", label: "An outlet or switch is sparking" },
  { g: "Emergency", trade: null, where: "both", label: "The carbon monoxide alarm is going off" },
  { g: "Emergency", trade: null, where: "both", label: "Someone is trapped in the elevator" },
  { g: "Emergency", trade: "plumbing", where: "both", label: "Water is flooding in" },
  { g: "Emergency", trade: "plumbing", where: "both", label: "A pipe has burst" },
  { g: "Emergency", trade: "plumbing", where: "both", label: "My toilet is overflowing" },
  { g: "Emergency", trade: "hvac", where: "both", label: "It's dangerously cold in here" },
  { g: "Emergency", trade: "hvac", where: "both", label: "It's dangerously hot in here" },
  { g: "Emergency", trade: "electrical", where: "both", label: "I have no power at all" },

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
export const tenantGroups = (where) => {
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
export const tenantWhere = (accountKind) => accountKind === "portfolio_manager" ? "office" : "home";

