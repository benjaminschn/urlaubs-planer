# Deployment- und Betriebsrunbook

**Stand:** 13. August 2026
**Produktion:** `https://benjaminschn.github.io/urlaubs-planer/` und Supabase-Projekt `pvqawohdklzxpruodydy`

## Release-Gate

Ein Release darf nur von einem unveränderten Commit erfolgen, auf dem diese Prüfungen erfolgreich waren:

```sh
npm ci
npm audit --omit=dev --audit-level=high
npm run check
npx playwright install chromium webkit
npm run test:e2e
supabase start
supabase test db --local supabase/tests
supabase db lint --local --schema public,private --level warning --fail-on warning
supabase db advisors --local --type all --level warn --fail-on warn
```

Die Browser-Suite läuft in Chromium und Playwright-WebKit. Vor einem MVP-Release bleiben die manuellen Prüfungen auf echtem iPhone/Safari und Desktop-Safari verpflichtend; WebKit ist dafür nur ein automatisierter Frühindikator.

## Benötigte GitHub-Konfiguration

Repository-Variablen:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Secrets der GitHub-Umgebung `supabase-production`:

- `SUPABASE_ACCESS_TOKEN`
- `PRODUCTION_DB_PASSWORD`
- `PRODUCTION_PROJECT_ID`
- `EXTRACTION_WORKER_TOKEN` (mit `openssl rand -hex 32` erzeugter 64-stelliger Hexwert)

Erforderliche Supabase-Function-Secrets werden vor dem Function-Deployment namentlich geprüft:

- `APP_ORIGIN`
- `OPENAI_API_KEY`
- `OPENAI_EXTRACTION_MODEL`
- `OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS`
- `OPENAI_INPUT_MICRO_EUR_PER_TOKEN`
- `OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN`
- `OPENAI_OUTPUT_MICRO_EUR_PER_TOKEN`
- `OPENAI_MAX_RUN_COST_MICRO_EUR`
- `OPENAI_PRICING_VERSION`
- `EXTRACTION_WORKER_TOKEN`
- `MALWARE_SCAN_URL`
- `MALWARE_SCAN_TOKEN`

Secrets werden nie als `VITE_*` gesetzt und nie an den Frontend-Build übergeben.

## Malware-Scanner-Vertrag

`verify-document-upload` gibt kein Dokument frei, solange die Schadsoftwareprüfung nicht eindeutig `clean` meldet. Der Scanner muss per HTTPS erreichbar sein und folgenden Vertrag erfüllen:

- Request: `POST MALWARE_SCAN_URL`
- Header: `Authorization: Bearer <MALWARE_SCAN_TOKEN>`
- Header: tatsächlicher `Content-Type` und `X-Content-SHA256`
- Body: rohe Dokumentbytes, maximal 20 MiB
- Erfolgsantwort für Bilder/Text: HTTP 2xx mit JSON `{ "clean": true }` oder `{ "clean": false }`
- PDF/OOXML werden nur freigegeben, wenn derselbe isolierte Dienst zusätzlich `{ "passive": true }` nach gehärtetem Parse/CDR meldet. Ein bloßes Malware-`clean` reicht für Containerformate ausdrücklich nicht.
- Timeout, nicht-2xx oder jede andere Antwort: Prüfung nicht verfügbar; das Original bleibt privat in Quarantäne und erhält niemals den Status `available`
- `clean: false`: Blob wird gelöscht, Metadaten werden als `invalid`/`malware_detected` markiert

Vor der Scanner-/Parser-Auswahl sind Anbieterregion, Aufbewahrung, Log-Redaktion, Löschung, Verfügbarkeit, 20-MiB-Limit, CDR-/Parser-Fähigkeit und Kosten schriftlich zu prüfen. Der Token darf nur als Supabase-Secret vorliegen. Die lokale Byteprüfung ist nur eine Vorfilterung und darf nicht als vollständiger passiver PDF-/OOXML-Parser beschrieben werden.

## Automatischer Ausrollweg

Bei Push auf `master`/`main` führt CI diese Reihenfolge aus:

1. vollständige lokale Qualitäts-, Datenbank- und Browser-Gates;
2. Projektstatus, Worker-Credential, Function-Secrets und den Migration-Dry-Run ohne Mutation prüfen;
3. vorwärtskompatible Migrationen ausrollen und den erwarteten Travel-Item-Schema-Fingerprint prüfen;
4. Auth-/Projektkonfiguration ausrollen;
5. Worker-Credential als Function-Secret und in Vault provisionieren;
6. alle versionierten Edge Functions ausrollen, `ACTIVE` und den authentifizierten Worker-Healthcheck verifizieren;
7. erst danach den Cron-Job aktivieren und eine erfolgreiche Cron-/`pg_net`-Ausführung abwarten;
8. unveränderliches Pages-Artefakt bauen und veröffentlichen;
9. öffentliche Seite und Manifest abrufen.

## Manueller Rollback

- Frontend: vorherigen guten Commit erneut über den normalen Workflow ausrollen. Kein manuelles Überschreiben des Pages-Artefakts.
- Edge Functions: die Function-Dateien des vorherigen guten Commits mit der dort gepinnten CLI-Version erneut deployen.
- Datenbank: keine destruktive Down-Migration. Fehler werden durch eine neue, vorwärtsgerichtete Korrekturmigration behoben. Vor einer destruktiven Korrektur zuerst Backup-/Restore-Möglichkeit und exakte Zielzeilen prüfen.
- Scanner-Störung: Scanner nicht umgehen. Upload bleibt in Quarantäne; bestehende freigegebene Dokumente und manuelle Reiseplanung bleiben verfügbar.
- OpenAI-Störung: Worker aussetzen beziehungsweise nicht erneut anstoßen. Ein Lease ohne begonnenen Responses-Aufruf darf begrenzt wiederaufgenommen werden. Ein abgelaufener Lease nach gesetztem Provider-Fence wird dagegen nie automatisch wiederholt und konservativ bis zur reservierten Obergrenze abgerechnet. Keine Kandidaten manuell als Modellresultat in die DB schreiben.

