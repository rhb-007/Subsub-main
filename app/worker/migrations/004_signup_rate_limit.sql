-- Migration 004 — rate limiting for the public, unauthenticated endpoints.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/004_signup_rate_limit.sql
--
-- Two endpoints are reachable with no credentials at all: POST /api/signup,
-- which creates an account, and POST /api/apply/:subdomain, which creates a
-- company and an engagement. Both write rows, so both need a ceiling.
--
-- A Worker keeps no state between requests, so the counter lives in D1. One
-- row per (bucket, window); the window is a truncated timestamp, so rows age
-- out on their own and a sweep is optional rather than required.
--
-- This is a floor, not a wall: it stops a script hammering one endpoint, and
-- it does not stop a distributed flood. Put Cloudflare's own rate limiting
-- rules in front of these two paths as well, and add a CAPTCHA (Turnstile is
-- free and on the same platform) before linking the signup page publicly.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket   TEXT NOT NULL,          -- e.g. "signup:203.0.113.7"
  window   TEXT NOT NULL,          -- truncated ISO timestamp
  hits     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window);
