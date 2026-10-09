// Bundled by app/scripts/build-tools.mjs into the handyman-limit pages, so the
// calculator runs the same handycap.js figures and sentences the app does.
import { handyVerdict, asOfLabel } from "../../app/shared/handytool.js";
import { TRADES } from "../../app/shared/trades.js";
window.SSCALC = { handyVerdict, asOfLabel, TRADES };
