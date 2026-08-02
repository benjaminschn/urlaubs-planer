import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function signIn(
  page: import("@playwright/test").Page,
  email = "person-a@example.test",
  password = "correct-password-a"
) {
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Bestätigung erforderlich" })).toBeVisible();
  await page.getByLabel("Bestätigungscode").fill("123456");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("banner").getByText("Testreise", { exact: true })).toBeVisible();
}

test.describe("Schnitt 1 Auth und geschützter Einstieg", () => {
  test("schützt einen direkten Deep Link, prüft MFA und behält das Ziel", async ({ page }) => {
    await page.goto("/#/documents");
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    expect(await page.getByText("Testreise", { exact: true }).count()).toBe(0);

    await signIn(page);

    await expect(page).toHaveURL(/#\/documents$/);
    await expect(page.getByRole("button", { name: "Dokumente" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("ordnet einen falschen TOTP-Code neutral zu", async ({ page }) => {
    await page.goto("/#/app");
    await page.getByLabel("E-Mail-Adresse").fill("person-b@example.test");
    await page.getByLabel("Passwort").fill("correct-password-b");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.getByLabel("Bestätigungscode").fill("000000");
    await page.getByRole("button", { name: "Bestätigen" }).click();

    await expect(page.getByRole("alert")).toContainText("Bestätigungscode");
    await expect(page.getByText("Testreise", { exact: true })).toHaveCount(0);
  });

  test("sperrt nach Abmeldung und Session-Ablauf den geschützten Zustand", async ({ page }) => {
    await page.goto("/#/app");
    await signIn(page);
    await page.getByRole("button", { name: "Dokumente" }).click();
    await expect(page).toHaveURL(/#\/documents$/);
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    await expect(page.getByText("Testreise", { exact: true })).toHaveCount(0);

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    await expect(page.getByText("Testreise", { exact: true })).toHaveCount(0);

    await signIn(page);
    await page.evaluate(() => window.dispatchEvent(new Event("travel-planner:test-expire-session")));
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    await expect(page.getByText("Testreise", { exact: true })).toHaveCount(0);
  });

  test("bleibt bei 375 CSS-Pixeln horizontal scrollbar-frei und per Tastatur bedienbar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/#/app");
    const email = page.getByLabel("E-Mail-Adresse");
    const password = page.getByLabel("Passwort");
    await email.focus();
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);

    await signIn(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
});

test.describe("Schnitt 2 gemeinsame Reise", () => {
  test("zeigt den administrativ bereitgestellten Reisekopf ohne zweite Reise", async ({ page }) => {
    await page.goto("/#/app");
    await signIn(page);

    await expect(page.getByRole("heading", { name: "Testreise" })).toBeVisible();
    await expect(page.getByRole("button", { name: /neue reise/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Reise bearbeiten" }).click();
    await page.getByLabel("Reisetitel").fill("Gemeinsame Herbstreise");
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("heading", { name: "Gemeinsame Herbstreise" })).toBeVisible();
  });

  test("synchronisiert eine bestätigte Änderung in einem zweiten Browserkontext", async ({ page }) => {
    await page.goto("/#/app");
    await signIn(page, "person-a@example.test", "correct-password-a");

    const secondPage = await page.context().newPage();
    await secondPage.goto("/#/app");
    await signIn(secondPage, "person-b@example.test", "correct-password-b");

    await page.getByRole("button", { name: "Reise bearbeiten" }).click();
    await page.getByLabel("Reisetitel").fill("Synchronisierte Reise");
    await page.getByRole("button", { name: "Änderungen speichern" }).click();

    await expect(secondPage.getByRole("heading", { name: "Synchronisierte Reise" })).toBeVisible({ timeout: 5000 });
    await secondPage.close();
  });

  test("weist eine Speicherung auf einer veralteten gelesenen Version ab", async ({ page }) => {
    await page.goto("/#/app");
    await signIn(page, "person-a@example.test", "correct-password-a");

    const secondPage = await page.context().newPage();
    await secondPage.goto("/#/app");
    await signIn(secondPage, "person-b@example.test", "correct-password-b");
    await secondPage.getByRole("button", { name: "Reise bearbeiten" }).click();
    await secondPage.getByLabel("Reisetitel").fill("Veralteter Entwurf");

    await page.getByRole("button", { name: "Reise bearbeiten" }).click();
    await page.getByLabel("Reisetitel").fill("Kanonischer Stand");
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("heading", { name: "Kanonischer Stand" })).toBeVisible();

    await secondPage.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(secondPage.getByRole("alert")).toContainText("zwischenzeitlich geändert");
    await expect(secondPage.getByLabel("Reisetitel")).toHaveValue("Kanonischer Stand");
    await secondPage.close();
  });
});

test.describe("Schnitt 3 manuelle Reiseereignisse", () => {
  test("legt ein Ereignis an, bearbeitet es und löscht es fachlich", async ({ page }) => {
    await page.goto("/#/app");
    await signIn(page);

    await page.getByRole("button", { name: "Ereignis manuell anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Ereignis anlegen" })).toBeVisible();
    await page.getByLabel("Ereignisart").selectOption("activity");
    await page.locator("#travel-item-title").fill("Stadtmuseum");
    await page.locator("#travel-item-start-date").fill("2026-09-03");
    await page.getByRole("button", { name: "Ereignis speichern" }).click();

    await expect(page).toHaveURL(/#\/events\/[A-Za-z0-9-]+$/);
    await expect(page.getByRole("heading", { name: "Stadtmuseum" })).toBeVisible();
    await expect(page.getByText("03.09.2026", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Bearbeiten" }).click();
    await page.locator("#travel-item-title").fill("Stadtmuseum geändert");
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("heading", { name: "Stadtmuseum geändert" })).toBeVisible();

    await page.getByRole("button", { name: "Ereignis löschen" }).click();
    await expect(page.getByRole("dialog", { name: "Ereignis löschen?" })).toBeVisible();
    await page.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(page.getByRole("heading", { name: "Noch keine Ereignisse" })).toBeVisible();
  });
});

test.describe("Schnitt 4 private Originaldokumente", () => {
  test("lädt ein geprüftes Original hoch und stellt nur einen lokalen Abruf bereit", async ({ page }) => {
    await page.goto("/#/documents");
    await signIn(page);

    await page.getByLabel("Dateien auswählen").setInputFiles({
      name: "reise.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\npassive\n%%EOF")
    });

    await expect(page.getByRole("heading", { name: "Originaldokumente" })).toBeVisible();
    await expect(page.getByText("reise.pdf", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Original öffnen" }).click();
    await expect(page.getByRole("link", { name: "Original herunterladen" })).toHaveAttribute("download", "reise.pdf");
    expect(await page.getByRole("link", { name: "Original herunterladen" }).getAttribute("href")).toMatch(/^blob:/);
  });
});
