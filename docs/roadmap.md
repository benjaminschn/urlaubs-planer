# Umsetzungsroadmap: Gemeinsamer Reiseplaner

**Status:** Privater Zwei-Personen-MVP; Code lokal grün, Backend-Stand in Produktion unvollständig
**Stand:** 15. August 2026
**Aktueller Betriebsstand und nächste Schritte:** [Handoff](operations/handoff.md)
**Grundlagen:** [Produktbrief](product/brief.md), [UX-Flows](ux/flows.md), [Systemarchitektur](architecture/system.md), [Domain-Modell](data/domain-model.md), [Extraktionsvertrag](ai/extraction.md) und [Threat Model](security/threat-model.md)

## 0. Nachweisbarer Implementierungsstand

Diese Tabelle ist die Produktsicht. Git-Stand, Secrets, ausstehende Migrationen und die genaue Fortsetzungsreihenfolge stehen nur im [Handoff](operations/handoff.md). Deploy: [Deployment](operations/deployment.md). Incidents: [Incident- und Datenlebenszyklus](operations/incidents-and-data-lifecycle.md).

| Schnitt | Stand | Noch offen |
| --- | --- | --- |
| 1 – PWA/Auth/Deployment | Produktiv für ein Konto | Zweites TOTP-Konto. Pages-Header und Free-Plan-Sessionlimits sind akzeptiert. |
| 2 – Gemeinsame Reise/Realtime | Implementiert | Zweite Produktionsmitgliedschaft. |
| 3 – Manuelle Ereignisse/Timeline | Implementiert, lokal geprüft | Manuelle Geräteabnahme. |
| 4 – Privater Dokument-Upload | Implementiert, neuer Verifier nicht in Produktion | Kontrolliertes Function-/Migrations-Deploy. Kein externer Scanner. |
| 5 – Dokumentextraktion | Worker produktiv; neue Fencing-/Preis-Migrationen nicht | OpenAI-Function-Secrets setzen, dann ausrollen. Weiches App-Budget, hartes OpenAI-Kontolimit. |
| 6 – Kontroll-/Korrekturansicht | Implementiert, lokal geprüft | Originalvergleich auf Zielgeräten. |
| 7 – Bestätigung/Timeline | Implementiert, DB-geprüft | Ein Produktions-Smoke mit beiden Konten. |
| 8 – Karte | Nicht begonnen | Nur nach Scope-Freigabe. |
| 9 – Offline-/PWA-Politur | Implementiert, lokal in Chromium/WebKit geprüft | iPhone/Safari bei Gelegenheit. |

### Nächste Arbeit

1. OpenAI-Function-Secrets in Supabase setzen (siehe Handoff).
2. Diesen Branch nach gesetzten Secrets über `master` ausrollen.
3. Zweites persönliches Konto mit TOTP und Mitgliedschaft anlegen.
4. Einmal Upload, Extraktion und Bestätigung in Produktion prüfen.

Dokumentlöschung, Backup-Probe und Supabase-Pro sind später optional.

## 1. Ziel und Lesart

Diese Roadmap zerlegt das Produkt in kleine, vertikale und jeweils eigenständig deploybare Schnitte. Jeder Schnitt liefert einen sichtbaren Nutzerwert, enthält die dafür erforderlichen Frontend-, Backend-, Daten- und Sicherheitsanteile und lässt alle bereits ausgelieferten Funktionen weiter nutzbar.

Für jeden Schnitt gilt:

- Datenbankänderungen werden vorwärtskompatibel und vor dem davon abhängigen Frontend ausgerollt.
- Unfertige Oberflächen oder unvollständig abgesicherte Endpunkte bleiben bis zur Abnahme unerreichbar beziehungsweise hinter einem standardmäßig deaktivierten Feature-Schalter.
- Der kanonische Stand liegt in PostgreSQL. Der Browser zeigt eine Mutation erst nach Serverbestätigung als gespeichert an.
- Clientvalidierung dient der UX; Autorisierung, Zustände, Limits, Idempotenz und fachliche Invarianten werden serverseitig erzwungen.
- Neue exponierte Tabellen starten mit Default-Deny, aktivierter RLS und ohne unerwartete Grants. Jede neue Kindtabelle erhält den Policy-Pfad ihres Reise-Aggregats.
- Testdaten enthalten keine echten Reisebestätigungen. Für Autorisierungstests existieren zwei legitime Konten, ein authentifiziertes Nichtmitglied und eine zweite Testreise.
- Ein Schnitt ist erst abgeschlossen, wenn automatisierte Tests, die beschriebenen manuellen Tests und die Sicherheitsprüfungen bestanden sind und ein Rollback-Weg dokumentiert ist.

## 2. Umfang, Reihenfolge und Release-Grenzen

| Nr. | Vertikaler Schnitt | Auslieferbares Ergebnis | Einordnung |
| --- | --- | --- | --- |
| 1 | PWA-Grundgerüst, Auth und Deployment | Beide Personen erreichen eine sicher ausgelieferte App und können sich an- und abmelden. | MVP |
| 2 | Gemeinsame Reise und Realtime-Synchronisierung | Beide sehen und pflegen denselben Reisekopf; Änderungen werden konfliktfest synchronisiert. | MVP |
| 3 | Manuelle Reiseereignisse und Timeline | Alle fünf Ereignisarten können ohne Dokument angelegt, gelesen, geändert und gelöscht werden. | MVP |
| 4 | Privater Dokument-Upload | Private Originale können sicher hochgeladen, aufgelistet und abgerufen werden. | MVP |
| 5 | Extraktion eines Dokuments | Ein Original kann genau einmal kontrolliert verarbeitet werden und erzeugt nur unbestätigte Kandidaten. | MVP |
| 6 | Kontroll- und Korrekturansicht | Extrahierte Kandidaten können vollständig mit dem Original verglichen und korrigiert werden. | MVP |
| 7 | Bestätigung und Übernahme in die Timeline | Ein geprüfter Kandidat wird atomar und idempotent zum bestätigten Timeline-Ereignis. | MVP-Funktionsumfang vollständig |
| 8 | Karte | Bestätigte Ereignisse mit Koordinaten können räumlich eingeordnet werden. | Nach-MVP, nur nach Scope-Freigabe |
| 9 | Offline- und PWA-Politur | Die installierbare Online-first-PWA verhält sich bei Verbindungswechseln und Updates robust. | MVP-Release-Gate |

Der verbindliche MVP-Pfad ist **1 → 2 → 3 → 4 → 5 → 6 → 7 → 9**. Schnitt 8 steht an der gewünschten Position in der Produktentwicklung, ist laut Produktbrief aber ausdrücklich kein MVP-Bestandteil. Er darf unabhängig nach Schnitt 7 umgesetzt werden und ist keine Abhängigkeit für Schnitt 9.

„Realtime“ in Schnitt 2 bedeutet Änderungssignale mit anschließendem Neuladen des kanonischen Datensatzes. Gleichzeitige Feldbearbeitung, automatische Zusammenführung, Kommentare und ein sichtbarer Änderungsverlauf bleiben ausgeschlossen. „Offline“ in Schnitt 9 bedeutet ausschließlich App-Shell, neutrale Offline-Seite, transparente Verbindungszustände und Wiederabgleich; private Reisedaten, Dokumente und Mutationen werden nicht offline gespeichert.

### Auslegung eines Grundlagenkonflikts

Die UX-Flows beschreiben eine einmalige Reiseanlage in der PWA. Die strengere RLS-Matrix im Threat Model erlaubt `Trip.INSERT` dagegen nur der Administration; auch die Architektur sieht die beiden Mitgliedschaften als einmaligen administrativen Schritt vor. Diese Roadmap folgt bis zu einer anderslautenden, dokumentübergreifenden Entscheidung der strengeren Grenze: Reise und Mitgliedschaften werden administrativ bereitgestellt, beide Mitglieder dürfen anschließend Titel und Zeitraum bearbeiten. Soll die PWA die Erstanlage übernehmen, müssen Architektur, RLS-Matrix und Negativtests vor Schnitt 2 gemeinsam angepasst und eine eng begrenzte atomare Bootstrap-Operation spezifiziert werden.

## 3. Entscheidungen vor dem jeweiligen Start

Offene Entscheidungen werden nicht stillschweigend durch Implementierungsdetails vorweggenommen.

