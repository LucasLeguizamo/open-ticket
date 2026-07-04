import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    setupFiles: ["./test/setup.ts"],
    // integration hits real Postgres (docker-compose.test.yml) — serial
    fileParallelism: false,
  },
});
