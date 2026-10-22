import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        // Isolated (per-test stacked) storage fails on Windows during
        // teardown ("Isolated storage failed" / EBUSY), which aborts the
        // suite before per-test results are reported -- every test then
        // shows as "pending" with no pass/fail count. Tests don't rely on
        // storage isolation (each uses a unique username, so a unique
        // Durable Object via idFromName), so disable it and run all files
        // in a single shared worker instead.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: {
          configPath: "./wrangler.test.toml",
        },
      },
    },
  },
});
