import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["lib/**/*.test.ts", "server/**/*.test.ts"],
    env: { BOSS_DB: ":memory:", BOSS_MODE: "paper", BOSS_MARKET: "synthetic", BOSS_EXPLAIN: "0", BOSS_VOTE_MS: "60000", BOSS_KEY_ENCRYPTION_KEY: "ab".repeat(32) },
  },
});
