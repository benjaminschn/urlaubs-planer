import { existsSync, readdirSync, readFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const indexUrl = new URL("index.html", dist);
if (!existsSync(indexUrl)) {
  throw new Error("dist/index.html fehlt.");
}

const index = readFileSync(indexUrl, "utf8");
const configuredBase = process.env.VITE_BASE_PATH || "/";
const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
if (!index.includes(`${base}assets/`)) {
  throw new Error(`Der Produktionsbuild verwendet nicht den erwarteten Basispfad ${base}.`);
}
if (index.includes("/src/main.tsx") || index.includes("sourceMappingURL")) {
  throw new Error("Der Produktionsbuild enthält noch Entwicklungs- oder Source-Map-Verweise.");
}
if (!index.includes(`${base}manifest.webmanifest`)) {
  throw new Error("Der Produktionsbuild referenziert kein Manifest unter dem Basispfad.");
}

const builtJavaScript = readdirSync(new URL("assets/", dist), { recursive: true })
  .filter((file) => String(file).endsWith(".js"))
  .map((file) => readFileSync(new URL(`assets/${String(file)}`, dist), "utf8"))
  .join("\n");
if (builtJavaScript.includes("person-a@example.test") || builtJavaScript.includes("correct-password-a")) {
  throw new Error("Der Produktionsbuild enthält Test-Authentifizierungsdaten.");
}

const files = readdirSync(new URL("assets/", dist), { recursive: true });
if (files.some((file) => String(file).endsWith(".map"))) {
  throw new Error("Source Maps dürfen nicht im Frontend-Artefakt liegen.");
}
for (const requiredFile of ["manifest.webmanifest", "offline.html"]) {
  if (!existsSync(new URL(requiredFile, dist))) {
    throw new Error(`Build-Datei fehlt: ${requiredFile}`);
  }
}

console.log(`Build-Prüfung erfolgreich (Basispfad: ${base}).`);
