# Handoff

**Stand:** 15. August 2026
**Geltung:** Dieses Dokument ist der aktuelle Betriebs- und Fortsetzungsstand. Ältere Audit-/Review-Handoffs sind entfernt.

**Produkt:** Privater Reiseplaner für zwei Personen (kein öffentlicher Dienst).
**Produktion:** GitHub Pages `https://benjaminschn.github.io/urlaubs-planer/` und Supabase `pvqawohdklzxpruodydy`.
**Release:** `master` bei Commit `5336908`; Backend und Pages wurden durch CI erfolgreich ausgerollt.

Produktdefinition und Schnitte: [Roadmap](../roadmap.md).
Deploy und Secrets: [Deployment](deployment.md).
Sicherheitspolitik: [Threat Model](../security/threat-model.md).

## 1. Urteil

Der private MVP ist ausgerollt und die automatischen Produktionsprüfungen sind grün. CI-Lauf `31872219292` (Verify, Supabase-Deploy und Pages) sowie Production-Health-Lauf `31872983402` waren erfolgreich. Projektstatus ist `ACTIVE_HEALTHY`; alle 21 Migrationen sind angewendet, es gibt keine ausstehenden Migrationen. Die erforderlichen Worker-Secret-Namen sind in Supabase vorhanden; der optionale Cached-Input-Preis ist weiterhin nicht erforderlich.

Bewusste Vereinfachung für zwei vertrauenswürdige Konten:

- Kein externer Malware-Scanner/CDR. Freigabe nach lokaler Größen-, Signatur- und Strukturprüfung.
- Anwendungsbudget ist weich (`OPENAI_MAX_RUN_COST_MICRO_EUR` pro Run). Hart ist das Guthaben-/Nutzungslimit des privaten OpenAI-Kontos.
- GitHub Pages setzt keine CSP-/Clickjacking-Header. Für diese Nutzung akzeptiert.
- Supabase-Pro (Session-Timebox, Leaked-Password-Schutz) ist optional.

Unverändert verbindlich: keine Secrets im öffentlichen Repo oder in `VITE_*`, RLS auf jeder exponierten Tabelle, zwei persönliche Konten mit TOTP, privater Bucket.

## 2. Was im Repository steht

Der dokumentierte Produktionsstand entspricht Commit `5336908` auf `master`. Weitere Änderungen müssen über den bestehenden CI-Deploypfad ausgerollt werden.

Im Release enthalten: Extraktions-Worker, Kandidateneditor, PWA-Resync und erweiterte CI.

Weitere enthaltene Betriebslogik:

- Migrationen `20260813201059` / `20260813201223` nach `20260813231000` / `20260813232000` umbenannt, damit `supabase db push --linked --dry-run` ohne `--include-all` läuft.
- Verifier-Recovery: Reaper per Minuten-Cron, Recover vor Reserve/Claim, UI-Retry für `verifying` und `verification_pending`, terminal `invalid` / `verification_attempts_exhausted` nach 20 Versuchen.
- Dauerhafte Cleanup-Queue `private.document_storage_cleanups` plus Worker `process-document-storage-cleanups` (Schedule erst nach Function-Deploy). Fehlgeschlagene Browser-Uploads werden atomar eingereiht; der Browser darf keine Quarantäneobjekte mehr löschen. Retries öffnen erst nach erfolgreichem Worker-Cleanup. Nach 20 erfolglosen Cleanup-Versuchen steht der Datensatz terminal auf `failed` und wird vom Production-Health-Check gemeldet; terminale Zeilen werden nicht automatisch wiederbelebt.
- Scannerpfad entfernt. Gültige Dateien werden nach lokaler Prüfung veröffentlicht.
- Harte Token-Decken-Prüfung entfernt. Cached-Input-Preis optional (sonst Inputpreis).
- Whitespace in der bereits angewendeten Travel-Item-Reconcile-Migration bereinigt.

## 3. Lokal zuletzt geprüft (15. August 2026)

| Prüfung | Ergebnis |
| --- | --- |
| `npm audit --omit=dev --audit-level=high` | 0 Schwachstellen |
| Typecheck, ESLint, Vitest | 25 Dateien / 106 Tests |
| Produktionsbuild, Bundle/Manifest/PWA, Secret-Scan | bestanden |
| `supabase db reset` | 21 lokale Migrationen |
| pgTAP | 13 Dateien / 305 Assertions |
| DB-Lint / Advisors lokal | private/public ohne Schemafehler; Advisors ohne Error-Level-Fund, erwartete Info-Warnungen für bereits dokumentierte FK-/Index-/private-RLS-Themen |
| Playwright Chromium + WebKit | 24/24 |
| Verknüpfte Produktionsmigrationen | 21 angewendet, 0 ausstehend |

Nicht blockierende Build-Warnung: Hauptchunk ~562 KB roh / ~153 KB gzip.

## 4. Produktion (aktueller Stand)

Die Produktionskonfiguration ist eingerichtet: E-Mail-/Passwort-Anmeldung ist für administrativ angelegte Konten aktiviert, öffentliche Registrierung bleibt deaktiviert. Beide persönlichen Konten sind Reisemitglieder; beide haben je einen verifizierten TOTP-Faktor (2 verifiziert, 0 unverifiziert). Weitere TOTP-Einschreibung ist deaktiviert, Verifikation bleibt aktiviert.

Alle erforderlichen Function- und Worker-Secret-Namen sind vorhanden (ihre Werte bleiben geheim); `OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN` bleibt optional. Die Produktion läuft auf dem Release-Commit `5336908`.

Alle 21 Migrationen sind angewendet; `pending = 0`. Projektstatus: `ACTIVE_HEALTHY`.

Aktive Functions:

- `process-document-extractions` v3
- `process-document-storage-cleanups` v1
- `start-document-extraction` v22
- `verify-document-upload` v5

Der erfolgreiche Production-Health-Lauf `31872983402` bestätigte Schema-Fingerprint, Extraktions- und Cleanup-Schedule, Cleanup-Queue-Health, Pages inklusive Manifest (HTTP 200) sowie Auth-Health (HTTP 200). Der E-Mail-Provider ist aktiviert, öffentliche Registrierung deaktiviert; es gibt 2 verifizierte und 0 unverifizierte TOTP-Faktoren.

`OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN` ist optional; der uncached Inputpreis gilt als Fallback.

## 5. Nächste Schritte

1. **Manuelle Smoke-Tests:** Mit einem echten Mobilgerät (iPhone/Safari) und einem Desktop-Browser anmelden, TOTP prüfen, einen repräsentativen Upload durchführen und den vollständigen Ablauf von lokaler Ablehnung bzw. Freigabe über Extraktion, Korrektur und Bestätigung testen.

2. **Synthetischen Ablauf prüfen:** Einen kontrollierten Testlauf für Extraktion, Retry/Recovery und Cleanup ausführen und sicherstellen, dass die Queue nach erfolgreicher Verarbeitung leer bzw. erwartungsgemäß ist. Keine Testdaten mit echten personenbezogenen Inhalten verwenden.

3. **Monitoring fortsetzen:** Die geplanten Production-Health-Läufe und die Cron-/pg_net-Ausführung beobachten; bei Fehlern zuerst Function-Logs, Worker-Ausführung, Schedules und Cleanup-Queue prüfen.

## 6. Startbefehle

```sh
git status --short --branch
npx supabase secrets list --project-ref pvqawohdklzxpruodydy
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Produktionsmigrationen und Functions weiterhin ausschließlich über CI ausrollen; keine manuellen CLI-Deployments.