| Spätestens vor Schnitt | Zu entscheiden beziehungsweise aktuell zu verifizieren |
| --- | --- |
| 1 | Zielumgebungen, GitHub-Pages-Verfügbarkeit im verwendeten Tarif, Produktionsorigin, Domains, E-Mail-/Passwort- und TOTP-MFA-Konfiguration, Session-Laufzeiten, CSP-/Security-Header-Auslieferung und administrativer Kontowiederherstellungsweg |
| 2 | Physische Form von `User`, `Trip` und `TripMember`, ID-Variante sowie administrativer Seed-Prozess für genau zwei Konten, eine aktive Reise und zwei Mitgliedschaften; alternativ formale Freigabe einer kontrollierten Bootstrap-Operation |
| 3 | Physische Form der TravelItem-Details und wiederholbaren Gruppen, gemischte Zeitpräzision, Zeitzonen-Eingabe, Revisionsaufbewahrung und Zählweise von Tombstones |
| 4 | Wirksame Datei-/Mengenlimits, lokale Signatur-/Strukturprüfung, Aufbewahrung verworfener Originale, gesondertes Dokumentlöschrecht und Tombstone-Umfang. Kein externer Scanner. |
| 5 | Modell, Preisumrechnung als weiche Run-Reservierung, hartes Limit im OpenAI-Konto, Löschung temporärer Providerdateien |
| 6 | UX-Regel für Teilstrecken-Gruppierung, Kandidatenaufbewahrung und Wirkung von „Verwerfen“ |
| 7 | Auswirkung einer TravelItem-Löschung auf Verknüpfungen sowie Regel, ob und wie ein Kandidat ein bestehendes TravelItem aktualisieren darf |
| 8 | Formale Änderung des Produktumfangs, Karten-/Tile-Anbieter oder Self-Hosting, Datenschutzfolgen, Datenübermittlung, Lizenz/Attribution, Kosten und CSP-Erweiterung |
| 9 | Update-Strategie des Service Workers, Cache-Inventar und unterstützte Browser-/iOS-Versionen zum Releasezeitpunkt |

## 4. Schnitt 1 – PWA-Grundgerüst, Auth und Deployment

### Nutzerwert

Die beiden vorab eingerichteten Personen können die echte, sicher ausgelieferte Anwendung auf iPhone und Desktop öffnen, sich mit ihrem persönlichen Konto inklusive MFA anmelden, einen neutralen geschützten Startzustand sehen und sich zuverlässig abmelden.

### Abhängigkeiten

- Keine vorherigen Produktschnitte.
- Entscheidungen zu Zielumgebungen, Origin, Auth-Konfiguration, Session-Laufzeiten und CSP sind getroffen.
- Die zwei persönlichen Supabase-Auth-Konten sind administrativ angelegt und bestätigt; öffentliche Registrierung, anonyme Anmeldung und Self-Service-Recovery sind deaktiviert.
- GitHub- und Supabase-Zielumgebungen sowie deren getrennte Deployment-Zugänge sind vorhanden.

### Betroffene Komponenten

- React-/TypeScript-/Vite-PWA, Hash-Routing, responsive App-Shell und deutsche Grundtexte
- Supabase Auth, Sitzungsverwaltung und MFA
- Öffentliche Supabase-Projekt-URL und Publishable-/Anon-Key im Frontend
- GitHub Actions für Typecheck, Lint, Tests, Produktionsbuild und GitHub Pages
- Getrennter Supabase-Deployment-Pfad ohne Übergabe privilegierter Secrets an `vite build`
- CSP, Referrer-Policy, Fehlerbehandlung, Secret-Scan und minimale Betriebsdokumentation

### Konkrete Akzeptanzkriterien

- Beide vorab eingerichteten Konten können sich mit E-Mail, Passwort und TOTP-MFA anmelden und anschließend abmelden.
- Ohne gültige Sitzung zeigt jeder geschützte Einstieg ausschließlich die Anmeldung; vor der Authentifizierung blitzen keine privaten Inhalte auf.
- Nach Anmeldung erscheint ein neutraler geschützter Startzustand. Registrierung, Einladung, Rollenwahl und Self-Service-Recovery werden nirgends angeboten.
- Mehrfaches Tippen auf „Anmelden“ erzeugt höchstens einen laufenden Vorgang. Fehler sind verständlich, nicht rein farblich und verraten nicht, ob eine fremde E-Mail existiert.
- Deep Links verlangen zuerst eine gültige Sitzung und führen danach nur zu einem berechtigten Ziel oder zu einem neutralen Nicht-gefunden-Zustand.
- Nach Abmeldung oder Session-Ablauf sind geschützte Routen gesperrt; Browser-Zurück zeigt keine zuvor gerenderten privaten Inhalte.
- Der Produktionsbuild läuft mit korrektem GitHub-Pages-Basispfad, ist über HTTPS erreichbar und enthält ausschließlich statische öffentliche Assets.
- Die App-Shell funktioniert ab 375 CSS-Pixel Breite ohne horizontales Scrollen und bleibt per Tastatur bedienbar.

### Automatisierte Tests

- Unit-Tests für Auth-Zustandsautomat, Redirect-Merker, Mehrfachauslösung, neutrale Fehlerzuordnung und Logout-Bereinigung
- Komponenten-/Accessibility-Tests für Labels, Fokusreihenfolge, sichtbaren Fokus, Fehlerzusammenfassung und Screenreader-Status
- Browser-E2E für Anmeldung, MFA, geschützte Route, Abmeldung, Session-Ablauf und direkten Deep Link
- CI-Gates für Typecheck, Lint, Tests, Production Build, Basispfad, Manifest-Grundprüfung und Bundle-Größenwarnung
- Secret-Scan von Repository, Build-Artefakt und Source Maps auf OpenAI-, Service-Role-, JWT- und Deployment-Token-Muster
- Negativtests AUTH-01, AUTH-05 sowie ein Test gegen Registrierung und anonyme Anmeldung

### Manuelle Tests auf iPhone und Desktop

- **iPhone/Safari, 375 CSS-Pixel und größer:** Anmeldung mit Passwortmanager und TOTP-App-Wechsel, falsches Passwort, Mehrfach-Tap, Abmeldung, Zurück-Geste, Tastatur, größere Schrift und Hoch-/Querformat prüfen.
- **iPhone/Standalone-Vorbereitung:** App öffnen und prüfen, dass Safe Areas und Safari-Bedienelemente keine Primäraktion verdecken; Installation ist in diesem Schnitt noch kein Abnahme-Gate.
- **Desktop/Safari oder Chrome:** Anmeldung, MFA, Tastaturbedienung, direkter Deep Link, Reload, Session-Ablauf und Abmeldung prüfen.
- In beiden Formfaktoren Netzwerkfehler während Anmeldung und Abmeldung auslösen; die App darf keinen falschen Erfolgszustand anzeigen.

### Sicherheitsprüfungen

- Der Browser erhält niemals OpenAI-Key, Service Role oder Deployment-Zugang; `VITE_*` enthält nur öffentliche Supabase-Konfiguration.
- Access Token maximal 15 Minuten, rotierende Refresh Tokens, maximale fortlaufende Sitzung 30 Tage und erneute Anmeldung nach 24 Stunden Inaktivität sind konfiguriert und geprüft.
- Fehlgeschlagene Logins werden pro Konto und IP auf fünf Versuche in 15 Minuten mit neutraler progressiver Verzögerung begrenzt.
- Nutzeränderbare `user_metadata`-Werte haben keine Autorisierungswirkung.
- CSP erlaubt nur die erforderlichen Ursprünge; keine unnötigen Drittanbieter-Skripte, Analytics oder Session-Replays sind eingebunden.
- Ein widerrufener oder abgelaufener Token kann geschützte Daten-, Storage-, Realtime- oder Function-Zugriffe nicht wiederherstellen.

### Definition of Done

- Alle Akzeptanzkriterien, automatisierten Tests, manuellen Tests und Sicherheitsprüfungen dieses Schnitts sind bestanden.
- Ein unveränderliches Frontend-Artefakt ist in der Zielumgebung veröffentlicht; Deployment und dokumentierter Rollback wurden einmal erfolgreich ausgeführt.
- Die zwei Konten und MFA sind administrativ geprüft; öffentliche Auth-Flows bleiben deaktiviert.
- Build und Laufzeit enthalten keine privilegierten Secrets; eine zweite Person hat den Secret-Scan und die Environment-Trennung geprüft.
- Auth-Betrieb, Kontosperre, Session-Widerruf und administrative Wiederherstellung sind kurz dokumentiert.

## 5. Schnitt 2 – Gemeinsame Reise und Realtime-Synchronisierung

### Nutzerwert

Beide Personen sehen denselben Reisetitel und Zeitraum, können diese Daten ändern und erhalten Änderungen der anderen Person zeitnah, ohne dass gleichzeitige Bearbeitung unbemerkt Daten überschreibt.

### Abhängigkeiten

- Schnitt 1 ist produktiv und stabil.
- Die physische Abbildung von `User`, `Trip` und `TripMember` sowie der administrative Seed-Prozess sind entschieden.
- Genau zwei Auth-IDs sind derselben administrativ bereitgestellten Reise zugeordnet; Reiseanlage und Mitgliedschaften sind über die PWA unveränderlich.

### Betroffene Komponenten

- Geschützter Reisekopf, Reise-einrichten/-bearbeiten-Formular und leerer Timeline-Platzhalter
- PostgreSQL: `User`, `Trip`, `TripMember`, Versionierung, Invarianten und Indizes
- RLS-Policies und gegebenenfalls nicht exponierte Mitgliedschaftshilfe
- Supabase Realtime als Invalidierungssignal
- Query-/Cache-Invalidierung, vollständiger Wiederabgleich und Versionskonflikt-UX
- Migrationen und administrativer Seed-/Verifikationsprozess

