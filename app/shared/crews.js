// A company's crews and the days they cannot work.
//
// Availability is set per crew: a firm with two crews can send one on Tuesday
// while the other is on holiday. So "is this company free on Tuesday" is not
// a column, it is a question about every crew: free if at least one crew that
// is taking work has not marked Tuesday off.
//
// Two places asked it differently. The screens read the crews (freeCrews in
// App.tsx), and the Worker's auto-scheduler read companies.unavailable_days,
// a company-wide list from before crews existed that no screen writes any
// more. So a contractor who marked every crew off on a Tuesday was still
// auto-booked for that Tuesday. offDays is the one answer the Worker reads now.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CREWS = 20;
export const MAX_MEMBERS = 50;
export const MAX_OFF_DAYS = 400;

const text = (v, n) => String(v ?? "").trim().slice(0, n);

// What a crew list may be stored as. These land on the shared companies row,
// which every account that hires them reads, so the shape is checked on the
// way in rather than trusted: a crew with no members array white-screens the
// availability grid on somebody else's screen. Returns null for anything that
// is not a list at all, so the caller can refuse it by name.
export function validCrews(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const c of raw.slice(0, MAX_CREWS)) {
    if (!c || typeof c !== "object") continue;
    const members = (Array.isArray(c.members) ? c.members : [])
      .slice(0, MAX_MEMBERS)
      .map((m) => ({ name: text(m?.name, 80), role: text(m?.role, 80) }))
      .filter((m) => m.name);
    const name = text(c.name, 80);
    if (!name || !members.length) continue;
    let id = text(c.id, 40) || `c${out.length + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const days = [...new Set((Array.isArray(c.unavailableDays) ? c.unavailableDays : [])
      .map(String).filter((d) => DAY.test(d)))].sort().slice(-MAX_OFF_DAYS);
    out.push({ id, name, available: c.available !== false, unavailableDays: days, members });
  }
  return out;
}

// The days this company cannot be booked: the old company-wide list, plus
// every day on which no crew that is taking work is free.
//
// With no crews at all only the company-wide list counts. Treating "no crews"
// as "never free" would stop auto-scheduling for every contractor who has not
// filled in My Crews, which is most of them, and the hiring side's screen says
// so in words rather than in a refusal.
//
// allPaused is the one case a list of dates cannot say: every crew has been
// switched off, so the company is not taking work on any day.
export function offDays({ unavailableDays = [], crews = [] } = {}) {
  const base = (Array.isArray(unavailableDays) ? unavailableDays : []).filter((d) => DAY.test(String(d)));
  const list = Array.isArray(crews) ? crews : [];
  if (!list.length) return { days: [...new Set(base)].sort(), allPaused: false };
  const working = list.filter((c) => c && c.available !== false);
  if (!working.length) return { days: [...new Set(base)].sort(), allPaused: true };
  // A day is off only when EVERY working crew has it off.
  const sets = working.map((c) => new Set((c.unavailableDays || []).filter((d) => DAY.test(String(d)))));
  const allOff = [...sets[0]].filter((d) => sets.every((s) => s.has(d)));
  return { days: [...new Set([...base, ...allOff])].sort(), allPaused: false };
}

export const isOffOn = (company, day) => {
  const o = offDays(company);
  return o.allPaused || o.days.includes(day);
};
