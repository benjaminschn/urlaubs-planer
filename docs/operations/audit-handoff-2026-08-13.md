# Audit- und Implementierungs-Handoff

**Stand:** 13. August 2026, Europe/Berlin  
**Repository:** `/Users/benjamin/projects/urlaubs-planer`  
**Produktionsprojekt:** Supabase `pvqawohdklzxpruodydy`  
**Kurzurteil:** Der MVP-Code ist weit fortgeschritten und die lokalen Kernprüfungen sind grün. Das Produkt ist **noch nicht releasefähig**. Die offenen Punkte bestehen aus einigen Integrationskorrekturen im aktuellen uncommitteten Stand sowie externen Betriebs-, Anbieter- und Abnahmeentscheidungen.

## 1. Wichtig für die Fortsetzung

- Der Audit-Arbeitsstand ist in nachvollziehbare lokale Commits aufgeteilt. Es wurde kein Push und kein Pull Request erstellt.
- Nicht `git reset --hard` auf diese Commits anwenden, ohne den Inhalt zu kennen. Die zwei noch nicht ausgerollten lokalen Migrationen dürfen nicht blind produktiv angewendet werden.
- Die letzten beiden lokalen Migrationen sind **noch nicht produktiv ausgerollt**:
  - `20260813201059_fence_extraction_calls_and_defer_schedule.sql`
  - `20260813201223_harden_document_verification.sql`
- Die neue Upload-Verifier-Implementierung ist **bewusst nicht produktiv ausgerollt**, weil Scanner/CDR-Anbieter und Secrets fehlen.
- Vor dem nächsten Deployment zuerst die P0-Punkte in Abschnitt 7 erledigen.

## 2. Was der Audit gezeigt hat

### Kritische beziehungsweise releaseblockierende Befunde

1. **Historische Migrationen waren nachträglich verändert worden.** Produktion und ein frischer lokaler Datenbankaufbau hatten identische Migrationsnummern, aber unterschiedliche Travel-Item-Funktionen, eine fehlende `locations.owner_travel_item_id`-Spalte, zwölf fehlende Indizes und zwölf fehlende restriktive AAL2-Policies. Das war ein echter Sicherheits-/Funktionsdrift, kein kosmetisches Problem.
2. **Dokumentextraktion war nicht zuverlässig als dauerhafte Queue ausgeführt.** Der frühere Request-Pfad konnte bei Laufzeitende Arbeit und Kostenstatus verlieren. Leases, Recovery, Retry-Grenzen und unmittelbare Kostenverbuchung fehlten beziehungsweise waren unvollständig.
3. **Die Kandidatenprüfung war ein Roh-JSON-Editor.** Sie erfüllte weder die Roadmap noch eine sichere menschliche Prüfung. Zusätzlich wurden reiche Extraktionsfelder nicht in das Formular übernommen, Realtime konnte einen Lost Update verursachen und ein Typwechsel konnte versteckte ungültige Felder behalten.
4. **Mehrere Kandidatenkorrekturen waren nicht atomar.** Die bestehende RPC erlaubte nur eine Korrektur pro Aufruf; ein später Fehler konnte eine partielle Historie hinterlassen.
5. **Upload-Verifikation hatte Race- und Deadlock-Risiken.** Scanner-Ausfälle konnten die Zwei-Upload-Grenze dauerhaft belegen; parallele Verifier konnten ein freigegebenes Dokument auf einen inzwischen gelöschten Blob zeigen lassen.
6. **Die Dateiprüfung war zu schwach für die Sicherheitsbehauptung.** Signaturprüfung allein ist kein passiver PDF-/OOXML-Parser. PDF-Objektstreams, Escapes und OOXML-Beziehungen/Content-Types benötigen einen gehärteten Parser/CDR-Dienst zusätzlich zum Malware-Scanner.
7. **PWA-Update und Reconnect waren nicht ausreichend abgesichert.** Updates konnten Formulare gefährden; Offline/Reconnect behauptete keinen kanonischen Reload als Mutationsbarriere. Der Cache-Audit deckte private Browser-Stores und Logout nicht vollständig ab.
8. **CI und Betrieb waren zu flach.** Es fehlten vollständige DB-, Browser-, Secret-, Worker-/Cron-, Production-Health- und Rollback-Gates. GitHub Pages liefert keine wirksamen CSP-/Clickjacking-Response-Header.
9. **Produktion war pausiert und unvollständig provisioniert.** Das Projekt wurde wiederhergestellt, hat aber weiterhin nur ein aktives Konto, einen verifizierten TOTP-Faktor und eine aktive Reisemitgliedschaft statt der geforderten zwei.
10. **Supabase-Free-Plan-Grenzen blockieren Anforderungen.** Serverseitige absolute Session-Timebox, Inaktivitätsgrenze und Schutz gegen geleakte Passwörter sind in der gewünschten Form nicht verfügbar. Ein Config-Push mit den bezahlten Session-Optionen scheiterte korrekt mit HTTP 402.

