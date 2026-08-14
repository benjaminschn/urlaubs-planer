# Implementierungsreview-Handoff

**Stand:** 14. August 2026, Europe/Berlin
**Repository:** `/Users/benjamin/projects/urlaubs-planer`
**Produktionsprojekt:** Supabase `pvqawohdklzxpruodydy`
**Veröffentlichungsbranch:** `codex/implementation-review-handoff`, basierend auf drei lokalen Implementierungscommits vor `origin/master`
**Arbeitsbaum:** sauber
**Releaseurteil:** Die Implementierung ist substanziell und lokal umfassend grün, aber noch nicht sicher ausrollbar.

Dieses Dokument setzt den historischen Stand aus `docs/operations/audit-handoff-2026-08-13.md` fort. Es beschreibt den nachfolgenden Implementierungsstand, die unabhängige Nachprüfung vom 14. August und die noch offenen Aufgaben. Die Nachprüfung nahm keine Produktionsänderungen vor. Der Stand wird ausschließlich auf dem oben genannten Review-Branch veröffentlicht; dieser Branch löst laut Workflow keine Supabase- oder Pages-Deployments aus.

## 1. Kurzfassung für die nächste Person

Die andere Implementierung hat die wesentlichen Audit-Arbeitspakete umgesetzt:

- strukturierter Kandidateneditor statt Roh-JSON einschließlich Konflikt-, Dirty-State- und Accessibility-Verhalten;
- atomare Speicherung mehrerer Feldkorrekturen plus kanonischem Snapshot;
- dauerhafte Extraktionsqueue, Worker-Leases, Recovery, Provider-Fencing und idempotentes Kostenledger;
- gehärtete Dokumentprüfung mit Quarantäne, Lease-Fencing, statischer Datei-/Archivprüfung und fail-closed Scannervertrag;
- reconnect-sichere Online-first-PWA mit kontrollierter Service-Worker-Aktivierung und ohne private Runtime-Caches;
- deutlich erweiterte lokale und produktive CI-/Health-Gates sowie Betriebsdokumentation.

Alle lokalen automatisierten Gates bestehen. Ein Release ist trotzdem blockiert, weil der aktuelle CI-Migrationsbefehl die drei ausstehenden Migrationen nicht auf Produktion anwenden kann, erforderliche Produktionssecrets fehlen und die Verifier-/Kosten-Lebenszyklen noch konkrete Lücken besitzen.

## 2. Lokaler Git-Stand

Der Review-Branch basiert auf dem lokalen `master`, der drei Implementierungscommits vor `origin/master` lag:

1. `90cd9fe Add extraction worker, schema reconcile, and deploy-controlled schedule.`
2. `1b77298 Add structured candidate review and a reconnect-safe PWA shell.`
3. `4f0ef9 Expand CI gates and document the remaining release blockers.`

Der Implementierungsvergleich zu `origin/master` umfasst 77 Dateien und ungefähr 6.133 neue beziehungsweise 786 entfernte Zeilen. Hinzu kommt dieses Handoff-Dokument. Nach seinem Commit ist der Arbeitsbaum sauber. Der Branch wird bewusst nicht nach `master` gepusht und es wird kein Pull Request mit automatischem Merge erstellt.

`git diff --check origin/master..HEAD` ist noch nicht vollständig sauber:

- drei Zeilen mit nachgestellten Leerzeichen in `docs/operations/audit-handoff-2026-08-13.md`;
- eine zusätzliche Leerzeile am Dateiende von `supabase/migrations/20260813224500_reconcile_travel_item_functions.sql`.

## 3. Was implementiert wurde

### 3.1 Kandidatenprüfung und Bestätigung

- Vollständiger strukturierter Editor für Unterkunft, Flug, Bahn, Bus und Aktivität.
- Gemeinsame, typspezifische und wiederholbare Felder einschließlich Orten, Zeiten, Kontakten, Reisenden, Preisen, Referenzen und Segmenten.
- Allowlist-basierte Hydratisierung reicher Extraktionsfelder in den kanonischen Entwurf.
- Beim Bearbeiten eingefrorene Basisversion/Basispayload; Realtime-Änderungen erzeugen einen sichtbaren Konflikt statt eines Lost Updates.
- Typwechsel entfernt inkompatible Felder und Segmente.
- Navigation, Browser-Zurück und Abmeldung respektieren ungespeicherte Änderungen.
- Feldbezogene Korrekturhistorie, korrekter `other`-Referenz-Roundtrip sowie fokussierbare und per ARIA verknüpfte Validierungsfehler.
- `public.apply_candidate_review(...)` schreibt alle Feldkorrekturen und den vorgeschriebenen kanonischen Snapshot atomar in einer Transaktion.

