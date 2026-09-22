// One rule, and the reason for it: `needsEmail`, `email` and `setEmail` were
// read by the tenant sign-up page and never declared, so the page threw on
// render and every tenant following their invite got a blank screen. Nothing
// in the build catches that -- esbuild only checks syntax -- and it shipped.
//
// no-undef is the check that would have caught it in a second. The rest of
// ESLint's opinions are deliberately left off: this is a guard against a
// class of bug that has already cost a release, not a style argument.
//
// no-undef alone turned out to be half the net. It reads `<Foo />` as JSX
// rather than as a reference to Foo, so an icon used and never imported
// passed lint and then threw on render -- the same blank screen, by the
// same route, found by hand again. react/jsx-no-undef is the half that
// covers components, and is here for that and nothing else.
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  { ignores: ["dist/**", ".wrangler/**", "node_modules/**"] },
  // The file's react-hooks/exhaustive-deps directives look unused while that
  // rule is off, which is not worth a warning apiece.
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Registered so the file's existing `eslint-disable-next-line
    // react-hooks/exhaustive-deps` comments name a rule that exists. Its
    // rules stay off: turning them on is a separate piece of work with a
    // long tail, and this config is here for one bug.
    plugins: { "react-hooks": reactHooks, react },
    rules: { "no-undef": "error", "react/jsx-no-undef": "error" },
  },
  {
    files: ["worker/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // The browser globals are for the test scripts: what they pass to
      // page.evaluate() is a function that runs in the browser, in a file
      // that otherwise runs in Node.
      globals: { ...globals.node, ...globals.worker, ...globals.browser, crypto: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
];