## 3. Was implementiert wurde

### Kandidatenprüfung und Bestätigung

- Roh-JSON durch einen strukturierten Editor für Unterkunft, Flug, Bahn, Bus und Aktivität ersetzt.
- Gemeinsame Felder, typspezifische Felder, Orte, Zeiten, Preise, Referenzen, Kontakte, Reisende, Zusatzattribute und Teilstrecken integriert.
- Reiche Extraktionsfelder werden allowlist-basiert in den kanonischen Entwurf hydratisiert.
- Realtime-Basisversion und Basispayload werden beim Bearbeiten eingefroren; Remote-Änderungen führen zu Konflikt statt Überschreiben.
- Typwechsel entfernt inkompatible versteckte Felder und bei Nicht-Verkehrsarten die Segmente.
- Dirty-State schützt interne Navigation, Hash-/Browser-Zurück und Abmeldung.
- Feldbezogene Korrekturhistorie bleibt erhalten; `other`-Referenzen round-trippen korrekt.
- Barriereärmere Validierungszusammenfassung mit Fokus, `aria-invalid` und Feldverknüpfung.
- Neue atomare Batch-RPC `apply_candidate_review`: alle Feldkorrekturen plus kanonischer Snapshot werden in einer Transaktion geschrieben.

### Extraktion und Kostenkontrolle

- Dauerhafte `extraction_runs`-Queue mit `SKIP LOCKED`, Verfügbarkeit, Leases, höchstens drei Versuchen und Recovery.
- Service-only Worker `process-document-extractions`; Browser-Startfunktion liefert `202` und stößt nur asynchron an.
- Worker-Credential über Function Secret plus Vault; konstante Tokenprüfung und minütlicher Cron.
- Providerkosten werden idempotent vor Schema-/Semantikprüfung verbucht; fehlende Usage wird konservativ mit dem Reservierungsrest bewertet.
- Temporäre Providerdateien werden best-effort gelöscht.
- Lokale Follow-up-Implementierung (noch nicht produktiv): Provideraufruf wird vor dem bezahlten Request gefenced; ein abgelaufener in-flight-Aufruf wird nicht parallel erneut gestartet, sondern konservativ als ungewiss verbucht. Preise inklusive Cached-Input-Rate werden pro Run/Charge gesnapshottet.

### Privater Dokumentupload

- Gemeinsamer Browser-/Edge-Validator für Größen, Typkonflikte, Bilddimensionen, animierte GIFs, UTF-8-Text und strukturelle Vorprüfung.
- Quarantäne bleibt fail-closed; Freigabe erst nach eindeutiger Scannerantwort.
- Scannervertrag mit HTTPS, Bearer-Token, SHA-256 und rohen Bytes dokumentiert.
- Lokale Follow-up-Implementierung (noch nicht produktiv): atomarer `verifying`-Claim mit Lease/Fencing, Publish/Reject/Defer-RPCs, Retrystatus und Reaper. Scanner-Ausfälle zählen nicht mehr dauerhaft als aktive Uploads; UI-Retry wurde ergänzt.
- PDF/OOXML dürfen laut aktualisiertem Runbook nur freigegeben werden, wenn ein externer gehärteter Parser/CDR zusätzlich `passive: true` meldet. `clean: true` allein reicht nicht.

### PWA/Offline

