// The account switcher, once somebody holds more than a handful of seats.
//
// A flat list with the relationship under each name is right at two or three
// seats and is what the drawer does. At twenty-five it is about 1,100px of
// two-line buttons below every nav item, Sign out pushed off the screen, in
// whatever order the API returned -- and seatDescription reads identically on
// twenty-four of the rows, so the line that WAS the fix distinguishes nothing at
// exactly the point where distinguishing matters most.
//
// Twenty-five is not hypothetical: a subcontractor is on many general
// contractors' rosters by definition, and the send-my-documents loop exists to
// put them on more.
//
// What this covers:
//
//   THE THRESHOLD IS THE DESIGN. A fix for the twenty-five case that taxes the
//   two case has made the common thing worse to improve the rare one.
//
//   ORDERED BY WHAT IS WAITING. Alphabetical alone is the order that makes
//   somebody read all twenty-five.
//
//   NO SEAT EVER VANISHES. A seat that renders nowhere is a place the person
//   holds a seat and cannot reach.
//
//   node --no-warnings scripts/switcher-test.mjs

import { SWITCHER_THRESHOLD, usePanel, SEAT_GROUPS, seatGroup, groupSeats, matchSeat,
  seatDescription } from "../shared/handover.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

console.log("\n-- the threshold --");
{
  ck("one seat needs no panel", usePanel(1) === false);
  ck("nor does a handful", usePanel(SWITCHER_THRESHOLD) === false, String(SWITCHER_THRESHOLD));
  ck("one more does", usePanel(SWITCHER_THRESHOLD + 1) === true);
  ck("and twenty-five certainly does", usePanel(25) === true);
  // The common case must not pay for the rare one.
  ck("the threshold leaves the ordinary case alone", SWITCHER_THRESHOLD >= 3,
    String(SWITCHER_THRESHOLD));
  ck("and is not so high that the panel never appears", SWITCHER_THRESHOLD <= 10,
    String(SWITCHER_THRESHOLD));
  ck("none is not a panel either", usePanel(0) === false);
}

console.log("\n-- grouped by the relationship, not the role name --");
{
  ck("a contractor seat is a client", seatGroup("contractor") === "clients");
  ck("an admin seat is one you work in", seatGroup("admin") === "own");
  ck("so is a project manager seat", seatGroup("pm") === "own");
  ck("an owner seat is managed for you", seatGroup("owner") === "managed");
  ck("and so is a tenant seat", seatGroup("tenant") === "managed");
  // A seat that renders nowhere is worse than one in the wrong group.
  ck("a role nobody has heard of still lands somewhere",
    SEAT_GROUPS.some((g) => g.key === seatGroup("inspector")), seatGroup("inspector"));
  ck("every group has a heading somebody could read",
    SEAT_GROUPS.every((g) => g.heading && /^[A-Z]/.test(g.heading)),
    SEAT_GROUPS.map((g) => g.heading).join(" / "));
  ck("clients come first, because that is the common switch",
    SEAT_GROUPS[0].key === "clients");
}

console.log("\n-- nothing is lost on the way through --");
{
  const seats = [
    { accountId: "a1", name: "Alder", role: "contractor", waiting: 0 },
    { accountId: "a2", name: "Birch", role: "contractor", waiting: 3 },
    { accountId: "a3", name: "Cedar", role: "admin", waiting: 0 },
    { accountId: "a4", name: "Dover", role: "tenant", waiting: 0 },
    { accountId: "a5", name: "Elm", role: "inspector", waiting: 0 },
  ];
  const groups = groupSeats(seats);
  const flat = groups.flatMap((g) => g.seats);
  ck("every seat comes out the other side", flat.length === seats.length,
    `${flat.length} of ${seats.length}`);
  ck("each exactly once",
    new Set(flat.map((s) => s.accountId)).size === seats.length);
  ck("the odd role included", flat.some((s) => s.accountId === "a5"));

  ck("empty groups are dropped rather than shown empty",
    groups.every((g) => g.seats.length > 0), JSON.stringify(groups.map((g) => g.seats.length)));
  const onlyClients = groupSeats(seats.filter((s) => s.role === "contractor"));
  ck("a subcontractor with only client seats sees one heading",
    onlyClients.length === 1 && onlyClients[0].key === "clients",
    String(onlyClients.length));
  ck("and no seats at all is no headings", groupSeats([]).length === 0);
  ck("nor does it throw on nothing at all", groupSeats().length === 0);
}

console.log("\n-- ordered by what is waiting on you --");
{
  const seats = [
    { accountId: "a1", name: "Alder", role: "contractor", waiting: 0 },
    { accountId: "a2", name: "Zephyr", role: "contractor", waiting: 4 },
    { accountId: "a3", name: "Birch", role: "contractor", waiting: 1 },
    { accountId: "a4", name: "Cedar", role: "contractor", waiting: 0 },
  ];
  const order = groupSeats(seats)[0].seats.map((s) => s.name);
  ck("the one with four requests is first", order[0] === "Zephyr", order.join(","));
  ck("then the one with one", order[1] === "Birch", order.join(","));
  ck("and the quiet ones fall alphabetically", order[2] === "Alder" && order[3] === "Cedar",
    order.join(","));
  // The whole reason this is not alphabetical.
  ck("a name late in the alphabet is not buried by it",
    order.indexOf("Zephyr") < order.indexOf("Alder"));
  ck("a missing count is treated as none, not as NaN",
    groupSeats([{ accountId: "x", name: "Ash", role: "contractor" }])[0].seats[0].name === "Ash");
}

console.log("\n-- searching your own seats, and only your own --");
{
  const seat = { accountId: "a1", name: "Cascade Management", subdomain: "cascade",
    role: "contractor", waiting: 0 };
  ck("an empty query matches everything", matchSeat(seat, "") === true);
  ck("so does whitespace", matchSeat(seat, "   ") === true);
  ck("a name fragment matches", matchSeat(seat, "casc") === true);
  ck("case does not matter", matchSeat(seat, "MANAGEMENT") === true);
  ck("a fragment from the middle matches", matchSeat(seat, "manage") === true);
  // Somebody has the subdomain in their address bar and on their invoices,
  // and often remembers it instead of the trading name.
  ck("the subdomain matches too", matchSeat(seat, "cascade") === true);
  ck("something else does not", matchSeat(seat, "outerhome") === false);
  ck("and a missing subdomain does not throw",
    matchSeat({ name: "Nameless", role: "admin" }, "name") === true);
  ck("nor a seat with nothing on it at all", matchSeat({}, "x") === false);
}

console.log("\n-- the relationship line still says the relationship --");
{
  // The heading carries it in the panel, and the line carries it in the flat
  // list. Both readings have to stay true.
  ck("a contractor seat", seatDescription("contractor") === "you are their subcontractor");
  ck("an owner seat", seatDescription("owner") === "you own a building they run");
  ck("a tenant seat", seatDescription("tenant") === "you rent from them");
  ck("and a staff seat falls back to the role label",
    seatDescription("pm", "Project manager") === "you are project manager there");
  ck("never blank", seatDescription("weird-new-role").length > 0,
    seatDescription("weird-new-role"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
