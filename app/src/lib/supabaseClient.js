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