- Kontrollierte Service-Worker-Aktivierung (`prompt`), kein unaufgefordertes `skipWaiting`/`clientsClaim`.
- Formular-/Dirty-State verhindert Update-Aktivierung während offener Arbeit, auch tabübergreifend.
- Shell-only-Precache; keine Runtime-Caches für Auth, REST, Storage oder Functions.
- Offline-/Stale-/Reconnect-Anzeigen und lokale Mutationssperre.
- Lokale Follow-up-Implementierung: gemeinsame kanonische Resync-Barriere; Mutationen bleiben nach Reconnect gesperrt, bis registrierte Datenprovider erfolgreich neu geladen haben.
- Installierbare PNG-/Apple-Touch-Icons und Manifest-Audits.

### CI, Betrieb und Dokumentation

- Node auf `24.15.0` gepinnt.
- CI prüft Produktionsabhängigkeiten, TypeScript, ESLint, Unit/A11y, Build, Bundle, Manifest, PWA-Cache, Secrets, lokale Supabase-Tests/Lint/Advisors und Chromium/WebKit-E2E.
- Deploymentreihenfolge Backend vor Frontend; Secret-/Projektpreflights, Function-Status und Worker-Health wurden ergänzt.
- Täglicher Production-Health-Workflow für Pages, Manifest, Auth, Worker und Cron/pg_net vorbereitet.
- Secret-Scan erweitert; `nanoid`-Produktionslücke aktualisiert, `npm audit --omit=dev` ist sauber.
- Roadmap, Architektur, Threat Model und Extraktionsvertrag aktualisiert.
- Neue Runbooks:
  - `docs/operations/deployment.md`
  - `docs/operations/incidents-and-data-lifecycle.md`

## 4. Produktionsänderungen, die bereits erfolgt sind

- Pausiertes Supabase-Projekt wieder auf `ACTIVE_HEALTHY` gebracht.
- Folgende Migrationen produktiv angewendet:
  - `20260813192437_harden_extraction_worker_queue.sql`
  - `20260813215000_schedule_extraction_worker.sql` (ursprüngliche, sofort planende Fassung)
  - `20260813221000_batch_candidate_review.sql`
  - `20260813224500_reconcile_travel_item_functions.sql`
  - `20260813230500_reconcile_travel_item_schema.sql`
- Produktionsdrift danach fingerprint-genau abgeglichen: Spalten, Constraints, Funktionen, Indizes, Policies, RLS-Flags und Trigger stimmten zwischen lokal und remote überein.
- Remote-DB-Lint war danach sauber.
- Auth-Konfiguration produktiv gehärtet: Signup/Anonymous deaktiviert, JWT-Laufzeit 900 Sekunden, Refresh-Rotation und engere Rate Limits.
- Worker-Credential als GitHub Secret, Supabase Function Secret und zwei Vault-Werte provisioniert. Der geheime Wert wurde nicht dokumentiert.
- Produktiv deployt:
  - `process-document-extractions` v1, `verify_jwt=false`, eigener Worker-Token
  - `start-document-extraction` v20, `verify_jwt=true`
  - `verify-document-upload` v3, `verify_jwt=true` — **alte Produktionsimplementierung**, nicht der neue Scanner/CDR-Verifier
- Cron läuft minütlich; nach Function-Deployment wurden erfolgreiche HTTP-200-Antworten beobachtet.
- Nicht durchgeführt: Commit, Push, PR, Pages-Neudeployment, neuer Upload-Verifier.

## 5. Verifikation nach den P0-Repository-Aufgaben

Grün am 13. August 2026:

- `npm run check`: Typecheck, ESLint, **25 Testdateien / 105 Tests**, Build, Manifest, PWA-Cache-Audit und Secret-Scan bestanden.
- Produktionsbuild erfolgreich; einzige bekannte Warnung ist der große Hauptchunk (ca. 562 KB roh / 153 KB gzip).
- Frischer lokaler `supabase db reset` mit allen aktuellen Migrationen einschließlich `20260813240000_install_extraction_worker_schedule.sql` bestanden.
- `supabase test db`: **9 Dateien / 218 Assertions** bestanden.
- Lokaler DB-Lint mit `--fail-on warning`: sauber.
- Lokale Advisors mit `--fail-on warn`: sauber.
- `scripts/check-production-schema-fingerprint.sql` ist ein einzelnes `DO`-Statement; Signaturen stimmen, Hash `8fb29f5056f933088df7ba601e438655` lokal und remote geprüft.
- `git diff --check`: sauber.
- Vollständige Playwright-Suite: **24/24** in Chromium und WebKit.

