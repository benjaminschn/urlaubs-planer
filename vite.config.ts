import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isE2eBuild = process.env.VITE_E2E_AUTH === "true";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: new deploys replace the controlling SW immediately.
      // "prompt" was used without an update UI, so clients stayed on old precache forever.
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg", "offline.html"],
      manifest: {
        name: "Gemeinsamer Reiseplaner",
        short_name: "Reiseplaner",
        description: "Privater gemeinsamer Reiseplaner",
        lang: "de",
        start_url: "./#/app",
        scope: "./",
        display: "standalone",
        background_color: "#eef3f4",
        theme_color: "#0f4c5c",
        icons: [
          {
            src: "./icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "offline.html",
        navigateFallbackDenylist: [/^\/supabase\//, /^\/rest\//, /^\/functions\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  resolve: isE2eBuild
    ? {
        alias: [
          {
            find: "@runtime-auth",
            replacement: path.resolve(projectRoot, "src/auth/e2e-runtime.ts")
          },
          {
            find: "@runtime-services",
            replacement: path.resolve(projectRoot, "src/runtime/e2e-services.ts")
          }
        ]
      }
    : {
        alias: [
          {
            find: "@runtime-auth",
            replacement: path.resolve(projectRoot, "src/auth/runtime.ts")
          },
          {
            find: "@runtime-services",
            replacement: path.resolve(projectRoot, "src/runtime/services.ts")
          }
        ]
      },
  build: {
    sourcemap: false,
    emptyOutDir: true
  }
});
