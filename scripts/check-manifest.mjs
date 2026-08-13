import { existsSync, readFileSync } from "node:fs";

const manifestUrl = new URL("../dist/manifest.webmanifest", import.meta.url);
if (!existsSync(manifestUrl)) {
  throw new Error("dist/manifest.webmanifest fehlt.");
}

const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
const required = ["name", "short_name", "start_url", "scope", "display", "lang", "icons"];
for (const key of required) {
  if (!(key in manifest)) {
    throw new Error(`Manifest-Feld fehlt: ${key}`);
  }
}
if (manifest.lang !== "de" || manifest.display !== "standalone") {
  throw new Error("Manifest-Sprache oder Standalone-Anzeige ist falsch.");
}
if (typeof manifest.start_url !== "string" || !manifest.start_url.includes("#/app")) {
  throw new Error("Manifest-Startziel ist kein geschützter Hash-Einstieg.");
}
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  throw new Error("Manifest enthält kein App-Icon.");
}
if (manifest.icons.some((icon) => typeof icon.src !== "string" || /^https?:/i.test(icon.src))) {
  throw new Error("Manifest-Icons müssen lokale Assets sein.");
}
const rasterSizes = new Set(
  manifest.icons
    .filter((icon) => icon.type === "image/png")
    .map((icon) => icon.sizes)
);
if (!rasterSizes.has("192x192") || !rasterSizes.has("512x512")) {
  throw new Error("Manifest benötigt installierbare PNG-Icons in 192x192 und 512x512.");
}

console.log("Manifest-Prüfung erfolgreich.");