### Konkrete Akzeptanzkriterien

- Die administrativ bereitgestellte Reise kann von beiden Mitgliedern mit Titel, Start- und Enddatum gepflegt werden; ein Einstieg zur Anlage einer zweiten Reise wird nicht angeboten.
- Fehlt die bereitgestellte Reise oder eine Mitgliedschaft, erscheint ein neutraler Konfigurationsfehler ohne Reiseinformationen und ohne clientseitigen `Trip.INSERT`-Versuch.
- Fehlende Werte oder `end_date < start_date` verhindern das Speichern feldnah und in einer Fehlerzusammenfassung.
- Beide Mitglieder können Titel und Zeitraum lesen und ändern; ein Nichtmitglied und `anon` erhalten weder Daten noch unterscheidbare Existenzhinweise.
- Unter gesunder Verbindung sieht der zweite gleichzeitig geöffnete Client eine bestätigte Änderung nach dem Realtime-Signal und kanonischem Reload spätestens innerhalb von fünf Sekunden.
- Fällt Realtime aus, bleibt der Serverstand korrekt und ist spätestens nach Reload, Fokus-Rückkehr oder Wiederverbindung identisch.
- Zwei Änderungen auf derselben gelesenen Version führen zu genau einem Erfolg. Die zweite Person erhält einen Versionskonflikt und kann den neuen Stand laden; es findet keine automatische Zusammenführung statt.
- Realtime-Payloads werden nicht direkt als kanonischer Zustand übernommen, sondern invalidieren ausschließlich die betroffene Abfrage.
- Wiederholtes Absenden erzeugt weder eine zweite Reise noch mehr als eine Versionserhöhung.

### Automatisierte Tests

- Datenbanktests für `end_date >= start_date`, höchstens eine aktive Reise, genau zwei aktive Mitglieder im produktiven Seed und monoton erhöhte Versionen
- Vollständige RLS-Matrix für `User`, `Trip` und `TripMember` als `anon`, Mitglied und Nichtmitglied, einschließlich `USING`/`WITH CHECK`
- Integrationstest mit zwei Browserkontexten: Änderung in A, Realtime-Invalidierung und Reload in B
- Konflikttest mit zwei parallelen Updates auf dieselbe Version; genau eines gewinnt
- Reconnect-Test: Realtime unterbrechen, Reise ändern, Verbindung wiederherstellen und vollständigen Stand laden
- E2E für bereitgestellte Reise, fehlende Konfiguration, Validierungsfehler, Bearbeiten, Reload und den fehlenden „zweite Reise“-Einstieg
- Negativtests AUTH-01 bis AUTH-05 und DB-03 für die in diesem Schnitt vorhandenen Ressourcen

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** bereitgestellte Reise bearbeiten, Datumsauswahl, Fehlerfokus, langsame Verbindung, App-Wechsel und Wiederaufnahme testen.
- **Desktop:** Zweites Konto parallel öffnen; Änderungen wechselseitig auslösen und Realtime-Anzeige sowie Reload-Fallback prüfen.
- Gleichzeitig auf iPhone und Desktop dasselbe Formular öffnen, zuerst auf einem Gerät speichern und auf dem anderen den Versionskonflikt nachvollziehen.
- Offline gehen, Reisetitel auf dem anderen Gerät ändern, wieder online gehen und prüfen, dass der kanonische Stand ohne doppelte Mutation geladen wird.

### Sicherheitsprüfungen

- RLS ist auf jeder exponierten Tabelle aktiv; `anon` besitzt keine Datenrechte, und `authenticated` ohne aktive Mitgliedschaft reicht nicht aus.
- `TripMember` kann aus der PWA weder angelegt, geändert noch gelöscht werden; `user_metadata` kann keine Reisezuordnung erzeugen.
- Ein Wechsel von `trip_id`, Akteurs-ID oder Eltern-FK auf eine fremde Reise wird durch `WITH CHECK` beziehungsweise die kontrollierte Transaktion abgelehnt.
- Realtime liefert dem Nichtmitglied keine Zeile und kein Ereignis; Payload und Fehler verraten keine fremden Reiseinformationen.
- Views sind `security_invoker` oder für Browserrollen gesperrt; privilegierte Funktionen liegen nicht exponiert, haben festen `search_path` und kein `EXECUTE` für `PUBLIC`.

### Definition of Done

- Reiseanlage, Bearbeitung, Realtime-Invalidierung, Reload-Fallback und Konfliktbehandlung sind deployt und auf beiden Zielgeräten abgenommen.
- Migrationen sind reproduzierbar, vorwärtskompatibel und gegen eine leere sowie eine bereits initialisierte Testumgebung geprüft.
- Seed- und Verifikationsprozess beweisen genau zwei aktive Mitglieder und höchstens eine aktive Reise.
- RLS-/Realtime-Negativtests sind Deployment-Gate; kein unerwartet erlaubter Zugriff bleibt offen.
- Die bisherige Auth-Funktion aus Schnitt 1 bleibt unverändert nutzbar.

## 6. Schnitt 3 – Manuelle Reiseereignisse und Timeline

### Nutzerwert

Die Reise ist bereits ohne Dokumentautomatik vollständig planbar: Beide Personen können Unterkunft, Flug, Bahn, Bus und Aktivität manuell erfassen, in einer verlässlichen Timeline sehen, im Detail öffnen, bearbeiten und fachlich löschen.

### Abhängigkeiten

- Schnitt 2 ist abgeschlossen.
- Physische Detailrepräsentation, wiederholbare Wertgruppen, Zeitzonen-Eingabe, gemischte Präzision, Revisionen und Tombstone-Zählung sind entschieden.
- Der technische Zeitzonen-Spike hat Datum-only, mehrzonige Verbindungen sowie mehrdeutige und nicht existente DST-Zeiten nachgewiesen.

### Betroffene Komponenten

- „Hinzufügen“-Auswahl, Ereignisart-Auswahl, gemeinsames Formular, fünf typspezifische Detailbereiche und Teilstrecken-Editor
- Timeline, Gruppierung nach lokalem Reisetag, stabile Sortierung, Ereignisdetails, Bearbeiten und Löschdialog
- PostgreSQL: `TravelItem`, `Location`, `EventTypeDefinition`, passende Detail-/Segment-/Kindtabellen und `TravelItemRevision`
- `LocalTimeValue`, serverseitige Fachvalidierung, Idempotenz und optimistische Versionierung
- RLS/Transaktionen für vollständige TravelItem-Aggregate und Realtime-Invalidierung

### Konkrete Akzeptanzkriterien

- Jede der fünf Arten lässt sich nur mit Art, nicht leerem Titel und Startdatum genau einmal anlegen.
- Alle im Produktbrief vorgesehenen gemeinsamen und typspezifischen optionalen Felder sind erreichbar, speicherbar und nach Reload unverändert vorhanden.
- Flug-, Bahn- und Busereignisse unterstützen mindestens zwei geordnete Teilstrecken; Umordnen, Bearbeiten und Entfernen bleiben nach Reload erhalten.
- Datum-only und `unknown_time` bleiben ohne erfundene Uhrzeit erhalten. Exakte Zeiten speichern lokale Zeit, IANA-Zone, verwendeten Offset und UTC-Instant konsistent.
- Ein sicher erkennbares Ende vor Beginn, eine ungültige Segmentfolge sowie mehrdeutige oder nicht existente exakte Ortszeit blockieren das Speichern mit konkretem Hinweis.
- Die Timeline enthält ausschließlich aktive, bestätigte/manuell angelegte TravelItems, gruppiert sie nach lokalem Reisetag und sortiert sie mit stabilem Tie-Breaker.
- Eine Ereigniskarte zeigt mindestens Art, Titel und Startdatum sowie vorhandene zentrale Orts-/Verbindungsangaben; stornierte Buchungen werden textlich markiert.
- Bearbeiten prüft die gelesene Version. Löschen setzt `lifecycle_status = deleted`, erzeugt eine Revision und entfernt das Ereignis aus der normalen Timeline; kein Hard-Delete ist aus der PWA möglich.
- Mehr als 30 nicht gelöschte TravelItems werden serverseitig abgelehnt. Ein Fehler oder Retry erzeugt kein Duplikat und verändert kein anderes Ereignis.

### Automatisierte Tests

