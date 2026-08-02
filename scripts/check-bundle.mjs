import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const assets = new URL("../dist/assets/", import.meta.url);
if (!existsSync(assets)) {
  throw new Error("dist/assets fehlt; zuerst den Produktionsbuild ausführen.");
}

const warningBytes = 500 * 1024;
const warningGzipBytes = 150 * 1024;
const files = readdirSync(assets).filter((file) => /\.(?:js|css)$/.test(file));
for (const file of files) {
  const content = readFileSync(new URL(file, assets));
  const compressedSize = gzipSync(content, { level: 9 }).byteLength;
  const rawSize = statSync(new URL(file, assets)).size;
  const warning = rawSize > warningBytes || compressedSize > warningGzipBytes ? " WARNUNG" : "";
  console.log(`${file}: ${rawSize} B roh, ${compressedSize} B gzip${warning}`);
}

console.log("Bundle-Größenprüfung abgeschlossen; Grenzwerte melden nur eine Warnung.");
