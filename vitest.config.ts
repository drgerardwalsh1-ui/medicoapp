import { defineConfig } from "vitest/config";

// Root config scopes the contract suite to tests/contracts so it can run via
// `npx vitest run tests/contracts` (the ci-contract command) independently of
// the frontend workspace's own vitest setup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/contracts/**/*.test.ts"],
  },
});