### 3.2 Extraktion und Kostenledger

- `extraction_runs` ist eine dauerhafte Queue mit `SKIP LOCKED`, `available_at`, 120-Sekunden-Leases und maximal drei Provider-Versuchen.
- Browserseitiger Start reserviert den Run und liefert `202`; der service-only Worker verarbeitet ihn asynchron.
- Worker-Credential ist getrennt vom Nutzer-JWT und wird für Cron-Aufrufe aus Vault bezogen.
- Der bezahlte Responses-Aufruf wird vor dem Request gefenced.
- Providerkosten werden pro Attempt idempotent und vor Schema-/Semantikvalidierung verbucht.
- Preise einschließlich Cached-Input-Rate werden pro Run und Ledger-Eintrag gesnapshottet.
- Ein abgelaufener Worker nach begonnenem Provideraufruf wird nicht automatisch doppelt ausgeführt; der Rest der Reservierung wird konservativ als ungewisser Ausgang verbucht.
- Temporäre Providerdateien werden best-effort gelöscht.
- Die Schedule-Installation wurde in eine vorwärtsgerichtete, deploy-kontrollierte Migration ausgelagert.

### 3.3 Privater Dokumentupload

- Private Quarantäne und serverseitige Upload-, Batch-, Dokument- und Parallelitätslimits.
- Statische Prüfung von Größe, Signatur/MIME-Konflikten, Bilddimensionen, animierten GIFs, UTF-8-Text und OOXML-ZIP-Struktur.
- Schutz gegen Traversal, doppelte Archiveinträge, ungewöhnliche Kompressionsraten, aktive Inhalte und ausgewählte PDF-Risikomarker.
- Verifier-Lease mit Owner, Ablaufzeit, Attempt-Zähler und gefenceten Publish/Reject/Defer-RPCs.
- Scanner ist fail-closed: nur `clean: true` darf freigeben; PDF/OOXML benötigen zusätzlich `passive: true` von einem externen gehärteten Parser/CDR.
- Scanner-Ausfälle führen zu `verification_pending`, ohne dauerhaft das aktive Uploadkontingent zu belegen.

### 3.4 PWA und Reconnect

- Shell-only-Precache; keine Auth-, REST-, Storage- oder Function-Antworten im Runtime-Cache.
- Kontrollierte Update-Aktivierung statt automatischem `skipWaiting`/`clientsClaim`.
- Dirty-State verhindert eine Service-Worker-Aktivierung während offener Änderungen.
- Gemeinsame kanonische Resync-Barriere nach Reconnect; Mutationen bleiben blockiert, bis die registrierten Datenprovider erfolgreich neu geladen haben.
- Logout räumt Browserzustand, Cache-, IndexedDB-, Storage- und Blob-URL-Artefakte im E2E-Szenario auf.
- Installierbare Raster- und Apple-Touch-Icons sowie Manifest-/Cache-Audits.

### 3.5 CI und Betrieb

- Node `24.15.0`, gepinnte Abhängigkeiten und Produktionsabhängigkeits-Audit.
- Typecheck, ESLint, Unit-/Komponententests, Build-, Bundle-, Manifest-, PWA- und Secret-Gates.
- Frischer lokaler Supabase-Start, pgTAP, DB-Lint und Advisors.
- Chromium- und Playwright-WebKit-E2E.
- Backend-vor-Frontend-Deployment, Projekt-/Secret-Preflight, Migration-Dry-Run, Function-Aktivitätsprüfung, authentifizierter Worker-Healthcheck und Cron-/`pg_net`-Nachweis.
- Täglicher Production-Health-Workflow für Pages, Manifest, Auth, Worker und Extraction-Cron.
- Deployment-, Incident-, Datenlebenszyklus-, Architektur-, Threat-Model- und Roadmap-Dokumentation.

## 4. Unabhängig verifizierter Teststand

Am 14. August 2026 wurden folgende Prüfungen erneut ausgeführt:

