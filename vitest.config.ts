import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@runtime-auth": path.resolve(projectRoot, "src/auth/runtime.ts"),
      "@runtime-services": path.resolve(projectRoot, "src/runtime/services.ts")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    css: true,
    restoreMocks: true,
    clearMocks: true
  }
});
