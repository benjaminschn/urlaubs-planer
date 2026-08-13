import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.getByLabel("E-Mail-Adresse").fill("person-a@example.test");
  await page.getByLabel("Passwort").fill("correct-password-a");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByLabel("Bestätigungscode").fill("123456");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("banner").getByText("Testreise", { exact: true })).toBeVisible();
}

test.describe("Schnitt 9 PWA release gate", () => {
  test("persistiert im Service Worker nur lokale Shell-Assets und keine API-Antworten", async ({ page }) => {
    await page.goto("/#/app");
    await signIn(page);
    await page.getByRole("button", { name: "Dokumente" }).click();
    await page.getByLabel("Dateien auswählen").setInputFiles({
      name: "cache-audit.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\npassive\n%%EOF")
    });
    await expect(page.getByText("cache-audit.pdf", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Original öffnen" }).click();
    const blobUrl = await page.getByRole("link", { name: "Original herunterladen" }).getAttribute("href");
    expect(blobUrl).toMatch(/^blob:/);
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("Service Worker wird nicht unterstützt.");
      await navigator.serviceWorker.ready;
    });

    const audit = await page.evaluate(async () => {
      const urls: string[] = [];
      const bodies: string[] = [];
      const nonCodeBodies: string[] = [];
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          urls.push(request.url);
          const response = await cache.match(request);
          if (!response) continue;
          const body = await response.clone().text();
          bodies.push(body);
          if (!/\.(?:js|css|map)(?:$|\?)/i.test(new URL(request.url).pathname)) {
            nonCodeBodies.push(body);
          }
        }
      }
      const databases = "databases" in indexedDB ? await indexedDB.databases() : [];
      return {
        urls,
        body: bodies.join("\n"),
        nonCodeBody: nonCodeBodies.join("\n"),
        indexedDbNames: databases.map((database) => database.name ?? ""),
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage)
      };
    });

    expect(audit.urls.length).toBeGreaterThan(0);
    expect(audit.urls.every((url) => new URL(url).origin === "http://127.0.0.1:4187")).toBe(true);
    expect(audit.urls.some((url) => /\/(?:rest|auth|storage|functions)\/v\d/i.test(url))).toBe(false);
    expect(audit.urls.some((url) => /supabase\.co/i.test(url))).toBe(false);
    expect(audit.body).not.toContain("cache-audit.pdf");
    // The e2e auth double is compiled into the precached JS shell. Session data
    // and document names must still stay out of HTML, manifest and other non-code caches.
    expect(audit.nonCodeBody).not.toContain("person-a@example.test");
    expect(audit.indexedDbNames).toEqual([]);
    expect(audit.sessionStorageKeys).not.toContain("gemeinsamer-reiseplaner-auth");
    expect(audit.localStorageKeys.every((key) => key.includes("e2e"))).toBe(true);
    expect(await page.evaluate(async (url) => {
      try {
        await fetch(url as string);
        return true;
      } catch {
        return false;
      }
    }, blobUrl)).toBe(false);
  });

  test("markiert Offline-Daten als veraltet und behauptet keine Speicherung", async ({ page, context }) => {
    await page.goto("/#/app");
    await signIn(page);
    await page.getByRole("button", { name: "Reise bearbeiten" }).click();
    const title = page.getByLabel("Reisetitel");
    await title.fill("Nur lokaler Entwurf");

    await context.setOffline(true);
    await expect(page.getByText("Offline", { exact: true })).toBeVisible();
    await expect(page.getByText(/es wird nichts lokal als gespeichert vorgemerkt/i)).toBeVisible();

    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("heading", { name: "Reise bearbeiten" })).toBeVisible();
    await expect(title).toHaveValue("Nur lokaler Entwurf");
    await expect(page.getByRole("heading", { name: "Nur lokaler Entwurf" })).toHaveCount(0);

    const reconnectBanner = page.getByText("Wieder online", { exact: true });
    const reconnectVisible = expect(reconnectBanner).toBeVisible();
    await context.setOffline(false);
    await reconnectVisible;
    await expect(page.getByText(/Serverstand wird neu geladen/i)).toBeVisible();
  });
});
