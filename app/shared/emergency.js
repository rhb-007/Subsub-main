// Which reported problems are emergencies, and which kind.
//
// One file, imported by the browser and by the Worker, because the two
// cannot be allowed to disagree. The browser needs it to decide whether to
// put a call-911 notice in front of somebody; the Worker needs it to decide
// whether a report may dispatch a contractor on its own. If the Worker
// simply believed the severity the browser sent, a tenant could mark their
// dripping tap an emergency and call somebody out at the account's expense.
//
// Two levels, and the difference between them is who can help.
//
//   "911"    Nobody at this company can do anything about it and delay is
//            dangerous. Fire, gas, live electricity, carbon monoxide,
//            somebody shut in a lift. The app's job is to get out of the
//            way and say so.
//
//   "urgent" Damage or danger that is getting worse by the hour and wants a
//            contractor tonight rather than on Tuesday. Water coming in,
//            no heat in winter, a door that will not lock.
//
// Anything not listed here is ordinary work, which is nearly all of it.
// The list stays short on purpose: an emergency section that fills up with
// dripping taps is one nobody reads.
export const EMERGENCY = {
  // ---- get out, and call emergency services ----
  "There's a fire, or I can smell smoke": "911",
  "I can smell gas": "911",
  "An outlet or switch is sparking": "911",
  "There's a burning smell from an outlet": "911",
  "The carbon monoxide alarm is going off": "911",
  "Someone is trapped in the elevator": "911",

  // ---- tonight, not Tuesday ----
  "Water is flooding in": "urgent",
  "A pipe has burst": "urgent",
  "My toilet is overflowing": "urgent",
  "A pipe is leaking": "urgent",
  "I have no water at all": "urgent",
  "I have no power at all": "urgent",
  "I have no heat": "urgent",
  "It's dangerously cold in here": "urgent",
  "It's dangerously hot in here": "urgent",
  "Water is dripping from the ceiling": "urgent",
  "The roof is leaking": "urgent",
  "My door won't lock": "urgent",
  "There's broken glass": "urgent",
};

export const severityOf = (label) => EMERGENCY[String(label || "").trim()] || null;
export const is911 = (label) => severityOf(label) === "911";
export const isUrgent = (label) => severityOf(label) === "urgent";
// Sorting: life safety first, then urgent, then everything else.
export const SEVERITY_RANK = { "911": 0, urgent: 1 };
export const severityRank = (sev) => SEVERITY_RANK[sev] ?? 2;
