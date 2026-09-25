// Real auth. Configured via Vite env vars — see app/.env.example. Both are
// meant to be public (the anon key is safe to ship to the browser; Supabase
// enforces access with Row Level Security / your API's own checks, not by
// keeping this key secret), so there's no risk in them ending up in the
// built bundle.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnabled = !!(url && anonKey);

// Only constructed when both env vars are actually set, so local dev without
// them falls back to the dev-stub auth (see lib/api.js) instead of crashing.
// The session persistence options are spelled out rather than left to
// defaults, because they are the difference between closing a tab and being
// signed out. A session lives in localStorage and the access token refreshes
// itself in the background; nothing here expires a session for being away
// from the browser, which is a thing to do deliberately (and per-account) if
// it is ever wanted, not by accident.
export const supabase = supabaseEnabled
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Read the tokens Supabase leaves in the URL after a confirmation or
        // reset link, then take them out of the address bar.
        detectSessionInUrl: true,
      },
    })
  : null;

// Is there a session in this browser, answered synchronously?
//
// supabase.auth.getSession() is a promise -- it waits for the client to
// finish reading storage -- so it cannot tell the first render anything, and
// the first render is exactly where the question matters: draw the sign-in
// screen, or wait and draw the app. Guessing "signed out" and correcting a
// second later is what put a sign-in form in front of people who were
// already signed in, and they did the sensible thing and signed in again.
//
// So: read the same storage the library reads. supabase-js v2 keeps its
// session under sb-<project ref>-auth-token. The key is matched by shape
// rather than rebuilt from the URL, so it survives the ref changing and a
// client configured with its own storageKey.
//
// A true answer here is "there is something worth waiting for", not proof of
// a valid session -- an expired one still ends at the sign-in screen, just
// without the flash on the way.
export function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
    }
  } catch { /* private window, or site data blocked -- assume nothing is kept */ }
  return false;
}
