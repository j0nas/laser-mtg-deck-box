import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // Relative base so the built bundle works from any path — standalone at "/" and embedded under a
  // subdirectory. The dev server ignores a relative base and still serves at "/".
  base: "./",
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  // Vitest config, bundled with vite-plus and run via `vp test`. All tests are pure Node — they
  // exercise the parameter/panel-geometry math, not the DOM.
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Inline vite-plus so its `vite-plus/test` re-export (`export * from "vitest"`) is transformed
    // and resolves to the pool's ACTIVE vitest instance. Without this, `@types/node` in the peer
    // graph spawns a second vite-plus/vitest variant, `describe` binds to the inactive runner, and
    // every test file throws "Cannot read properties of undefined (reading 'config')" at collection.
    // Still required on vite-plus 0.2.4 (latest as of 2026-07-11): the two peer-variants persist
    // and `pnpm dedupe` cannot merge them (their peer sets genuinely differ).
    server: { deps: { inline: ["vite-plus"] } },
  },
});
