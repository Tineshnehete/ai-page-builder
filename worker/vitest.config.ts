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
      },
    },
  },
});
