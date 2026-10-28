// The SubSub Passport as an Apple Wallet card.
//
// What goes into pass.json. Field and key names are Apple's PassKit format, as
// the passkit-generator 3.5.0 schemas spell them (generic style, PassFieldContent
// {key, label, value}, barcodes [{format, message, messageEncoding, altText}]),
// not written from memory.
//
// THE CARD CARRIES NO STATUS, and that is the decision everything else follows.
// A Wallet pass is a copy: it sits on a phone for years and changes only if we
// push an update to it. "SubSub Verified" or "License active" printed on it is
// the decal's problem in a smaller format -- a claim that outlives the facts
// behind it. So the card says who the company is and how long they have been
// here, and the QR code opens the live Passport, which is where whether their
// license and insurance are current is answered, on the day it is scanned.
// The license NUMBER is shown because the public page shows it; its check is not.
//
// The serial number is the company, so adding the card twice replaces it rather
// than leaving two, and a card added before a rename is the same card.

import { passportUrl } from "./passport.js";

export const WALLET_PASS_TYPE_HINT = "pass.work.subsub.passport";
export const WALLET_COLORS = {
  background: "rgb(16, 53, 40)", // SubSub forest, #103528
  foreground: "rgb(255, 255, 255)",
  label: "rgb(227, 155, 50)", // SubSub gold, #E39B32
};

// Every one of these has to be set, or no pass can be signed: the two
// identifiers name the pass type, the certificate and its key sign it, and
// Apple's WWDR intermediate is what lets a phone trust the certificate.
export const WALLET_SETTINGS = ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "APPLE_PASS_CERT",
  "APPLE_PASS_KEY", "APPLE_WWDR_CERT"];

export const walletConfigured = (env) => WALLET_SETTINGS.every((k) => String(env?.[k] || "").trim());

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Mar 2026" off a date or a timestamp. Read off the text, never through Date,
// so no timezone can move it into the month before.
export function memberSinceText(when) {
  const m = /^(\d{4})-(\d{2})/.exec(String(when || ""));
  if (!m) return null;
  const mon = Number(m[2]);
  return mon >= 1 && mon <= 12 ? `${MONTHS[mon - 1]} ${m[1]}` : null;
}

// The earliest of the dates that say a company was here. Blank ones are
// skipped; text dates compare correctly as long as each is cut to its day,
// which also keeps an ISO "T" from sorting after a CURRENT_TIMESTAMP space.
export function earliestDay(...dates) {
  const days = dates.map((d) => String(d || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.length ? days.sort()[0] : null;
}

// Three trades and a count: a field on a card is one line, and a list that
// runs off the edge says less than "and 4 more".
export function tradesText(trades = []) {
  const labels = trades.map((t) => t?.label || t).filter(Boolean);
  if (!labels.length) return null;
  const head = labels.slice(0, 3).join(", ");
  return labels.length > 3 ? `${head} +${labels.length - 3} more` : head;
}

const field = (key, label, value) => (value ? [{ key, label, value: String(value) }] : []);

// pass.json for one Passport. `view` is publicPassport()'s shape, so the card
// can only ever say what the public page says. A field with nothing in it is
// left off rather than drawn empty.
export function walletPassJson({ view, companyId, memberSince, passTypeId, teamId }) {
  // No contact on the card, for the reason the public page has none: the way
  // on from a Passport is connecting on SubSub, not ringing them.
  const place = view.place || [view.city, view.state].filter(Boolean).join(", ");
  const url = passportUrl(view.slug);
  return {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    teamIdentifier: teamId,
    serialNumber: `passport-${companyId}`,
    organizationName: "SubSub",
    description: `SubSub Passport for ${view.name}`,
    logoText: "Passport",
    backgroundColor: WALLET_COLORS.background,
    foregroundColor: WALLET_COLORS.foreground,
    labelColor: WALLET_COLORS.label,
    generic: {
      headerFields: field("since", "MEMBER SINCE", memberSinceText(memberSince)),
      primaryFields: field("name", "CONTRACTOR", view.name),
      secondaryFields: [
        ...field("trades", "TRADES", tradesText(view.trades)),
        ...field("place", "BASED IN", place),
      ],
      auxiliaryFields: [
        ...field("years", "IN BUSINESS", view.years),
      ],
      backFields: [
        ...field("license", "License number", view.license?.number),
        ...field("ubi", "UBI", view.ubi),
        { key: "link", label: "Passport", value: url },
        { key: "live", label: "Is this current?",
          value: "Scan the code or open the link to see their license and insurance checked today. " +
            "This card does not show either, because a card cannot tell you when they lapse." },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: url, messageEncoding: "iso-8859-1",
      altText: "Scan to check them live" }],
  };
}
