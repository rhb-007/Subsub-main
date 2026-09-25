import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Which build is this?
//
// "Is it deployed yet?" has cost several rounds of guessing, because there
// was no way to tell from the outside: the app looked identical whether the
// browser had this morning's bundle or last week's. The answer belongs on
// the page, in the footer, where anybody can read it out.
//
// Cloudflare Pages hands the commit in CF_PAGES_COMMIT_SHA; git answers when
// building by hand; and if neither can, the stamp says so rather than
// inventing a number.
const commit = (() => {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
})();
const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(`${commit} · ${built}`),
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
