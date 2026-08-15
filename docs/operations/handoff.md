# Handoff

**Stand:** 15. August 2026
**Geltung:** Dieses Dokument ist der aktuelle Betriebs- und Fortsetzungsstand. Ältere Audit-/Review-Handoffs sind entfernt.

**Produkt:** Privater Reiseplaner für zwei Personen (kein öffentlicher Dienst).
**Produktion:** GitHub Pages `https://benjaminschn.github.io/urlaubs-planer/` und Supabase `pvqawohdklzxpruodydy`.
**Branch:** `codex/implementation-review-handoff` (kein Auto-Deploy). `origin/master` ist älter und löst Deployments aus.

Produktdefinition und Schnitte: [Roadmap](../roadmap.md).
Deploy und Secrets: [Deployment](deployment.md).
Sicherheitspolitik: [Threat Model](../security/threat-model.md).

## 1. Urteil

Der Code für den privaten MVP ist lokal grün. Produktion hat den neuen Verifier und die Recovery-/Cleanup-Migrationen noch nicht. Die erforderlichen Function-Secret-Namen sind in Supabase vorhanden; der optionale Cached-Input-Preis ist weiterhin nicht erforderlich. Der Release-Blocker ist jetzt der Push auf `master`, damit CI die sechs ausstehenden Migrationen und die zugehörigen Functions ausrollt.

Bewusste Vereinfachung für zwei vertrauenswürdige Konten:

- Kein externer Malware-Scanner/CDR. Freigabe nach lokaler Größen-, Signatur- und Strukturprüfung.
- Anwendungsbudget ist weich (`OPENAI_MAX_RUN_COST_MICRO_EUR` pro Run). Hart ist das Guthaben-/Nutzungslimit des privaten OpenAI-Kontos.
- GitHub Pages setzt keine CSP-/Clickjacking-Header. Für diese Nutzung akzeptiert.
- Supabase-Pro (Session-Timebox, Leaked-Password-Schutz) ist optional.

Unverändert verbindlich: keine Secrets im öffentlichen Repo oder in `VITE_*`, RLS auf jeder exponierten Tabelle, zwei persönliche Konten mit TOTP, privater Bucket.

## 2. Was im Repository steht

Arbeitsbaum auf diesem Branch enthält die Implementierung **uncommittet**. Nicht nach `master` mergen, bevor der Release-Commit geprüft und bewusst gepusht wird.

Bereits in den lokalen `master`-Commits vor `origin/master`: Extraktions-Worker, Kandidateneditor, PWA-Resync, erweiterte CI.

Zusätzlich auf diesem Branch:

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
| `supabase db push --linked --dry-run` | würde sechs ausstehende Migrationen anwenden, kein `LegacyDbPushMissingRemoteError` |

Nicht blockierende Build-Warnung: Hauptchunk ~562 KB roh / ~153 KB gzip.

## 4. Produktion (aktueller Stand vor Release)

Die Produktionskonfiguration ist eingerichtet: E-Mail-/Passwort-Anmeldung ist für administrativ angelegte Konten aktiviert, öffentliche Registrierung bleibt deaktiviert. Beide persönlichen Konten sind Reisemitglieder; beide haben je einen verifizierten TOTP-Faktor (2 verifiziert, 0 unverifiziert). Weitere TOTP-Einschreibung ist deaktiviert, Verifikation bleibt aktiviert.

Alle erforderlichen Function-Secret-Namen sind vorhanden (ihre Werte bleiben geheim); `OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN` bleibt optional. Es ist noch kein Deployment dieses Branches erfolgt.

Angewendet bis `20260813230500`.

Noch nicht angewendet:

- `20260813231000_fence_extraction_calls_and_defer_schedule.sql`
- `20260813232000_harden_document_verification.sql`
- `20260813240000_install_extraction_worker_schedule.sql`
- `20260814152635_recover_document_verification.sql`
- `20260814152653_document_storage_cleanup_queue.sql`
- `20260815062125_harden_document_storage_cleanup.sql` (Upload-Failure-Cleanup, Retry-Gate, terminale Cleanup-Fehler)

Aktive Functions: `verify-document-upload` v3 (alte Implementierung), `start-document-extraction` v20, `process-document-extractions` v1. Die sechs ausstehenden Migrationen sowie der neue Verifier und der Cleanup-Worker sind bis zu diesem Release nicht ausgerollt.

`OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN` fehlt; es ist optional, der uncached Inputpreis gilt als Fallback.

## 5. Nächste Schritte

1. **Erledigt: erforderliche Function-Secret-Namen in Supabase vorhanden** (nicht in GitHub, nicht als `VITE_*`). Dashboard: [Edge Function secrets](https://supabase.com/dashboard/project/pvqawohdklzxpruodydy/functions/secrets).

   | Secret | Bedeutung |
   | --- | --- |
   | `APP_ORIGIN` | `https://benjaminschn.github.io/urlaubs-planer/` |
   | `OPENAI_API_KEY` | privater OpenAI-Schlüssel |
   | `OPENAI_EXTRACTION_MODEL` | gewähltes Modell |
   | `OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS` | z. B. `4096` |
   | `OPENAI_INPUT_MICRO_EUR_PER_TOKEN` | uncached Inputpreis in µEUR |
   | `OPENAI_OUTPUT_MICRO_EUR_PER_TOKEN` | Outputpreis in µEUR |
   | `OPENAI_MAX_RUN_COST_MICRO_EUR` | weiche Run-Reservierung, z. B. `500000` = 0,50 EUR |
   | `OPENAI_PRICING_VERSION` | beliebiges Label, z. B. `2026-08` |
   | `EXTRACTION_WORKER_TOKEN` | 64 Hex-Zeichen; liegt als GitHub-Repository-Secret vor |

   Optional: `OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN`. Fehlt es, gilt der Inputpreis.

   Die vier Deploy-Secrets (`SUPABASE_ACCESS_TOKEN`, `PRODUCTION_PROJECT_ID`, `PRODUCTION_DB_PASSWORD`, `EXTRACTION_WORKER_TOKEN`) sind als GitHub-Repository-Secrets vorhanden und werden vom Job mit der Umgebung `supabase-production` verwendet; diese Umgebung hat derzeit keine eigenen Secrets.

2. Änderungen auf diesem Branch committen und auf `master` pushen. CI prüft die Secret-**Namen** und rollt dann die sechs Migrationen und Functions aus.

3. **Erledigt: zweites persönliches Produktionskonto mit TOTP angelegt und als Reisemitglied eingetragen.**

4. Nach dem Backend-Deploy einmal real prüfen: Upload, lokale Ablehnung, Extraktion, Korrektur, Bestätigung.

5. Bei Gelegenheit auf iPhone/Safari öffnen. Löschung, Backup-Probe und Pro-Upgrade sind später optional.

## 6. Startbefehle

```sh
git status --short --branch
npx supabase secrets list --project-ref pvqawohdklzxpruodydy
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Keine produktiven Migrationen oder Functions von Hand ausrollen, solange CI das Backend-Deploy noch nicht gemacht hat.
