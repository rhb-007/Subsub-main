// Theme: System, Dark or Light, remembered on this device only.
//
// Per device rather than on the account, for the reason an iPad's own setting
// is: a person can want dark on the phone in bed and light on the tablet on a
// roof. "System" follows the device and changes with it while the page is open.
// Storage can be missing (private windows) and every read and write survives it.
import { useEffect, useState } from "react";

export const THEME_KEY = "ss_theme";
export const THEMES = ["system", "dark", "light"];

export function readThemePref() {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : "system";
  } catch { return "system"; }
}

function writeThemePref(v) {
  try { window.localStorage.setItem(THEME_KEY, v); } catch { /* not remembered, still applied */ }
}

const prefersDark = () => {
  try { return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches; } catch { return false; }
};

export const resolveTheme = (pref, systemDark) => (pref === "system" ? (systemDark ? "dark" : "light") : pref);

// Applies the theme to the page while `active` (signed in); otherwise the page
// is light, because what is shown before sign-in wears a company's own colors.
export function useTheme(active) {
  const [pref, setPrefState] = useState(readThemePref);
  const [systemDark, setSystemDark] = useState(prefersDark);
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia?.("(prefers-color-scheme: dark)"); } catch { mq = null; }
    if (!mq) return undefined;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const theme = active ? resolveTheme(pref, systemDark) : "light";
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.dataset.theme = "dark";
    else delete root.dataset.theme;
  }, [theme]);
  const setPref = (v) => { if (!THEMES.includes(v)) return; setPrefState(v); writeThemePref(v); };
  return { pref, setPref, theme };
}