- Unit- und Property-Tests für Pflichtkern, Titel, Präzision, IANA-Zonen, Offset/UTC-Konsistenz, DST, Zeitfolgen und Segmentableitung
- Aggregate-Integrationstests je Ereignisart, für alle Kindtabellen, zwei Segmente, Revisionen, Löschung und 30er-Grenze
- Sortiertests für exakte Zeit, Datum-only, gleiche Startwerte, lokale Reisetage und stabile Reihenfolge nach Reload
- Idempotenz- und Parallelitätstests für Create, Update und Delete; bei Versionskonflikt gewinnt genau eine Mutation
- E2E je Ereignisart sowie ein vollständiger Zwei-Segment-Fall für Flug, Bahn und Bus
- Accessibility-Tests für lange Formulare, aufklappbare Bereiche, Fehlerlinks, Dialogfokus und Tastaturbedienung
- RLS-/FK-Negativtests für jede physische TravelItem-Tabelle sowie DB-03 und DB-04

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** Alle fünf Minimalereignisse bei 375 CSS-Pixel erfassen; lange Formulare, Bildschirmtastatur, Datums-/Zeitzonenauswahl, Fehlerfokus, Zurück-Geste und Warnung bei ungespeicherten Änderungen prüfen.
- **iPhone:** Ein Verkehrsereignis mit zwei Teilstrecken bearbeiten und sicherstellen, dass keine horizontale Tabelle erforderlich ist.
- **Desktop:** Alle optionalen Bereiche, Tastaturbedienung, Timeline-Sortierung, Detailansicht und Löschdialog prüfen.
- **Beide Geräte:** Ereignis auf Gerät A ändern, auf Gerät B zeitnah sehen; parallele Bearbeitung löst einen nachvollziehbaren Konflikt statt Überschreiben aus.
- Gerätezeitzone bewusst von der fachlichen Reisezeitzone abweichend einstellen und korrekte lokale Anzeige prüfen.

### Sicherheitsprüfungen

- Jede Basis-, Detail-, Segment- und Kindtabelle erzwingt aktive Mitgliedschaft über denselben Trip-Pfad; reiseübergreifende FKs und Elternwechsel sind verboten.
- `TravelItemRevision` ist append-only und nicht direkt beschreibbar; Akteurs-IDs werden serverseitig aus der Sitzung gesetzt.
- HTML/URLs/Notizen werden sicher als Daten dargestellt; keine Eingabe wird als ungeprüftes HTML ausgeführt.
- Vollständige Zahlungsdaten, Tokens und Geheimnisse werden in vorgesehenen Feldern serverseitig abgelehnt; Zahlungsart bleibt höchstens maskiert.
- Timeline-Abfragen und Realtime liefern einem Nichtmitglied keine Zeilen oder Ereignisse.
- Fachliche Löschung berührt weder andere TravelItems noch künftig unabhängige Documents.

### Definition of Done

- Die manuelle Reiseplanung erfüllt AC-03, AC-04, AC-05 und AC-10 aus dem Produktbrief auf iPhone und Desktop.
- Alle fünf Typen, optionale Detailmodelle, Segmente, Zeitregeln, Revisionen und stabile Timeline sind vollständig integriert und deployt.
- RLS, Indizes für Policy-/Timeline-Pfade und Mengenlimit sind automatisiert nachgewiesen.
- Testfixtures dokumentieren alle fünf Arten, Datum-only, mehrzonige Verbindung, DST-Konflikt und stabile Gleichstandssortierung.
- Schnitte 1 und 2 bestehen ihre Regressionstests weiterhin.

## 7. Schnitt 4 – Privater Dokument-Upload

### Nutzerwert

Beide Personen können Reisebestätigungen als private Originale hochladen, deren sicheren Status nachvollziehen, freigegebene Dateien in einer Dokumentliste finden und sie authentifiziert öffnen oder herunterladen. Noch findet keine KI-Extraktion statt.

### Abhängigkeiten

- Schnitt 3 ist abgeschlossen; Upload kann technisch nach Schnitt 2 beginnen, die nummerierte Release-Reihenfolge bleibt jedoch verbindlich.
- Datei-/Mengenlimits, versionierte wirksame Positivliste, Signatur-/Containerprüfung und Dokumentaufbewahrung sind entschieden. Ein externer Malware-Scanner ist für diese private Nutzung nicht vorgesehen.
- Ein privater Supabase-Storage-Bucket und die kontrollierte serverseitige Reservierung des Objektpfads sind vorbereitet.
- Backup-, Restore-, Export- und Löschverfahren sind vor Nutzung realer Dokumente festgelegt.

### Betroffene Komponenten

- Upload-Auswahl, Warteschlange, unabhängige Dateistatus, Dokumentliste und Dokumentansicht
- PostgreSQL: `Document`, Upload-Idempotenz, Version, Status, Prüfsumme und sichere Fehlercodes
- Privater Supabase Storage, Quarantäne, unveränderliche Objektpfade und Storage-Policies
- Serverseitige Dateiprüfung, Limits und kontrollierter Dokumentabschluss
- Authentifizierter Download, kurzlebige lokale Blob-URL und sichere Attachment-/Vorschau-Regeln
- Realtime-Invalidierung für Dokumentstatus; noch keine OpenAI-Komponente

### Konkrete Akzeptanzkriterien

- Nutzer können bis zu fünf Dateien in einem Auswahlvorgang auswählen; jede Datei hat einen unabhängigen, persistierten und verständlichen Status.
- Servergrenzen gelten initial mit höchstens 20 MiB je Original, 50 MiB je Auswahl, zwei parallelen Uploads je Nutzer und 50 nicht gelöschten Originalen je Reise, sofern die vorangehende Entscheidung sie nicht weiter absenkt.
- Vor dem Upload wird eine Document-Zeile idempotent angelegt und ein zufälliger, serverseitig gebundener Objektpfad reserviert. Originaldateiname und fachliche Daten erscheinen nicht im Pfad.
- Das Original wird unverändert gespeichert und nach erfolgreichem Abschluss nicht überschrieben; eine neue Version ist ein neues Document.
- Erst nach Größen-, Signatur-, Struktur-, Aktivinhalt-, Pixel-/Dekompressions- und Prüfsummenprüfung wird ein Dokument `available` und für das zweite Mitglied abrufbar.
- Nicht unterstützte, beschädigte, passwortgeschützte, aktive, manipulierte oder zu große Dateien erhalten einen stabilen, handlungsorientierten Fehler und werden nicht freigegeben.
- Beide Mitglieder können `available`-Originale authentifiziert öffnen oder herunterladen. Ein Vorschaufehler lässt den sicheren Download verfügbar.
- Upload, Fehler oder Retry erzeugen kein Timeline-Ereignis und verändern kein vorhandenes TravelItem.
- Ein Wiederholungsversuch mit demselben Idempotenzschlüssel legt kein zweites Document oder Objekt an.

### Automatisierte Tests

- Unit-Tests für Upload-Zustandsautomat, Limits, sichere Fehlertexte, Idempotenz und erlaubte Statusübergänge
- Integrationstests für reservierten Pfad, Uploadabschluss, Prüfsumme, Quarantäne, Freigabe, Retry und unveränderliches Original
- Formatfixtures für PDF, JPEG/PNG/WebP, nicht animiertes GIF, DOCX, XLSX, PPTX, EML und passive Textformate, soweit sie in der freigegebenen Konfiguration stehen
- Negativfixtures FILE-01 bis FILE-03: Signaturkonflikt, Polyglot, beschädigt/passwortgeschützt, aktiver Inhalt, Zip-Bombe, Traversal, 41-MP-Bild, animiertes GIF und >20 MiB
- Storage-Negativtests STORE-01 bis STORE-04 einschließlich fremdem Pfad, Listing, Upsert, öffentlicher URL und abgelaufenem Signed-Link, falls Signed URLs überhaupt verwendet werden
- E2E für Mehrfachauswahl, unabhängige Fehler, Hintergrundnavigation, Dokumentliste, sichere Vorschau und Download
- Cache-Test: Antworten tragen `private, no-store`; Blob-URLs werden bei Schließen, Seitenwechsel und Logout widerrufen

### Manuelle Tests auf iPhone und Desktop

- **iPhone/Safari:** Je eine unterstützte Datei aus „Dateien“ und „Fotos“ wählen, Mehrfachauswahl, langsamen Upload, App-Wechsel, Sperren/Wiederaufnahme und Abbruch testen.
- **iPhone:** HEIC/HEIF oder einen anderen nicht freigegebenen Typ wählen und praktische, nicht irreführende Abhilfe prüfen.
- **Desktop:** Unterstützte Kernformate, Mehrfachupload, Datei > Limit, passwortgeschützte PDF und manipulierte Testfixture prüfen.
- **Beide Geräte/Konten:** Konto A lädt hoch; Konto B sieht das Original erst nach Freigabe. Beide können es öffnen, ein abgemeldeter Browser nicht.
- Vorschau eines nicht inline erlaubten Formats prüfen: keine aktive Einbettung, aber sicherer Download als Alternative.

### Sicherheitsprüfungen