- `npm audit --omit=dev --audit-level=high`: **0 Schwachstellen**.
- `npm run check`: erfolgreich.
  - TypeScript: bestanden.
  - ESLint: bestanden.
  - Vitest: **25 Dateien / 105 Tests** bestanden.
  - Produktionsbuild: bestanden.
  - Build-/Bundle-/Manifest-Audit: bestanden.
  - PWA-Cache-Audit: bestanden.
  - Secret-Scan: bestanden.
- Frischer `npx supabase db reset`: alle **18 lokalen Migrationen** angewendet.
- `npx supabase test db --local supabase/tests`: **9 Dateien / 218 Assertions** bestanden.
- Lokaler DB-Lint mit `--fail-on warning`: sauber.
- Lokale Advisors mit `--fail-on warn`: sauber.
- Produktions-Fingerprint für den abgedeckten Travel-Item-Schnitt: bestanden.
- `npm run test:e2e`: **24/24** in Chromium und WebKit bestanden.

Bekannte nicht blockierende Build-Warnung: Hauptchunk ungefähr 562 KB roh beziehungsweise 153 KB gzip.

## 5. Aktueller Produktionsstand

Der read-only Abgleich zeigte:

- Produktion enthält Migrationen bis einschließlich `20260813230500`.
- Lokal vorhanden, aber noch nicht produktiv angewendet:
  - `20260813201059_fence_extraction_calls_and_defer_schedule.sql`;
  - `20260813201223_harden_document_verification.sql`;
  - `20260813240000_install_extraction_worker_schedule.sql`.
- Produktiv aktive Functions:
  - `verify-document-upload` v3, alte Implementierung;
  - `start-document-extraction` v20;
  - `process-document-extractions` v1.
- Der vorhandene Travel-Item-Produktionsfingerprint stimmt mit dem erwarteten Hash überein.
- Die dokumentierten Produktions-Advisor-Warnungen bestehen aus den erwarteten `SECURITY DEFINER`-RPCs sowie den bekannten Free-Plan-/MFA-Warnungen.
- Folgende für den neuen Stand erforderliche Function-Secrets fehlen in Produktion:
  - `OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN`;
  - `MALWARE_SCAN_URL`;
  - `MALWARE_SCAN_TOKEN`.

## 6. Releaseblocker und Review-Befunde

### Blocker 1 — Der CI-Migrationspfad kann den Stand nicht deployen

Die Workflowbefehle

```sh
supabase db push --linked --dry-run
supabase db push --linked --yes
```

verwenden kein `--include-all`. Die Migrationen `20260813201059` und `20260813201223` sortieren vor bereits produktiv angewendeten Migrationen. Der exakte CI-Dry-Run schlägt deshalb mit `LegacyDbPushMissingRemoteError` fehl.

Ein read-only Dry-Run mit `--include-all` war erfolgreich und würde genau die drei oben genannten Migrationen anwenden. Vor einer Freigabe beziehungsweise einem Push auf `master` muss eine bewusste Lösung gewählt werden:

1. bevorzugt die noch nie produktiv angewendeten Migrationen auf neue, chronologisch nach `20260813230500` liegende Versionsnummern umbenennen und danach frischen Reset, pgTAP und Remote-Dry-Run erneut ausführen; oder
2. `--include-all` konsistent im Dry-Run und tatsächlichen Push verwenden und das Out-of-order-Rollout ausdrücklich dokumentieren.

Nicht nur einen der beiden CI-Befehle ändern.

### Blocker 2 — Produktionssecrets und Scannerentscheidung fehlen

Der CI-Secret-Preflight stoppt aktuell bereits vor dem Migration-Dry-Run. Cached-Input-Preis und Scannersecrets müssen festgelegt werden. Vor dem Verifier-Rollout sind Scanner/CDR-Anbieter, Region, Datenaufbewahrung, Löschung, Logs, Verfügbarkeit, 20-MiB-Unterstützung und Kosten zu entscheiden und mit synthetischen Dateien zu testen.

### P1 — Abgelaufene Verifier-Leases können Uploads blockieren

Ein Dokument im Status `verifying` zählt gegen das Limit von zwei parallelen Uploads. Ein service-only Reaper kann abgelaufene Leases auf `verification_pending` setzen, wird aber weder durch Cron noch durch einen anderen Pfad aufgerufen. Die Oberfläche bietet nur für `verification_pending`, nicht für einen abgelaufenen `verifying`-Datensatz, eine Wiederholung an.