Noch offen vor einem Produktions-Deployment:

- Remote-Lint/Advisors und Production-Smoke nach dem nächsten Backend-Rollout erneut prüfen.
- Die zwei noch nicht ausgerollten lokalen Migrationen nicht ohne Secrets/Kompatibilitätsfenster deployen.

## 6. Bekannte Advisor-Warnungen

Produktion meldete 13 Warnungen; nach Review ist `claim_document_verification` die zwölfte namentlich allowlistete RPC:

- Zwölf absichtlich exponierte, serverseitig autorisierte `SECURITY DEFINER`-Mutations-RPCs, einschließlich der geprüften `claim_document_verification`. Sie sind die kontrollierte Schreibgrenze und durch Negativtests abgedeckt. CI besitzt eine namentliche Allowlist. `defer_document_verification`, `reject_document_verification`, `publish_document_verification` und `reap_expired_document_verifications` bleiben `service_role` und stehen nicht auf der Allowlist.
- `auth_leaked_password_protection`: im Free-Plan nicht verfügbar.
- `auth_insufficient_mfa_options`: nur TOTP ist absichtlich aktiviert; Telefon-MFA erfordert Anbieter-, Datenschutz- und Produktentscheidung.

Neue öffentlich ausführbare `SECURITY DEFINER`-Funktionen dürfen nicht stillschweigend zur Allowlist hinzugefügt werden. Autorisierung, AAL2, Mitgliedschaft und Negativtests zuerst prüfen.

## 7. Noch offene Repository-Aufgaben

### P0 — vor Commit oder Deployment

1. **Angewandte Migration `20260813215000` wieder unveränderlich machen.** Erledigt: Datei installiert den Cron-Job wieder sofort. `private.install_extraction_worker_schedule()` und das kontrollierte Unschedule liegen in `20260813240000_install_extraction_worker_schedule.sql`. CI darf den Job erst nach Worker-Deployment wieder installieren.
2. **`scripts/check-production-schema-fingerprint.sql` korrigieren und testen.** Erledigt: Signaturen sind `upsert_location(uuid,uuid,jsonb,uuid)`, `replace_travel_item_aggregate(uuid,uuid,jsonb,uuid,boolean)`, `create_travel_item(uuid,jsonb,text)` und `update_travel_item(uuid,bigint,jsonb,text)`. Das Script ist ein einzelnes `DO`; lokal und remote erfolgreich.
3. **Advisor-Allowlist für neue Verifier-RPC prüfen.** Erledigt: Autorisierung von `claim_document_verification` (Akteur `auth.uid()`, Owner-Zeile, `private.is_active_trip_member` inkl. AAL2, Status-/Lease- und Attempt-Grenzen) geprüft; Publish/Reject/Defer bleiben `service_role`. Negativtests für AAL1, Nichtmitglied, zweites Mitglied und `anon` ergänzt; Funktion ist namentlich allowlistet.
4. **Vollständige Playwright-Suite erneut ausführen.** Erledigt: `npm run test:e2e`, 24/24 in Chromium und WebKit. Der PWA-Cache-Audit ignoriert Fixture-E-Mails im precachten E2E-JS; Session-/Dokumentdaten bleiben außerhalb von HTML/Manifest verboten.
5. **Gesamtdiff manuell reviewen und sinnvoll committen.** Erledigt im Anschluss an diese P0-Reparaturen.
6. **Keine der zwei neuen lokalen Migrationen blind deployen.** Weiterhin gültig: `20260813201059_fence_extraction_calls_and_defer_schedule.sql` und `20260813201223_harden_document_verification.sql` erst nach Cached-Input-Secret und Scanner/CDR-Entscheidung ausrollen. Die neue Schedule-Installer-Migration `20260813240000` ist vorwärtskompatibel, unschedult den Produktions-Cron aber bis zum CI-Schritt nach dem Worker-Deployment.

### P1 — für einen sicheren MVP-Release