- Der Bucket ist privat; `anon`, Nichtmitglied und öffentliche URL erhalten weder Objekt noch Metadaten oder Listing.
- Pfade besitzen mindestens 122 Bit effektive Zufälligkeit und werden nie aus Dateiname, E-Mail, Reisebezeichnung oder Buchungsdaten gebildet.
- Browser-MIME und Endung sind nur Hinweise; Freigabe basiert auf serverseitiger Byte-/Strukturprüfung. Parser führen keine Makros, JavaScript, Links oder externe Ressourcen aus.
- Quarantänisierte, fehlerhafte und gelöschte Dokumente sind für normale Downloads und das zweite Mitglied gesperrt.
- Kein öffentlicher oder langlebiger Link wird erzeugt. Falls technisch zwingend, sind Signed URLs höchstens 60 Sekunden gültig, nicht persistiert und nicht geloggt.
- Logs enthalten keine Dateinamen, Inhalte, Buchungsdaten, Signed URLs, Tokens oder exakte sensible Werte.

### Definition of Done

- AC-06 und der Upload-/Abrufanteil von AC-11 sind mit synthetischen Dateien erfüllt.
- Private Storage-Policies, Quarantäne, sichere Dateiprüfung und alle STORE-/FILE-Release-Gates bestehen.
- Backup und Restore von Metadaten plus Originalen sowie administrative Document-/Gesamtlöschung wurden mit Testdaten ausgeführt und dokumentiert.
- Keine OpenAI-Anfrage findet in diesem Schnitt statt; Upload bleibt technisch und fachlich vom TravelItem getrennt.
- Bestehende Timeline- und Auth-Funktionen bleiben regressionsfrei deploybar.

## 8. Schnitt 5 – Extraktion eines Dokuments

### Nutzerwert

Eine Person kann ein freigegebenes Original zur Analyse starten und anschließend sehen, ob daraus null, ein oder mehrere unbestätigte Ereignisvorschläge entstanden sind. Fehler, Limits und Retries sind verständlich, ohne bestätigte Reisedaten zu gefährden.

### Abhängigkeiten

- Schnitt 4 ist abgeschlossen.
- Aktuelle offizielle OpenAI-Dokumentation, Modellunterstützung, Dateigrenzen, Structured-Outputs-Verhalten, API-Datenverwendung und Aufbewahrung wurden unmittelbar vor Implementierung verifiziert.
- Modell, Prompt-Version, Schema `1.0.0`, Preis-/Budgetkonfiguration, Providerprojekt, Kill Switch und temporäre Dateilöschung sind verbindlich festgelegt.
- Edge-Function-Laufzeit, Speicher und Requestgröße wurden mit repräsentativen PDF-, Bild-, DOCX- und EML-Dateien getestet; ein Rückfallpfad ist bei Überschreitung entschieden.

### Betroffene Komponenten

- UI-Aktion „Verarbeitung starten“, persistente Run-Status und read-only Kandidatenübersicht
- PostgreSQL: `ExtractionRun`, `ExtractionCandidate`, `CandidateField`, Warnungen, Leases, Idempotenz und Versionen
- Authentifizierte Supabase Edge Function und ausschließlich serverseitige OpenAI-Konfiguration/Secrets
- OpenAI Responses API mit Datei-/Bildeingabe und strict Structured Output
- Schema- und Semantikvalidierung, versionierter Candidate-Adapter, Rate Limits, Parallelität, Kostenreservierung und Logging
- Realtime-Invalidierung für Run-/Candidate-Status

### Konkrete Akzeptanzkriterien

- Nur ein aktives Mitglied kann für ein eigenes `available`-Document per Dokument-ID und Idempotenzschlüssel eine Extraktion starten; freie Pfade, URLs, Prompts, Modelle oder Providerparameter werden nicht akzeptiert.
- Pro Dokument, Nutzer und global gelten die definierten Parallelitätsgrenzen; Replay erzeugt höchstens einen wirksamen Run und keine zusätzlichen Providerkosten.
- Ein erfolgreicher Run speichert null bis zwölf vollständig validierte Candidates in stabiler Reihenfolge. Kein Candidate erscheint in der Timeline und kein TravelItem wird erzeugt oder geändert.
- `accommodation`, `flight` und `train → rail` werden deterministisch gemappt. `generic` wird nur über die enge versionierte Kategorie-Whitelist zu `bus` oder `activity`; andernfalls entsteht kein automatisch typisierter Candidate.
- Feldwerte bewahren `value`, Provenance, Confidence und kurze Evidence/Fundstelle. `unknown` bleibt explizit `null`; Widersprüche und Unsicherheiten bleiben sichtbar.
- Freitext, mehrere JSON-Werte, Reasoning, Schemaabweichung oder semantisch ungültige Ausgabe erzeugen keine Teilpersistenz und einen stabilen inhaltsfreien Fehlercode.
- Technisch retry-fähige Fehler erhalten höchstens zwei automatische Versuche mit Backoff. Fachliche Fehler erzeugen keinen kostenpflichtigen Retry-Loop.
- Uploads/Extraktionen beachten Tageslimits und das atomar reservierte weiche monatliche Anwendungsbudget. `OPENAI_MAX_RUN_COST_MICRO_EUR` ist eine einfache Run-Reservierung; das OpenAI-Kontolimit ist die harte Kostenschranke. Bei 100 % oder Kill Switch starten keine neuen Provideraufrufe; manuelle Funktionen bleiben verfügbar.
- Temporäre OpenAI-Dateien werden nach Abschluss bestmöglich gelöscht; vollständige Modellantwort, Prompt, Dokumentinhalt und Reasoning werden nicht persistiert oder geloggt.

### Automatisierte Tests

- Schema-Contract-Tests gegen `schemas/extraction.schema.json`: Strictness, `required`, `additionalProperties: false`, Grenzen und feste Version
- Die sechs repräsentativen Fälle aus dem Extraktionsvertrag plus Grenzfälle für mehrere Events, Hin/Rück, Segmente, Datum-only, DST, Widerspruch, `generic`, kein Ereignis und Teilresultat
- Semantiktests für Provenance/Confidence/Evidence, Typmapping, Zeiten/Zonen, Geld, Referenzen, Geheimnisse und CandidateField-Herkunft
- AI-01 bis AI-03 für Prompt Injection, bösartige schema-konforme Werte, Freitext, Timeout, Teilantwort und Reasoning
- AUTH-06/07 für JWT, Projektbindung, deaktiviertes Konto und widerrufene Sitzung vor jeder DB-/Storage-/OpenAI-Aktion
- LIMIT-01 und BUDGET-01 mit parallelen Requests, atomarer Reservierung, Replay, Lease-Ablauf und Kill Switch
- LOG-01 und SECRET-01 für redigierte Providerfehler, inhaltsfreie Logs und fehlende Secrets im Frontend-Build
- Integrationstest: Run-Fehler lässt alle vorhandenen TravelItems und Documents unverändert

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** Extraktion eines freigegebenen PDF/Bilds starten, während der Verarbeitung navigieren, App wechseln und nach Rückkehr den kanonischen Status sehen.
- **Desktop:** Repräsentative Unterkunfts-, Flug-, Bahn-, Bus- und Aktivitätsbestätigung verarbeiten und read-only Vorschlag, Warnungen und Anzahl prüfen.
- Auf beiden Geräten langsame Verarbeitung, Timeout, nicht zuordenbares Dokument, manuellen Retry, Limit und Budgetstopp nachvollziehen.
- Konto B beobachtet Statusänderungen von Konto A; ein Realtime-Ausfall wird durch Reload/Wiederverbindung korrigiert.

### Sicherheitsprüfungen

- OpenAI-Key und gegebenenfalls Service Role existieren nur als serverseitige Secrets; getrennte Projekte/Schlüssel werden je Umgebung verwendet.
- Die Edge Function validiert JWT-Signatur, Issuer, Audience, Ablauf, Projekt, aktive Sitzung, Konto, Mitgliedschaft, Document-Trip, Status, Version, Limits und Budget vor privilegiertem Zugriff.
- Service-Role-Nutzung folgt erst nach diesen Prüfungen und kann nie durch frei übermittelte Storage-Pfade oder Modellparameter gesteuert werden.
- Das Modell erhält keine Tools, Browser-, Datenbank- oder Geheimniszugänge und niemals ein fremdes Dokument.
- Kandidaten bleiben untrusted input; striktes Schema ersetzt weder Semantikvalidierung noch spätere menschliche Bestätigung.
- Provider- und Datenschutzbedingungen sowie Ausschluss der Nutzung für allgemeines Modelltraining sind für das konkrete API-Projekt dokumentiert.

### Definition of Done

- Ein freigegebenes Dokument kann reproduzierbar zu validierten, ausschließlich unbestätigten Candidates verarbeitet werden; AC-12 ist für Extraktionsfehler erfüllt.
- Prompt, Schema, Candidate-Adapter, Modell und Preislogik sind versioniert; jede Änderung löst die zugehörigen AI- und Budget-Release-Gates aus.
- Edge-Function-Limits und Provider-Aufbewahrung haben keine offenen Go-live-Risiken; der Kill Switch wurde getestet.
- Kosten-, Rate-Limit-, Idempotenz-, Secret- und Logging-Prüfungen bestehen in der Zielumgebung.
- Kein Testpfad kann durch Upload oder Extraktion ein TravelItem erzeugen.

## 9. Schnitt 6 – Kontroll- und Korrekturansicht

### Nutzerwert