Folge: Zwei während der Function-Ausführung abgebrochene Prüfungen können weitere Uploads desselben Nutzers unbegrenzt blockieren. Zusätzlich bleibt ein Dokument nach 20 fehlgeschlagenen Attempts in einem nicht mehr claimbaren Zustand, ohne terminalen Status oder passende Nutzeraktion.

Empfohlene Korrektur: dauerhafte Verification-Queue oder mindestens sicher geplanter Reaper, UI-/API-Retry für abgelaufene Claims, terminale Transition nach dem Attempt-Limit und Tests für alle drei Pfade.

### P1 — Das dokumentierte harte Monatsbudget ist nicht hart erzwungen

Die ursprüngliche Constraint `reserved_micro_eur + spent_micro_eur <= limit_micro_eur` wurde absichtlich entfernt, damit bereits entstandene Providerkosten korrekt verbucht werden können. Das Ledger erhöht `spent_micro_eur` anschließend um die tatsächlichen Kosten, selbst wenn diese die Reservierung übersteigen. Die Anwendung beweist aber nirgends, dass `OPENAI_MAX_RUN_COST_MICRO_EUR` eine konservative Obergrenze für die erlaubte Datei, das Modell und das Ausgabe-Tokenlimit ist.

Damit kann ein einzelner Run das laut Threat Model harte Monatsbudget überschreiten. Aufnahme neuer Runs wird erst danach gestoppt. Vor Release entweder die Reservierung aus nachweisbaren Modell-/Input-/Output-Grenzen ableiten und beim Deployment validieren oder die Anforderung im Threat Model ausdrücklich als weiche Anwendungsschranke mit separatem Provider-Hard-Limit korrigieren.

### P2 — Abgelehnte Quarantäneobjekte können verwaisen

Der Verifier schreibt aus Sicherheitsgründen zuerst den terminalen Ablehnungsstatus und löscht danach den Storage-Blob. Schlägt das Löschen fehl, liefert die Function `verification_cleanup_pending`; es gibt aber keine persistierte Cleanup-Aufgabe und keinen Retry. Der Blob bleibt privat und wird nicht öffentlich zugänglich, kann jedoch unbegrenzt gespeichert bleiben.

Empfohlene Korrektur: idempotente, dauerhafte Cleanup-Queue oder periodischer Abgleich terminaler Dokumentzeilen gegen vorhandene Quarantäneobjekte.

### P2 — Der Produktionsfingerprint deckt nur einen Teilausschnitt ab

`scripts/check-production-schema-fingerprint.sql` prüft Spalten und Constraints von `locations`/`travel_items` sowie vier Mutationsfunktionen. RLS-Flags, Policies, Grants, Indizes, Trigger sowie Dokument-/Extraktionsschema sind nicht Teil dieses automatischen Fingerprints. Der aktuelle abgedeckte Produktionsausschnitt stimmt, aber zukünftiger manueller Drift außerhalb dieses Ausschnitts kann unentdeckt bleiben.

Empfohlene Korrektur: entweder Dokumentation/Roadmap auf den tatsächlichen Scope begrenzen oder den Fingerprint auf die sicherheitskritischen RLS-/Policy-/Grant-/Trigger- und neuen Queue-/Verifier-Verträge erweitern.

### P3 — Whitespace

Die vier von `git diff --check origin/master..HEAD` gemeldeten Whitespace-Stellen vor dem nächsten Commit bereinigen.

## 7. Was vor einer Freigabe oder einem Push auf `master` erledigt werden sollte

1. Migrationsreihenfolge korrigieren oder die bewusste `--include-all`-Strategie vollständig implementieren.
2. Frischen lokalen DB-Reset, 218 pgTAP-Assertions, DB-Lint und Advisors erneut ausführen.
3. Exakten normalen Remote-Dry-Run aus CI erneut ausführen; er muss ohne Sonderkommando manuell erfolgreich sein.
4. Verifier-Recovery einschließlich abgelaufenem Lease und Attempt-Limit reparieren.
5. Harte Kostenbudget-Anforderung implementieren oder korrekt neu spezifizieren.
6. Quarantäne-Cleanup dauerhaft machen.
7. Whitespace-Befunde beseitigen und `git diff --check` erneut ausführen.
8. Gesamte `npm run check`- und Playwright-Suite erneut ausführen.

