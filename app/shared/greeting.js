// The line at the top of every dashboard.
//
// "Good to see you" was the same sentence at 6am and 9pm, which is the sort
// of thing nobody complains about and nobody reads twice either. A greeting
// that knows the hour is the cheapest way for a screen to feel like it is
// running rather than stored.
//
// Split out of App.tsx so the Worker's tests and the browser read one rule.
// There is no timezone here on purpose: this is asked with the reader's OWN
// clock, because "morning" is a fact about where they are standing and the
// account's registered address is not where a project manager opens a laptop.

export const GREETINGS = [
  { until: 5, text: "Still up" },        // 00:00-04:59
  { until: 12, text: "Good morning" },   // 05:00-11:59
  { until: 17, text: "Good afternoon" }, // 12:00-16:59
  { until: 22, text: "Good evening" },   // 17:00-21:59
  { until: 24, text: "Good evening" },   // 22:00-23:59
];

// `hour` is 0-23. Anything outside that is somebody's clock being wrong, and
// a greeting is not the place to argue about it -- fall back to the neutral
// one rather than throwing on a dashboard.
export function greetingFor(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h) || h < 0 || h > 23) return "Good to see you";
  return (GREETINGS.find((g) => h < g.until) || GREETINGS[GREETINGS.length - 1]).text;
}

// Open-Meteo's WMO codes, in the words somebody standing outside would use.
// Grouped rather than enumerated: a roofer needs "raining" and "not raining",
// and nineteen shades of drizzle is a weather app, which this is not.
const WEATHER = [
  [[0], "Clear"], [[1, 2], "Mostly sunny"], [[3], "Overcast"],
  [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"],
  [[95, 96, 99], "Thunderstorms"],
];

export function weatherLabel(code) {
  const n = Number(code);
  const hit = WEATHER.find(([codes]) => codes.includes(n));
  return hit ? hit[1] : null;
}

// Whether it is worth saying at all. A temperature with no place is a number
// from nowhere, and a code we cannot name is a blank chip -- both are worse
// than showing nothing, because the point of this is a glance.
export function weatherLine(w) {
  if (!w || typeof w.tempF !== "number" || !Number.isFinite(w.tempF)) return null;
  const label = weatherLabel(w.code);
  if (!label) return null;
  return `${Math.round(w.tempF)}°F · ${label}`;
}

// How long a cached reading stays good. Weather moves, but not in the time it
// takes somebody to reload a dashboard, and every miss is an outbound request
// on somebody else's rate limit.
export const WEATHER_TTL_MIN = 30;