Die Nutzer können jeden maschinellen Vorschlag verständlich mit dem Original vergleichen, Unsicherheit erkennen und sämtliche Daten korrigieren, ergänzen, entfernen, neu ordnen oder verwerfen, ohne bereits etwas in die gemeinsame Timeline zu veröffentlichen.

### Abhängigkeiten

- Schnitt 5 ist abgeschlossen.
- Regeln für Candidate-Aufbewahrung, „Verwerfen“, Teilstrecken-Gruppierung und zusätzliche Attribute sind entschieden.
- Die editierbare Candidate-Repräsentation und stabilen `field_path`-/`occurrence_key`-Konventionen sind versioniert.

### Betroffene Komponenten

- Entwurfsübersicht, Prüfstatus, Candidate-Editor, Unsicherheits-/Warnungsdarstellung und Original-Wechselansicht
- Wiederverwendung des Ereignisformulars ohne direkte TravelItem-Mutation
- `CandidateCorrection` als append-only Operation, Candidate-Versionierung und effektive Werte
- Original-Blob-Abruf, Evidence-/Fundstellenanzeige und Verwerfungsdialog
- Konflikt- und Ungespeichert-Warnung, Realtime-Invalidierung

### Konkrete Akzeptanzkriterien

- Jeder Candidate ist einzeln mit Herkunftsdokument, vorgeschlagener Art, Pflichtkern, Warnungen und Prüfstatus erreichbar.
- Nutzer können Ereignisart, Anzahl/Zuordnung der Ereignisse im vorgesehenen Workflow, Teilstrecken und sämtliche definierten Felder ändern, ergänzen, entfernen und neu ordnen.
- Unsichere oder abgeleitete Werte sind textlich/symbolisch, nicht nur farblich markiert; unbekannte Werte bleiben leer statt geraten.
- Jede gespeicherte Änderung erzeugt eine append-only `CandidateCorrection` mit Operation, vorherigem effektiven Wert, neuem Wert, Akteur, Zeitpunkt und resultierender Candidate-Version. `CandidateField.original_value` bleibt unverändert.
- Das Original lässt sich während der Prüfung öffnen; bereits gespeicherte Korrekturen und nicht abgesendete Formulareingaben gehen beim Wechsel nicht verloren.
- Pflichtfeld-, Zeit-, DST- und Segmentfehler werden angezeigt und dürfen die spätere Bestätigung blockieren, verhindern aber nicht weiteres Bearbeiten oder den Originalzugriff.
- Ein verworfener Candidate wird terminal `discarded` und erzeugt kein TravelItem. Die UI nennt die zuvor entschiedene Wirkung auf Original und Korrekturen präzise.
- Parallele Korrektur auf derselben Candidate-Version führt zu einem sichtbaren Konflikt und keinem stillen Überschreiben.
- Eine Re-Extraktion überschreibt keine terminalen oder korrigierten Candidates, sondern erzeugt einen neuen Run und neue Candidates nach der festgelegten Ersetzungsregel.

### Automatisierte Tests

- Unit-Tests für effektiven Wert aus Original plus Korrekturfolge, alle Operationsarten, stabile Wiederholungs-IDs und Reihenfolge
- Integrationstests für append-only `CandidateCorrection`, unveränderliche `CandidateField`, Versionserhöhung, Konflikt und terminale Zustände
- Komponenten-/Accessibility-Tests für Unsicherheit, Evidence, Warnungen, Fehlerzusammenfassung, Fokus und mobile Wechselansicht
- E2E mit einem Multi-Event-Dokument: Typ korrigieren, Segment ergänzen/umordnen, Feld entfernen, Original öffnen, Reload und Zustand wiederfinden
- E2E für Verwerfen entsprechend der beschlossenen Aufbewahrungsregel und Re-Extraktion ohne Überschreiben
- Negativtests DB-03/04, fremde Candidate-ID, fremdes Dokument und direkter Schreibversuch auf CandidateField
- XSS-/Darstellungstests mit HTML, Script-Text, bösartigen URLs und Prompt-Injection-Text in Evidence/Original

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** Langen Candidate bei 375 CSS-Pixel prüfen, zwischen Original und Formular wechseln, Tastatur/Fokus, ungespeicherte Änderungen und große Schrift testen.
- **iPhone:** Unsichere Felder und mehrere Teilstrecken allein anhand Text/Symbol verstehen; keine Kernaktion darf eine komplexe Geste erfordern.
- **Desktop:** Breitere Vergleichsansicht, Tastaturbedienung, Evidence, alle Feldgruppen und Multi-Event-Übersicht prüfen.
- **Beide Geräte:** denselben Candidate parallel ändern und Konfliktauflösung testen; Konto B darf den Candidate vor Bestätigung sehen, aber kein Timeline-Ereignis.

### Sicherheitsprüfungen

- Korrektur, Verwerfen und Lesen prüfen aktive Mitgliedschaft über Candidate → Run → Document → Trip; bekannte fremde UUIDs liefern keine Existenzinformation.
- Akteurs-ID, Candidate-ID, Version und Elternbezüge werden serverseitig gesetzt oder validiert; der Client kann keine fremde Reise referenzieren.
- CandidateField und Korrekturhistorie sind nicht direkt überschreib- oder löschbar.
- Dokument- und Evidence-Inhalte werden niemals als ungeprüftes HTML ausgeführt; aktive Formate erhalten keine Inline-Vorschau.
- Logs enthalten weder effektive Werte noch Evidence, Dateinamen oder Originalinhalt.
- Keine Editoraktion kann direkt ein TravelItem anlegen oder ändern.

### Definition of Done

- AC-07, AC-08 und der Kontrollanteil von AC-09 sind bis unmittelbar vor die Bestätigung erfüllt.
- Alle Candidate-Felder und Segmente sind vollständig editierbar; Herkunft und Korrekturen bleiben nachvollziehbar.
- Verwerfen, Re-Extraktion und parallele Korrektur folgen den entschiedenen Regeln und sind automatisiert getestet.
- Die mobile Original-/Formular-Wechselansicht und die Desktop-Vergleichsansicht sind manuell abgenommen.
- Timeline und bestätigte TravelItems bleiben durch jede Candidate-Aktion unverändert.

## 10. Schnitt 7 – Bestätigung und Übernahme in die Timeline

### Nutzerwert

Nach eigener Prüfung können Nutzer einen Candidate ausdrücklich bestätigen. Genau ein gültiges, mit seinem Original verknüpftes Ereignis erscheint anschließend für beide Personen in der gemeinsamen Timeline.

### Abhängigkeiten

- Schnitt 6 ist abgeschlossen.
- Aufbewahrungs-/Löschregeln und ein möglicher kontrollierter `update`-Modus für bestehende TravelItems sind entschieden; der erste Pfad `create` bleibt zwingend.
- Die atomare Bestätigungsoperation und das Mapping vom effektiven Candidate zum kanonischen TravelItem sind versioniert spezifiziert.

### Betroffene Komponenten

- Primäraktion „Ereignis bestätigen“, Speicherstatusprüfung und Erfolgs-/Fehlernavigation
- Serverseitige atomare CandidateConfirmation-Transaktion/RPC
- `CandidateConfirmation`, `TravelItem`, passender Detail-Subtyp, `TravelItemRevision` und `TravelItemDocument`
- Zweite vollständige Fachvalidierung, Idempotenz, Candidate-/TravelItem-Versionen und Mengenlimit
- Timeline-/Dokument-/Candidate-Invalidierung und Originalverknüpfung

### Konkrete Akzeptanzkriterien

- Nur die ausdrückliche Aktion „Ereignis bestätigen“ kann einen `draft`-Candidate übernehmen; Backend, Extraktion und Realtime bestätigen niemals automatisch.
- Vor der Mutation prüft der Server aktive Mitgliedschaft, Candidate-Status/-Version, Idempotenzschlüssel, zulässigen MVP-Typ, Pflichtkern, Zeit-/Segmentregeln und 30er-Grenze erneut.
- Bestätigung schreibt Candidate-Status, `CandidateConfirmation`, genau ein TravelItem mit passendem Detailmodell, genau eine Revision und alle Dokumentverknüpfungen in einer atomaren Operation.
- Ein Fehler lässt alle beteiligten Tabellen unverändert. Wiederholung mit demselben Idempotenzschlüssel liefert dasselbe Ergebnis; Doppeltippen, Reload und Timeout erzeugen kein Duplikat.
- Nach Erfolg erscheint das Ereignis an der stabil richtigen Timeline-Position und ist für beide Konten nach Realtime-Reload beziehungsweise Reload sichtbar.
- Das Herkunftsdokument ist aus dem Ereignis erreichbar; vom Dokument sind bestätigte Ereignisse und verbliebene Kandidaten nachvollziehbar.
- Ein bestätigter, verworfener oder ersetzter Candidate kann nicht mit einem neuen Schlüssel erneut bestätigt werden.
- Bei unklarem Netzwerkausgang zeigt die App „Speicherstatus wird geprüft“ und liest zuerst den Serverstand, bevor sie einen Retry anbietet.
- Kandidaten mit mehreren separaten Buchungen werden einzeln bestätigt; eine Bestätigung erzeugt nicht unbeabsichtigt weitere Ereignisse.