## 8. Was vor einem Produktionsrelease zusätzlich offen bleibt

1. Cached-Input-Preis-Secret festlegen.
2. Scanner/CDR auswählen, Vertrag prüfen und Secrets setzen.
3. Scanner-Readiness nach Deployment prüfen; der aktuelle Workflow prüft nur die Worker-Gesundheit, nicht den Scannervertrag.
4. Synthetischen Produktions-Smoke für Upload, Clean/Reject/Unavailable, Extraktion, Worker-Abbruch, Kostenledger, Kandidatenkorrektur und genau-einmal Bestätigung durchführen.
5. Zweites persönliches Produktionskonto mit verifiziertem TOTP und zweiter aktiver Reisemitgliedschaft anlegen.
6. Zwei-Konten-/Zwei-Geräte-Realtime- und Konflikttest durchführen.
7. Echte iPhone-/Safari- und Desktop-Safari-Abnahme durchführen.
8. Hosting mit wirksamen CSP-/`frame-ancestors`-/Clickjacking-Response-Headern entscheiden; GitHub Pages kann diese Anforderung nicht erfüllen.
9. Backup-/Restore-Probe und realen Rollbacknachweis dokumentieren.
10. Dokument-/Konto-/Gesamtlöschung und Aufbewahrungsfristen entscheiden.
11. Supabase-Pro-Upgrade oder alternative serverseitige Strategie für Session-Timebox, Inaktivitätsgrenze und Leaked-Password-Schutz entscheiden.

## 9. Empfohlene Fortsetzungsreihenfolge

1. **Repository releasefähig machen:** Migration ordering, Verifier-Recovery, Kostenlimit, Cleanup und Whitespace.
2. **Alle lokalen Gates wiederholen:** Frontend, DB, Fingerprint, beide Browser.
3. **Externe Voraussetzungen schaffen:** Cached-Input-Preis, Scanner/CDR und erforderliche Secrets.
4. **Backend kontrolliert deployen:** Migrationen, Fingerprint/Advisors, Functions, Worker-Health, Schedule und Scanner-Readiness.
5. **Synthetischen End-to-End-Smoke durchführen.**
6. **Zweites Konto, echte Geräte, Hosting-Header und Backup/Restore abnehmen.**
7. Erst danach Frontend veröffentlichen und den MVP als releasefähig markieren.

## 10. Primäre Dateien

- Roadmap: `docs/roadmap.md`
- Vorheriger Audit-Handoff: `docs/operations/audit-handoff-2026-08-13.md`
- Deployment: `docs/operations/deployment.md`
- Incidents/Lebenszyklus: `docs/operations/incidents-and-data-lifecycle.md`
- CI: `.github/workflows/ci.yml`
- Production Health: `.github/workflows/production-health.yml`
- Migrations-Fencing: `supabase/migrations/20260813201059_fence_extraction_calls_and_defer_schedule.sql`
- Verifier-Leases: `supabase/migrations/20260813201223_harden_document_verification.sql`
- Schedule-Installer: `supabase/migrations/20260813240000_install_extraction_worker_schedule.sql`
- Extraction Worker: `supabase/functions/process-document-extractions/index.ts`
- Upload-Verifier: `supabase/functions/verify-document-upload/index.ts`
- Kandidateneditor: `src/ui/CandidateReviewPage.tsx`, `src/ui/CandidateTravelItemEditor.tsx`
- PWA-Resync: `src/pwa/context.tsx`, `src/pwa/network.ts`
- Produktionsfingerprint: `scripts/check-production-schema-fingerprint.sql`

## 11. Sichere Startbefehle für die Fortsetzung

```sh
git status --short --branch
git log --oneline --decorate -5
git diff --check origin/master..HEAD
npm audit --omit=dev --audit-level=high
npm run check
npx supabase db reset
npx supabase test db --local supabase/tests
npx supabase db lint --local --schema public,private --level warning --fail-on warning
npx supabase db advisors --local --type all --level warn --fail-on warn
npm run test:e2e
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Der letzte Befehl muss nach der Migrationskorrektur ohne `LegacyDbPushMissingRemoteError` bestehen. Bis dahin keine produktiven Migrationen, Functions oder Frontend-Artefakte ausrollen.
