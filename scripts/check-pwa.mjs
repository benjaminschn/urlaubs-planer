import { existsSync, readFileSync } from "node:fs";

const distUrl = new URL("../dist/", import.meta.url);
const requiredIcons = ["icon-192.png", "icon-512.png", "apple-touch-icon.png"];
for (const icon of requiredIcons) {
  if (!existsSync(new URL(icon, distUrl))) {
    throw new Error(`Raster-Icon fehlt im Build: ${icon}`);
  }
}

const swUrl = new URL("sw.js", distUrl);
if (!existsSync(swUrl)) throw new Error("Service Worker fehlt im Build.");
const serviceWorker = readFileSync(swUrl, "utf8");

const routeRegistrations = serviceWorker.match(/\.registerRoute\s*\(/g) ?? [];
if (
  routeRegistrations.length !== 1 ||
  !/\.registerRoute\(new \w+\.NavigationRoute\(\w+\.createHandlerBoundToURL\("index\.html"\)/.test(serviceWorker)
) {
  throw new Error("Unerwartete Runtime-Caching-Route gefunden; erlaubt ist nur die precached App-Shell.");
}
if (/new \w+\.(?:CacheFirst|NetworkFirst|StaleWhileRevalidate)\b/.test(serviceWorker)) {
  throw new Error("Persistente Runtime-Cache-Strategie gefunden.");
}
const precacheMatch = serviceWorker.match(/\.precacheAndRoute\((\[.*?\]),\{\}\)/);
if (!precacheMatch) throw new Error("Precache-Liste konnte nicht geprüft werden.");
const precacheUrls = [...precacheMatch[1].matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
if (precacheUrls.length === 0) throw new Error("Precache enthält keine prüfbaren statischen Assets.");
if (
  precacheUrls.some((url) =>
    /^https?:\/\//i.test(url) || /(?:^|\/)(?:rest|auth|storage|functions)\/v\d/i.test(url)
  )
) {
  throw new Error("Precache enthält eine externe oder private API-Antwort.");
}
const skipWaitingOccurrences = serviceWorker.match(/self\.skipWaiting\(\)/g) ?? [];
if (
  skipWaitingOccurrences.length !== 1 ||
  !/addEventListener\("message",\w+=>\{\w+\.data&&"SKIP_WAITING"===\w+\.data\.type&&self\.skipWaiting\(\)\}\)/.test(serviceWorker) ||
  /clients\.claim\(\)/.test(serviceWorker)
) {
  throw new Error("Service Worker aktiviert oder beansprucht Updates ohne ausdrückliche Nutzerfreigabe.");
}
if (!serviceWorker.includes("SKIP_WAITING")) {
  throw new Error("Service Worker kann ein bestätigtes Update nicht aktivieren.");
}

console.log("PWA-Cache-Audit erfolgreich: nur Precache, keine Runtime-/API-Caches, Update per Freigabe.");