### Automatisierte Tests

- Transaktionstests für vollständigen Erfolg und Fehler an jedem Zwischenschritt mit nachgewiesenem Rollback
- Idempotenztests für Doppeltippen, identischen Schlüssel, neuen Schlüssel auf terminalem Candidate, Timeout und Replay
- Mapping-/Snapshot-Tests für alle fünf Typen, Detailmodelle, Segmente, Dokumentrelation und `created_from_candidate_id`
- Validierungstests für fehlenden Pflichtkern, DST/Zeitfehler, fremden Typ, Versionskonflikt und Mengenlimit
- DB-02 bis DB-04 sowie AUTH-01 bis AUTH-03 für Bestätigung, Revision und Dokumentrelation
- Zwei-Client-E2E: Upload → Extraktion → Korrektur → Bestätigung → Timeline → Original, einschließlich Realtime und Reload-Fallback
- End-to-End-Regressionssuite AC-01 bis AC-13 mit synthetischen/repräsentativen Dateien

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** vollständigen Kernablauf Anmeldung → Upload → Verarbeitung → Kontrolle/Korrektur → Bestätigung → Timeline → Original bei 375 CSS-Pixel durchführen.
- **iPhone:** Doppeltippen, App-Wechsel und Verbindungsabbruch während Bestätigung provozieren; es darf genau ein Ereignis entstehen.
- **Desktop:** Kandidaten aller fünf Typen bestätigen, Details/Segmente/Originale prüfen und Timeline-Sortierung nachvollziehen.
- **Beide Konten:** Konto A bestätigt, Konto B sieht nur das bestätigte Ereignis; parallele Bestätigung desselben Candidates führt zu genau einem Erfolg.

### Sicherheitsprüfungen

- CandidateConfirmation ist nur über die kontrollierte atomare Operation möglich; direkte Inserts/Updates auf Confirmation, Revision und Kindtabellen sind gesperrt.
- Jede Elternbeziehung gehört zur gleichen Reise; manipulierte Trip-, Document-, Candidate-, TravelItem- oder Akteurs-IDs werden atomar abgelehnt.
- Ein Service-Schlüssel darf keine fachliche Bestätigung ohne nachgewiesenen Auftrag eines aktiven Mitglieds ausführen.
- Vollständige LLM-Antwort, Dokumentinhalt, Corrections und Geheimnisse gelangen nicht in Logs oder Clientfehler.
- Ein Nichtmitglied erhält weder Timeline-/Dokumentdaten noch Candidate-/Confirmation-/Realtime-Ereignisse.
- Bestätigung verändert kein bestehendes TravelItem ohne ausdrücklich freigegebenen `update`-Modus und erwartete Zielversion.

### Definition of Done

- Der funktionale MVP-Kern erfüllt AC-01 bis AC-13 auf aktuellem iPhone und unterstütztem Desktop-Browser.
- Die Bestätigung ist atomar, idempotent, versionsgeprüft und mit Revision sowie Originalherkunft vollständig nachgewiesen.
- Alle negativen Auth-, DB-, Storage-, File-, AI-, Limit-, Budget-, Secret- und Logging-Tests der bisher vorhandenen Komponenten sind grün.
- Administrativer verschlüsselter Export, Backup/Restore, Document-/TravelItem-/Gesamtlöschung und Vorfallablauf sind mit Testdaten dokumentiert und einmal erprobt.
- Providerbedingungen, Limits, Budgetwarnungen, Kill Switch und Secret-Rotation sind vor realer Reise erneut geprüft.
- Schnitt 7 ist ein funktionsvollständiger MVP-Kandidat; die PWA-Release-Abnahme erfolgt zusätzlich in Schnitt 9.

## 11. Schnitt 8 – Karte (separate Nach-MVP-Erweiterung)

### Nutzerwert

Die Nutzer können bestätigte Reiseereignisse mit vorhandenen Koordinaten räumlich einordnen und von einem Marker zurück zum Ereignis wechseln. Timeline und Originaldokumente bleiben der primäre Reiseplan.

### Abhängigkeiten

- Schnitt 7 ist abgeschlossen; Schnitt 9 ist keine technische Voraussetzung.
- Produktbrief, UX-Flows, Architektur und Threat Model wurden formal um die Kartenansicht ergänzt. Ohne diese Scope-Freigabe beginnt keine Implementierung.
- Karten-/Tile-Strategie, Lizenz/Attribution, Datenschutz, CSP, Kosten und Betriebsgrenzen sind entschieden.
- Es findet im Schnitt keine automatische Geokodierung, Navigation oder Routenplanung statt. Verwendet werden nur bereits bestätigte Koordinaten aus `Location`.

### Betroffene Komponenten

- Read-only Kartenansicht, Marker/Cluster, Ereignis-Karten-Kopplung und leerer Zustand
- Bestehende `Location.latitude`/`longitude` und TravelItem-Location-Bezüge; keine neue fremde Ortsanreicherung
- Kartenbibliothek und gegebenenfalls Tile-Auslieferung/Providerintegration
- CSP, Referrer-Policy, Attribution, Datenschutzinformation und Anbieter-Monitoring
- Feature-Schalter und Navigation, ohne die Timeline zu ersetzen

### Konkrete Akzeptanzkriterien

- Nur aktive bestätigte TravelItems mit gültigem Latitude-/Longitude-Paar erzeugen einen Marker; Kandidaten, gelöschte Ereignisse und private Dokumentdaten erscheinen nie auf der Karte.
- Marker zeigt höchstens die für Orientierung nötigen Daten und führt zum autorisierten Ereignisdetail.
- Ereignisse ohne Koordinaten bleiben in einer zugänglichen Liste sichtbar und erzeugen weder Fehler noch erfundene Positionen.
- Gleichliegende Marker bleiben auswählbar, etwa durch Cluster oder zugängliche Liste; Karte und Liste spiegeln denselben kanonischen Stand.
- Die Karte bietet keine Geokodierung, Route, Navigation, Standortfreigabe oder externe Deep Links, sofern dafür keine spätere eigene Freigabe erfolgt.
- Realtime invalidiert die Kartendaten; bei Ausfall bleibt Reload/Wiederverbindung der Korrektheitspfad.
- Ohne Kartenanbieter oder bei dessen Fehler bleiben Timeline, Details und Dokumente vollständig nutzbar.
- Die Ansicht funktioniert bei 375 CSS-Pixel ohne horizontales Scrollen und besitzt tastatur-/screenreaderfähige Alternativen zu Gesten.

### Automatisierte Tests

- Unit-Tests für Koordinatengrenzen, Filter aktiver TravelItems, Marker-Datenminimierung und stabile Zuordnung
- Komponenten-/Accessibility-Tests für Kartenalternative, Marker-Liste, Fokus, Zoom-Steuerung und Attribution
- E2E für Marker → Detail, fehlende Koordinaten, Providerfehler, Realtime-Update und deaktivierten Feature-Schalter
- RLS-Regression: Karte lädt nur bereits autorisierte TravelItem-/Location-Daten; fremde Koordinaten bleiben unsichtbar
- Netzwerk-/CSP-Test, der alle ausgehenden Kartenrequests gegen die freigegebene Anbieter- und Datenmatrix vergleicht
- Test, dass Buchungsnummern, Reisende, Notizen, Dokument-IDs und Originalinhalte nie an Kartenrequests gelangen

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** Marker und Liste bei 375 CSS-Pixel, Touch-Ziele, Pinch/Zoom sowie sichtbare Alternativen, Safe Areas und Rücknavigation testen.
- **Desktop:** Tastatur, sichtbaren Fokus, Maus/Trackpad, große/kleine Fenster und mehrere Marker am selben Ort prüfen.
- In beiden Formfaktoren Provider blockieren/offline gehen; Timeline und Details müssen weiter funktionieren und die Karte einen verständlichen Fehler zeigen.
- Mit einem Ereignis ohne, einem mit gültigen und einem mit ungültigen Koordinaten die definierte Darstellung prüfen.

### Sicherheitsprüfungen

- Threat Model und Datenschutzbewertung benennen den zusätzlichen Anbieter/Vertrauensbereich und die tatsächlich übertragenen Metadaten.
- Kein Kartenrequest enthält Auth-Token, Trip-/Document-/Candidate-ID, Buchungsdaten, Adresse oder andere nicht erforderliche Inhalte.
- Karten-/Popup-Inhalte werden sicher als Text gerendert; keine fremden HTML-/Script-Inhalte werden ausgeführt.
- CSP wird ausschließlich um die beschlossenen Kartenursprünge erweitert; API-Schlüssel sind entweder öffentliche, eingeschränkte Browser-Schlüssel oder bleiben serverseitig.
- Tile-/Providerlogs, Telemetrie, Cookies und Referrer sind minimiert beziehungsweise vertraglich bewertet; keine neue Analytics wird beiläufig eingeführt.