## Wiederherstellung eines pausierten Supabase-Projekts

1. Dashboard öffnen und exakte Projekt-ID prüfen.
2. `Resume project` bestätigen.
3. Warten, bis `supabase projects list --output json` für die Projekt-ID `ACTIVE_HEALTHY` meldet.
4. `supabase migration list --linked`, Function-Liste und Secret-Namen prüfen.
5. Migrationen/Functions nicht blind erneut ausrollen; zuerst lokalen Commit, Remote-Migrationsstand und erwartete Function-Versionen vergleichen.
6. Auth-Health, Anmeldung, Reisekopf, Dokumentliste und einen ungefährlichen manuellen Timeline-Read prüfen.

Der tägliche Workflow `Production health` prüft Pages, Manifest, Supabase Auth, den authentifizierten Worker sowie eine höchstens zehn Minuten alte erfolgreiche Cron- und `pg_net`-Ausführung. Eine fehlgeschlagene Action ist ein Incident-Signal. Ein kostenpflichtiges Upgrade zur Vermeidung von Inaktivität ist eine separate finanzielle Entscheidung und kein automatischer Recovery-Schritt.

## Einmaliges Drift-Reparaturfenster vom 13. August 2026

Die vorwärtsgerichtete Reparatur besteht historisch aus zwei bereits angewendeten Migrationen: `20260813224500_reconcile_travel_item_functions.sql` wurde vor `20260813230500_reconcile_travel_item_schema.sql` eingecheckt. Zwischen deren einzelnen Commits konnte deshalb einmalig eine Function-Version sichtbar sein, deren neue `owner_travel_item_id`-Annahme noch nicht durch die Tabellenspalte und Constraints abgesichert war. Die angewendeten Migrationen werden nicht nachträglich verändert. Für genau dieses erste Reparatur-Rollout müssen Schreibzugriffe bis zum erfolgreichen Abschluss beider Migrationen pausiert bleiben; schlägt die zweite Migration fehl, bleibt der Release gestoppt und die Korrektur erfolgt ausschließlich durch eine neue Vorwärtsmigration.

Nach diesem einmaligen Intervall vergleicht CI nach jedem Datenbank-Rollout den kanonischen Fingerprint der `locations`-/`travel_items`-Spalten und Constraints sowie der vier dazugehörigen privaten/öffentlichen Mutationsfunktionen über `scripts/check-production-schema-fingerprint.sql`. Eine Abweichung stoppt Function- und Frontend-Deployment. Der erwartete Fingerprint darf nur nach lokalem Reset, vollständigem pgTAP-Lauf und bewusster Prüfung der gemeinsam geänderten Schema-/Function-Verträge aktualisiert werden.

Der Supabase-Free-Plan akzeptiert keine serverseitige Session-Timebox oder Inaktivitätsgrenze. Diese Werte dürfen daher nicht in `config.toml` stehen, solange Produktion im Free-Plan läuft, weil sonst der gesamte Auth-Config-Push mit HTTP 402 scheitert. JWT-Laufzeit, Refresh-Token-Rotation, deaktivierte Signups und Auth-Ratenlimits bleiben gesetzt. Vor Release ist ein Pro-Upgrade oder eine gleichwertige serverseitige Sitzungsstrategie ausdrücklich zu entscheiden.

Die Produktions-Advisors melden zusätzlich bewusst dokumentierte Warnungen. Die zwölf öffentlichen mutierenden RPCs sind absichtlich `SECURITY DEFINER`: Sie sind die einzige Schreibgrenze, prüfen Akteur, AAL2, aktive Mitgliedschaft, Version und Idempotenz serverseitig und sind durch Negativtests abgedeckt. CI akzeptiert ausschließlich diese namentlich festgelegten RPCs; jeder neue Fund bricht das Deployment. Die Warnung zum Schutz vor geleakten Passwörtern bleibt im Free-Plan offen, weil Supabase diese Prüfung erst ab Pro anbietet. Als MFA-Verfahren ist für dieses private MVP bewusst nur TOTP freigegeben; Telefon-MFA würde einen zusätzlichen SMS-/Telefonanbieter, Datenschutzprüfung und Produktflow benötigen und wird nicht nur zur Beseitigung einer generischen Advisor-Warnung aktiviert.

## Release-Smoke-Test

- Unauthentifizierter Deep Link zeigt nur Anmeldung.
- Beide vorab eingerichteten Konten melden sich mit TOTP an und sehen dieselbe Reise.
- Reiseänderung auf Gerät A wird auf Gerät B nach Invalidierung/Reload sichtbar.
- Ein manuelles Ereignis wird erstellt, bearbeitet und fachlich gelöscht.
- Ein passives Testdokument durchläuft statische Prüfung und Scanner; Download erfolgt nur über authentifizierten Storage-Zugriff.
- Eine absichtlich abgelehnte Testdatei wird nie freigegeben.
- Eine Extraktion wird gequeued, vom Worker geleast und endet deterministisch; der Kandidat erscheint nicht ohne Bestätigung in der Timeline.
- Kandidat wird feldweise korrigiert und genau einmal bestätigt.
- Offline werden keine Mutationen als gespeichert dargestellt; nach Reconnect wird der Serverstand neu geladen.
- Kontrolliertes Service-Worker-Update wird bei offenem Formular zurückgestellt.

Keine echten Buchungsnummern, Namen oder Reisebelege für Smoke-Tests verwenden.
