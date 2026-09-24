// A QR code as one SVG path.
//
// The encoder is qrcode-generator: MIT, no dependencies, and old enough to
// be boring, which is what you want from Reed-Solomon error correction.
// Writing that by hand produces a code that scans wrong rather than not at
// all, and the failure happens on somebody's phone in a car park.
//
// What is here is only the part worth owning: turning the module grid into
// a single <path>, so the code renders as vector (crisp on a retina screen,
// crisp on a printed van door, no canvas, no image request).
import qrcode from "qrcode-generator";

// Error correction level M -- about 15% of the code can be obscured and it
// still reads. H would survive a logo in the middle but makes the modules
// smaller, and these get printed and photographed in poor light. The
// payload is a short URL, so even M leaves plenty of room.
const ECC = "M";
// Four modules of clear space on every side. The spec requires it and
// scanners genuinely fail without it -- it is the commonest reason a
// hand-rolled QR does not work.
const QUIET = 4;

// Returns { size, path } where `size` is the width of the whole code in
// modules INCLUDING the quiet zone, so an SVG viewBox is "0 0 size size".
export function qrPath(text) {
  const qr = qrcode(0, ECC);        // 0 = pick the smallest version that fits
  qr.addData(String(text ?? ""));
  qr.make();
  const n = qr.getModuleCount();
  const parts = [];
  for (let r = 0; r < n; r++) {
    // Runs rather than one rect per module: a 33x33 code is up to 1,089
    // path segments drawn one at a time, and the horizontal runs collapse
    // most of them into a handful.
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const on = col < n && qr.isDark(r, col);
      if (on && start < 0) start = col;
      if (!on && start >= 0) {
        parts.push(`M${start + QUIET} ${r + QUIET}h${col - start}v1h-${col - start}z`);
        start = -1;
      }
    }
  }
  return { size: n + QUIET * 2, path: parts.join("") };
}
