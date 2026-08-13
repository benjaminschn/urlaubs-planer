import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const rootPath = root.pathname;
const sourceRoots = ["src", "public", "scripts", ".github", "supabase", "docs", "schemas", ".agents"];
const sourceFiles = [
  "README.md",
  "index.html",
  "package.json",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  ".env.example"
];
const findings = [];

const patterns = [
  { name: "OpenAI key assignment", pattern: /(?:OPENAI_API_KEY|VITE_OPENAI|OPENAI_KEY)\s*[:=]/i },
  { name: "Supabase access token", pattern: /\bsbp_[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", pattern: /(?:ghp_|gho_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}/ },
  { name: "OpenAI token", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "JWT-like secret", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ }
];

function isIgnored(filePath) {
  const relativePath = relative(rootPath, filePath);
  return (
    relativePath === "node_modules" ||
    relativePath.startsWith("node_modules/") ||
    relativePath === ".git" ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith("dist/") ||
    relativePath.startsWith("supabase/.branches/") ||
    relativePath.startsWith("supabase/.temp/")
  );
}

function collectFiles(directory) {
  const result = [];
  if (!existsSync(directory) || isIgnored(directory)) {
    return result;
  }
  for (const entry of readdirSync(directory)) {
    const filePath = join(directory, entry);
    if (isIgnored(filePath)) {
      continue;
    }
    if (lstatSync(filePath).isDirectory()) {
      result.push(...collectFiles(filePath));
    } else {
      result.push(filePath);
    }
  }
  return result;
}

for (const sourceRoot of sourceRoots) {
  collectFiles(join(rootPath, sourceRoot)).forEach((filePath) => {
    if (!filePath.endsWith(".map")) {
      sourceFiles.push(relative(rootPath, filePath));
    }
  });
}

for (const fileName of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(join(rootPath, fileName))) {
    findings.push(`${fileName}: lokale Secret-Datei darf nicht im Arbeitsbaum liegen.`);
  }
}

for (const relativePath of [...new Set(sourceFiles)]) {
  const filePath = join(rootPath, relativePath);
  if (!existsSync(filePath) || isIgnored(filePath)) {
    continue;
  }
  const content = readFileSync(filePath, "utf8");
  for (const { name, pattern } of patterns) {
    if (pattern.test(content)) {
      findings.push(`${relativePath}: ${name}`);
    }
  }
}

const distPath = join(rootPath, "dist");
if (existsSync(distPath)) {
  const distFiles = [];
  const walkDist = (directory) => {
    for (const entry of readdirSync(directory)) {
      const filePath = join(directory, entry);
      if (lstatSync(filePath).isDirectory()) {
        walkDist(filePath);
      } else {
        distFiles.push(filePath);
      }
    }
  };
  walkDist(distPath);
  for (const filePath of distFiles) {
    if (filePath.endsWith(".map")) {
      findings.push(`${relative(rootPath, filePath)}: Source Map im Build-Artefakt`);
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    for (const { name, pattern } of patterns) {
      if (pattern.test(content)) {
        findings.push(`${relative(rootPath, filePath)}: ${name}`);
      }
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Secret-Prüfung fehlgeschlagen:\n${findings.join("\n")}`);
}

console.log("Secret-Prüfung erfolgreich: keine privilegierten Schlüssel oder Source Maps gefunden.");