1. `OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN` als validiertes Function/GitHub Secret festlegen; neue Fencing-/Pricing-Migration und Worker zusammen deployen.
2. Scanner/CDR-Anbieter auswählen, Region/Aufbewahrung/Löschung/Logs/Kosten prüfen, `MALWARE_SCAN_URL` und `MALWARE_SCAN_TOKEN` setzen und erst dann neuen Verifier ausrollen.
3. Repräsentative synthetische Dateien für PDF, Bild, EML und Office gegen echten Parser/Scanner testen; manipulierte, passwortgeschützte, aktive und Bomben-Fixtures müssen fail-closed bleiben.
4. Vollständigen synthetischen Produktions-Smoke durchführen: Upload, Scanner, Extraktion, absichtliche Worker-Unterbrechung, Retry/Fencing, Kandidatenkorrektur und genau-einmal Bestätigung.
5. Zweites Produktionskonto mit verifiziertem TOTP und zweiter aktiver Mitgliedschaft administrativ anlegen; Zwei-Geräte-/Konflikt-/Realtime-Abnahme durchführen.
6. Response-Header-fähiges Hosting oder Proxy wählen. GitHub Pages liefert aktuell keinen wirksamen `Content-Security-Policy`-/`frame-ancestors`-/Clickjacking-Header.
7. Echte iPhone-/Safari- und Desktop-Safari-Tests für Installation, Update, Offline, Reconnect, Formulare, MFA und Dokumentflows.
8. Backup/Restore-Probe und realen Rollbacknachweis dokumentieren.

### P2 — Produkt-/Betriebsentscheidungen

1. Dokument-, TravelItem-, Konto- und Gesamtlöschung inklusive Verknüpfungen und Aufbewahrungsfristen entscheiden und implementieren.
2. Verschlüsselten Export sowie belastbaren Backup-/Restore-Prozess festlegen.
3. Supabase-Pro-Upgrade oder gleichwertige serverseitige Strategie für absolute Session-/Inaktivitätsgrenzen und Leaked-Password-Schutz entscheiden.
4. Anbieter-/Provider-Datenaufbewahrung und laufende Preisverantwortung benennen.
5. Bundle-Code-Splitting angehen; aktuell nur Warnung, kein Funktionsblocker.
6. Karte bleibt bewusst Nach-MVP und benötigt formale Scope-Freigabe.

## 8. Empfohlene Fortsetzungsreihenfolge

1. P0-Repository-Aufgaben sind erledigt (Migrationsimmutabilität, Fingerprint, Allowlist, volle E2E-Suite, Commits).
2. Cached-Input-Secret setzen und Extraction-Fencing als zusammenhängendes Backend-Release ausrollen; Worker/Health/Cron beweisen.
3. Scanner/CDR-Entscheidung treffen; erst danach Verifier-Migration + Function deployen.
4. Zweites Konto/Geräteabnahme, Hosting-Header, Backup/Restore und vollständigen Produktions-Smoke abschließen.

## 9. Primäre Dateien für die Fortsetzung

- Status und Blocker: `docs/roadmap.md`
- Deployment: `docs/operations/deployment.md`
- Incidents/Lebenszyklus: `docs/operations/incidents-and-data-lifecycle.md`
- CI: `.github/workflows/ci.yml`
- Production Health: `.github/workflows/production-health.yml`
- Extraction-Fencing (lokal): `supabase/migrations/20260813201059_fence_extraction_calls_and_defer_schedule.sql`
- Verifier-Fencing (lokal): `supabase/migrations/20260813201223_harden_document_verification.sql`
- Worker: `supabase/functions/process-document-extractions/index.ts`
- Upload-Verifier: `supabase/functions/verify-document-upload/index.ts`
- Kandidateneditor: `src/ui/CandidateReviewPage.tsx`, `src/ui/CandidateTravelItemEditor.tsx`
- Reconnect-Barriere: `src/pwa/context.tsx`, `src/pwa/network.ts`

## 10. Offizielle Referenzen

- Supabase Scheduled Functions: <https://supabase.com/docs/guides/functions/schedule-functions>
- Supabase Edge Function Auth: <https://supabase.com/docs/guides/functions/auth>
- Supabase Password Security: <https://supabase.com/docs/guides/auth/password-security>
- Supabase MFA: <https://supabase.com/docs/guides/auth/auth-mfa>
- OpenAI File Inputs: <https://developers.openai.com/api/docs/guides/file-inputs>
- OpenAI Structured Outputs: <https://developers.openai.com/api/docs/guides/structured-outputs>
