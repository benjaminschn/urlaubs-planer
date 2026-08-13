import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function signIn(page: import("@playwright/test").Page) {
  await page.getByLabel("E-Mail-Adresse").fill("person-a@example.test");
  await page.getByLabel("Passwort").fill("correct-password-a");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByLabel("Bestätigungscode").fill("123456");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("banner").getByText("Testreise", { exact: true })).toBeVisible();
}

test("prüft, korrigiert und speichert einen maschinellen Entwurf ohne Roh-JSON", async ({ page }) => {
  await page.addInitScript(() => {
    const timestamp = "2026-08-13T12:00:00.000Z";
    localStorage.setItem("gemeinsamer-reiseplaner-e2e-documents", JSON.stringify([{
      id: "44444444-4444-4444-8444-000000000001",
      tripId: "11111111-1111-4111-8111-111111111111",
      uploadedByUserId: "person-a@example.test",
      originalFileName: "beleg.pdf",
      reportedContentType: "application/pdf",
      detectedContentType: "application/pdf",
      byteSize: 24,
      checksum: "e2e",
      storageObjectKey: "quarantine/e2e-beleg.pdf",
      status: "available",
      errorCode: null,
      version: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
      uploadedAt: timestamp,
      idempotencyKey: "seed-candidate-review",
      batchKey: "seed",
      contentBase64: "JVBERi0xLjcKcGFzc2l2ZQolJUVPRg=="
    }]));
  });
  await page.goto("/#/documents");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Originaldokumente" })).toBeVisible();
  await page.getByRole("button", { name: "Verarbeitung starten" }).click();
  await page.getByRole("button", { name: "Jetzt kontrollieren" }).click();

  await expect(page.getByRole("heading", { name: "Ereignis kontrollieren" })).toBeVisible();
  await expect(page.getByLabel("Titel *")).toHaveValue("Erkannte Unterkunft");
  await expect(page.getByLabel("Name der Unterkunft")).toBeVisible();
  await expect(page.getByText("Im Original · 95 %")).toHaveCount(2);
  await expect(page.getByLabel(/Vollständiger geprüfter Ereignisstand/)).toHaveCount(0);

  await page.getByLabel("Titel *").fill("Geprüfte Unterkunft");
  await expect(page.getByText("Nicht gespeicherte Änderungen")).toBeVisible();
  await page.getByRole("button", { name: "Korrekturen speichern" }).click();
  await expect(page.getByText(/Korrektur gespeichert/)).toBeVisible();
  await expect(page.getByText("Alle Änderungen gespeichert")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByLabel("Titel *").fill("Noch nicht gespeichert");
  let dialogPromise = page.waitForEvent("dialog");
  let navigationPromise = page.getByRole("button", { name: "Timeline" }).click();
  await (await dialogPromise).dismiss();
  await navigationPromise;
  await expect(page.getByRole("heading", { name: "Ereignis kontrollieren" })).toBeVisible();
  await expect(page.getByLabel("Titel *")).toHaveValue("Noch nicht gespeichert");
  dialogPromise = page.waitForEvent("dialog");
  const signOutPromise = page.getByRole("button", { name: "Abmelden" }).click();
  await (await dialogPromise).dismiss();
  await signOutPromise;
  await expect(page.getByRole("heading", { name: "Ereignis kontrollieren" })).toBeVisible();
  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.history.back());
  await (await dialogPromise).dismiss();
  await expect(page.getByRole("heading", { name: "Ereignis kontrollieren" })).toBeVisible();
  dialogPromise = page.waitForEvent("dialog");
  navigationPromise = page.getByRole("button", { name: "Timeline" }).click();
  await (await dialogPromise).accept();
  await navigationPromise;
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByRole("heading", { name: /Ereignisse/ })).toBeVisible();
});