### Definition of Done

- Die formale Scope-Änderung ist vor Codebeginn genehmigt und alle sechs Grundlagen sind konsistent aktualisiert.
- Kartenansicht, zugängliche Listenalternative, Providerfehler und Datenminimierung sind auf iPhone und Desktop abgenommen.
- Lizenz/Attribution, Datenschutz, Kostenlimit und Betriebs-/Ausfallverhalten sind dokumentiert.
- Die Erweiterung ist separat deploy- und deaktivierbar; bei Deaktivierung bleibt der MVP aus den Schnitten 1–7 und 9 unverändert.
- Navigation und Routenplanung bleiben ausdrücklich außerhalb dieses Schnitts.

## 12. Schnitt 9 – Offline- und PWA-Politur

### Nutzerwert

Die Anwendung lässt sich optional auf dem Home-Bildschirm installieren, verhält sich im Safari-Browser und Standalone-Modus konsistent und erklärt bei schlechter oder fehlender Verbindung zuverlässig, welcher Stand gespeichert ist. Private Daten werden dabei nicht offline vervielfältigt.

### Abhängigkeiten

- Schnitte 1 bis 7 sind abgeschlossen. Schnitt 8 ist optional und keine Voraussetzung.
- Manifest-/Icon-Satz, unterstützte Zielbrowser, Service-Worker-Update-Strategie und vollständiges Cache-Inventar sind festgelegt.
- Die Online-first-Grenze bleibt verbindlich: keine Offline-Datenbank, keine dauerhafte Mutationswarteschlange und kein garantierter Offline-Zugriff auf Reisedaten oder Dokumente.

### Betroffene Komponenten

- Web-App-Manifest, Icons, Theme/Display, Safe Areas und Installationshinweise
- Service Worker für versionierte statische App-Shell-Assets und neutrale Offline-Seite
- Explizite Ausschlüsse für Supabase-/API-/Storage-Antworten, Dokumente, Blob-Vorschauen und private Daten
- Globaler Verbindungsstatus, „Stand möglicherweise nicht aktuell“, Reconnect-Invalidierung und Statusprüfung nach unklarem Ausgang
- Kontrollierter Service-Worker-Update-Ablauf ohne Verlust geöffneter Formulare
- iOS-Dateiauswahl, Standalone-Navigation, Fokus, große Schrift und reduzierte Bewegung

### Konkrete Akzeptanzkriterien

- Die PWA ist auf unterstütztem iPhone und Desktop installierbar; Installation bleibt optional und blockiert keinen Browserfluss.
- Offline lädt höchstens die öffentliche App-Shell beziehungsweise eine neutrale Offline-Seite. Es werden keine Reise-, Ereignis-, Candidate-, Dokument-, Auth- oder API-Inhalte aus einem Runtime-Cache gezeigt.
- Netzwerkabhängige Aktionen werden bei fehlender Verbindung erklärt und nicht als gespeichert dargestellt. Formulareingaben bleiben nur im Arbeitsspeicher der offenen Ansicht erhalten.
- Bereits im UI sichtbare Inhalte dürfen lesbar bleiben, tragen aber eindeutig „Stand möglicherweise nicht aktuell“ und begründen keine Offline-Garantie.
- Nach Wiederverbindung oder Wiederaufnahme werden kanonische Trip-, Timeline-, Dokument- und Candidate-Status neu geladen, bevor unsichere Mutationen oder Extraktionen wiederholt werden.
- Nach Timeout beim Speichern/Bestätigen prüft die App zuerst den Serverstand. Uploads bieten „Fortsetzen“ nur bei technisch belastbarer Resume-Fähigkeit, sonst „Erneut hochladen“.
- Ein Service-Worker-Update verwirft kein geöffnetes Formular. Die neue Version wird kontrolliert aktiviert und verständlich angeboten.
- Logout widerruft Blob-URLs, leert flüchtigen geschützten UI-Zustand und hinterlässt keine privaten Cache-/IndexedDB-/localStorage-Einträge.
- Alle Kernflüsse funktionieren im Safari-Browser und Standalone-Modus ab 375 CSS-Pixel mit Safe Areas, Tastatur und iOS-Zurück-Geste.

### Automatisierte Tests

- Manifest-/Installability-Prüfung für Name, Start-URL/Basispfad, Scope, Display, Farben und vollständige Icons
- Service-Worker-Tests für Precache-Inventar, Versionswechsel, neutrale Offline-Seite und Ausschluss aller Auth-/Supabase-/Storage-/Dokument-Requests
- Automatisierter Cache-Audit nach Kernablauf und Logout: keine privaten Responses, Blobs, IDs, Tokens oder Reisedaten in Cache Storage, IndexedDB oder localStorage
- Browser-E2E für offline/online, Fokus-Rückkehr, Reconnect-Reload, Timeout-Statusprüfung und Update bei geöffnetem Formular
- PWA-/Accessibility-Audit für 375 CSS-Pixel, Safe Areas, Fokus, größere Schrift, reduzierte Bewegung und Screenreader-Status
- Regressionstest, dass keine Offline-Mutation oder automatische Retry-Schleife entsteht
- DEVICE-01 für Session-Widerruf auf Gerät A mit anschließendem API-, Storage-, Realtime- und Function-Zugriff

### Manuelle Tests auf iPhone und Desktop

- **iPhone:** In Safari installieren, Standalone öffnen, Statusleiste/Safe Areas, Home-Screen-Icon, Startpfad, Zurück-Geste und App-Wechsel prüfen.
- **iPhone:** Online Inhalte öffnen, Flugmodus aktivieren, App neu öffnen und sicherstellen, dass keine privaten Daten aus Cache erscheinen; danach wieder verbinden und vollständigen Abgleich prüfen.
- **iPhone:** Upload bei App-Wechsel/Sperren sowie Update bei geöffnetem Formular testen; der Speicherstand muss eindeutig bleiben.
- **Desktop:** Installieren/deinstallieren, Offline-Neustart, Service-Worker-Update, mehrere Tabs und Tastaturbedienung testen.
- Auf beiden Geräten abmelden und Browser-/PWA-Speicher inspizieren; bewusst heruntergeladene Dateien werden als nicht serverseitig rückrufbar dokumentiert.

### Sicherheitsprüfungen

- Service Worker cached ausschließlich freigegebene öffentliche App-Shell-Dateien; Runtime-Caching privater Origins und Antworten ist technisch ausgeschlossen und getestet.
- Reisedaten, Dokumente, Vorschaublobs und Formulare werden nicht in Cache Storage, IndexedDB oder `localStorage` gespeichert. Falls das Auth-SDK eine lokale Sitzungspersistenz benötigt, bleibt sie auf dessen freigegebenen Namensraum begrenzt, wird nie vom Service Worker gecacht und bei Logout entfernt.
- Update- und Offline-Seiten enthalten keine Secrets, Benutzerkennung, Reisetitel oder zuvor gerenderte private Daten.
- Session-Widerruf und Logout verhindern neue geschützte Zugriffe; eine Offline-Shell wird nicht mit einer gültigen Sitzung oder Datenverfügbarkeit verwechselt.
- CSP, Dependency-/Lockfile-Prüfung und Secret-Scan bleiben Release-Gates für jedes PWA-Artefakt.

### Definition of Done

- AC-13 und alle mobilen/PWA-Anforderungen des Produktbriefs sind auf dem aktuell unterstützten iPhone und Desktop-Browser bestanden.
- Installierbarkeit, Offline-Shell, Verbindungszustände, Reconnect und Update-Ablauf sind automatisiert und manuell abgenommen.
- Der vollständige Cache-/Speicher-Audit weist nach, dass keine privaten Daten dauerhaft offline gespeichert werden.
- Alle Schnitte 1–7 bestehen ihre Regressionen; Schnitt 8 wird nur getestet, falls er freigegeben und aktiviert ist.
- Der MVP ist erst jetzt releasebereit für eine echte gemeinsame Reise; Backup/Restore, Löschung, Session-Widerruf, Kill Switch, Provider-/Kostenprüfung und Vorfallablauf wurden unmittelbar vor Go-live erneut verifiziert.

## 13. Abschluss und Erfolgskontrolle

Nach Schnitt 9 wird der vollständige Kernablauf einmal mit beiden tatsächlichen Nutzern auf aktuellem iPhone und unterstütztem Desktop-Browser abgenommen. Danach wird der MVP für genau eine echte Reise verwendet. Die Produktvalidierung folgt den Erfolgskriterien aus dem Produktbrief: wichtige Originale sind auffindbar, die Extraktion spart gegenüber rein manueller Pflege spürbar Arbeit, Timeline und Dokumente sind unterwegs praktisch nutzbar und beide Personen würden die App erneut verwenden.

Erst dieses Ergebnis begründet eine nächste Produktphase. Es aktiviert weder Karte, mehrere Reisen, Einladungen, Navigation, Offline-Bearbeitung noch weitere Ereignisarten automatisch.
