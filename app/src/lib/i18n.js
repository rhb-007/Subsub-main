// Spanish, for the people who do the work.
//
// tt("English") returns the Spanish when the language is Spanish and a
// translation exists, and the English otherwise -- so a string nobody has
// translated yet still reads, in English, rather than as a key or a blank.
// The English text IS the key: a later edit to the English drops back to
// English until the translation follows, which test:i18n reports by name.
//
// The language is held here, set by the app before it renders
// (setLang), because tt() is called from a few hundred places and threading
// it through props would touch every one of them. Every render after a change
// reads the new value, because the change is a state change at the top.
import { useEffect, useState } from "react";
import ES from "../i18n/es.js";

export const LANGS = ["en", "es"];
let LANG = "en";
export const setLang = (l) => { LANG = l === "es" ? "es" : "en"; };
export const getLang = () => LANG;

// {name} placeholders are filled from vars, in either language.
export function tt(en, vars) {
  let s = LANG === "es" && Object.prototype.hasOwnProperty.call(ES, en) ? ES[en] : en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Dates and times follow the language too; English keeps the device's own
// locale, as before.
export const uiLocale = () => (LANG === "es" ? "es-US" : undefined);

// The choice, per device like the theme: "es" or "en", remembered. With
// nothing chosen, a device set to Spanish starts in Spanish.
export const LANG_KEY = "ss_lang";
const deviceLang = () => {
  try { return /^es\b/i.test(navigator.language || "") ? "es" : "en"; } catch { return "en"; }
};
export function readLangPref() {
  try { const v = window.localStorage.getItem(LANG_KEY); if (LANGS.includes(v)) return v; } catch { /* */ }
  return deviceLang();
}
export function useLang() {
  const [lang, setState] = useState(readLangPref);
  const set = (v) => {
    if (!LANGS.includes(v)) return;
    setState(v);
    try { window.localStorage.setItem(LANG_KEY, v); } catch { /* still applied */ }
  };
  return { lang, setLang: set };
}
// The page's own lang attribute follows what is drawn, so a screen reader
// pronounces it in the right language.
export function useDocLang(lang) {
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* */ } }, [lang]);
}
