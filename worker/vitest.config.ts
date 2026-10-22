import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        // Isolated (per-test stacked) storage fails on Windows during
        // teardown ("Isolated storage failed" / EBUSY), which aborts the
        // suite before per-test results are reported -- every test then
        // shows as "pending" with no pass/fail count. Disabled, with all
        // files run in a single shared worker instead. Consequence: storage
        // is shared across ALL test files for the whole run, so every test
        // must use a username (and thus Durable Object, via idFromName)
        // that is unique across files, not just within its own file.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: {
          configPath: "./wrangler.test.toml",
        },
        // Miniflare auto-loads a local .dev.vars file (used for `wrangler
        // dev`) regardless of which wrangler config is pointed at, and
        // merges it inconsistently across this pool's two invocation styles
        // (SELF.fetch's internal worker instance vs. a manually-constructed
        // env passed to the exported `fetch` handler directly) -- a
        // developer's real `.dev.vars` would then silently desync the
        // SESSION_SECRET used to sign vs. verify session cookies across
        // those two paths. Force the test values here so they're immune to
        // whatever a developer has in their local .dev.vars.
        miniflare: {
          bindings: {
            SESSION_SECRET: "test-secret",
            CF_API_TOKEN: "test-token",
            CF_ACCOUNT_ID: "test-account",
          },
        },
      },
    },
  },
});
