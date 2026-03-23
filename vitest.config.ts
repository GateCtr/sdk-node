import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      // Only measure coverage on the actual logic modules — not barrel
      // re-exports, pure type files, or build scripts which have no branches.
      include: ["src/client.ts", "src/errors.ts", "src/http.ts", "src/stream.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
