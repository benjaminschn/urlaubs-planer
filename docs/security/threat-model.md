# Sicherheits- und Datenschutzkonzept des privaten Reiseplaners

**Status:** Konzept für den MVP, noch keine Implementierung  
**Stand:** 2. August 2026  
**Geltungsbereich:** Zwei vorab eingerichtete Konten, eine aktive gemeinsame Reise, höchstens 30 bestätigte Ereignisse und 50 Originaldokumente

## 1. Ziel, Schutzbedarf und Grundsätze

Der Reiseplaner verarbeitet besonders vertrauliche Alltagsdaten: Reisezeiten und Aufenthaltsorte, Namen, Kontakt- und Buchungsdaten, Preise, Zugangshinweise sowie vollständige Originalbestätigungen. Aus einer Offenlegung können Bewegungsprofile, Identitätsmissbrauch, unbefugte Buchungsänderungen oder physische Sicherheitsrisiken entstehen. Vertraulichkeit hat deshalb den höchsten Schutzbedarf. Integrität ist ebenfalls hoch, weil manipulierte Zeiten, Orte oder Buchungsangaben konkrete Reiseprobleme verursachen können. Die Verfügbarkeit ist für den privaten MVP wichtig, besitzt aber keine formale 24/7-Zusage.

Das Konzept folgt diesen Regeln:

- **Default deny:** Ohne ausdrücklich erlaubte Policy ist kein Zugriff möglich. `anon` erhält auf Anwendungsdaten und private Dateien keinerlei Rechte.
- **Authentifizierung ist nicht Autorisierung:** Ein gültiges Konto allein reicht nicht. Jede Zeile und jedes Storage-Objekt muss zu einer Reise gehören, in der `auth.uid()` aktuell aktives Mitglied ist.
- **Serverseitige Entscheidung:** Browserprüfungen dienen nur der UX. Mitgliedschaft, Zustände, Größen, Kontingente, Dateitypen und fachliche Übergänge werden serverseitig geprüft.
- **Minimale Privilegien:** Das Frontend besitzt nur den öffentlichen Supabase-Schlüssel. OpenAI-Key und gegebenenfalls Service Role existieren nur in der Edge-Function-Laufzeit.
- **Untrusted input:** Browserdaten, IDs, Storage-Pfade, Dateien und LLM-Antworten gelten immer als nicht vertrauenswürdig.
- **Keine automatische Veröffentlichung:** Upload und Extraktion erzeugen ausschließlich Dokumente, Runs und Kandidaten. Nur eine gesonderte, authentifizierte und atomare Nutzerbestätigung darf ein TravelItem erzeugen oder ändern.
- **Datenminimierung:** Nur für Reiseplanung und Extraktion erforderliche Inhalte werden gespeichert, übertragen und protokolliert.

## 2. Systemgrenzen und wesentliche Bedrohungen

Die relevanten Vertrauensgrenzen liegen zwischen dem öffentlichen GitHub-Pages-Frontend und dem Browser, zwischen Browser und Supabase, zwischen Browser und Edge Function sowie zwischen Edge Function und OpenAI. GitHub Pages und der gesamte Frontend-Build sind öffentlich. Ein dort enthaltenes Geheimnis gilt als offengelegt.

Die wichtigsten Bedrohungen sind:

| Bedrohung | Mögliche Auswirkung | Zentrale Gegenmaßnahmen |
| --- | --- | --- |
| Gestohlene Zugangsdaten oder Sitzung | Vollzugriff auf die gemeinsame Reise | starke Konten, MFA, kurze Access Tokens, rotierende Sitzungen, Widerrufsmöglichkeit |
| IDOR/BOLA durch manipulierte IDs | Zugriff auf fremde Zeilen oder Dateien | RLS auf jeder Tabelle, aktive Mitgliedschaft über die gesamte Elternkette, negative Tests |
| Fehlkonfigurierte Storage-Policy | Offenlegung vollständiger Dokumente | privater Bucket, unveränderliche zufällige Pfade, Mitgliedschaftsprüfung, keine öffentlichen URLs |
| Missbrauch von Signed URLs | Abruf nach Weitergabe oder Abmeldung | bevorzugt authentifizierter Download; sonst höchstens 60 Sekunden Gültigkeit |
| Leak von OpenAI- oder Service-Schlüssel | Kostenmissbrauch und Backend-Kompromittierung | ausschließlich serverseitige Secrets, getrennte Umgebungen, Rotation, Build- und Log-Prüfung |
| Manipulierte oder aktive Datei | Parserangriff, Schadsoftware, XSS oder Ressourcenerschöpfung | Quarantäne, Signaturprüfung, enge Typregeln, keine aktive Inline-Ausführung, Größen- und Komplexitätslimits |
| Prompt Injection im Dokument | falsche Extraktion oder versuchte Datenexfiltration | Dokument als Daten markieren, keine Tools, striktes Schema, Semantikvalidierung, menschliche Bestätigung |
| Wiederholung oder Parallelisierung | doppelte Ereignisse und unkontrollierte Kosten | Idempotenz, atomare Zustände, Leases, Parallelitäts-, Tages- und Monatslimits |
| Zu ausführliche Logs | sekundäre Offenlegung vertraulicher Inhalte | inhaltsfreie strukturierte Logs, kurze Aufbewahrung, eingeschränkter Zugriff |
| Verlorenes Gerät | Zugriff über bestehende Sitzung oder lokale Downloads | kein Datencache, Sitzungswiderruf, kurze Tokens, Gerätesperre; Downloads ausdrücklich außerhalb der Rückrufbarkeit |

## 3. Authentifizierung und Sitzungen

Für den MVP gelten zwei administrativ vorab eingerichtete, bestätigte persönliche Konten mit E-Mail und Passwort. Öffentliche Registrierung, anonyme Anmeldung, Self-Service-Einladung, Rollenwahl und Self-Service-Wiederherstellung sind deaktiviert. Fehlermeldungen dürfen nicht verraten, ob eine fremde E-Mail-Adresse existiert.

Verbindliche Mindestmaßnahmen:

- Jedes Konto verwendet ein einzigartiges Passwort mit mindestens 14 Zeichen. Kompromittierte oder verbreitete Passwörter werden abgelehnt, sofern Supabase beziehungsweise der vorgeschaltete Prüfweg dies unterstützt.
- Für die reale private Nutzung wird TOTP-MFA für beide Konten verlangt. Die administrative Wiederherstellung prüft die Identität außerhalb der App; sie erzeugt keine allgemein nutzbaren Recovery-Links.
- Access Tokens laufen nach höchstens 15 Minuten ab. Refresh Tokens werden rotiert und dürfen nach Abmeldung, administrativer Sperre, Passwortwechsel oder Sicherheitsvorfall nicht weiterverwendet werden. Die maximal fortlaufende Sitzung beträgt 30 Tage; nach 24 Stunden Inaktivität ist eine erneute Anmeldung erforderlich.
- Sicherheitsrelevante Aktionen wie Gesamtexport, Gesamtlöschung, Kontowiederherstellung und Änderung der MFA verlangen eine frische Anmeldung beziehungsweise erneute MFA.
- Autorisierungsentscheidungen verwenden ausschließlich die stabile Auth-ID und Datenbankmitgliedschaften. Nutzeränderbare JWT- oder `user_metadata`-Felder sind niemals Berechtigungsquelle. Veraltete Claims ersetzen keine aktuelle Datenbankprüfung.
- Das statische Frontend kann keine HttpOnly-Serversitzung garantieren. Deshalb werden keine Reisedaten, Dokumente oder Vorschauen in Service Worker, Cache Storage, IndexedDB oder `localStorage` gespeichert. Soweit eine Browsersitzung lokal persistiert werden muss, wird das Risiko durch kurze JWT-Laufzeit, Refresh-Token-Rotation, strikte CSP und den Verzicht auf unnötige Drittskripte begrenzt.

Login-Versuche werden pro Konto und IP-Adresse begrenzt: höchstens fünf fehlgeschlagene Versuche in 15 Minuten, danach progressive Verzögerung. Die Sperre erzeugt keine Kontoexistenz-Auskunft und kann administrativ aufgehoben werden.

## 4. Einladungslinks und Ablauf

Einladungen sind im MVP deaktiviert. Es werden keine `Invitation`-Zeilen erzeugt, keine Einladungs-E-Mails versendet und keine Trip-Mitgliedschaften über die PWA angelegt. Ein alter, erfundener oder fremder Einladungslink führt nur zu einer neutralen Meldung und gibt weder Reise, Mitglieder noch Zieladresse preis.

Falls Einladungen später aktiviert werden, gilt bereits folgende Sicherheitsvorgabe:

- Der Link enthält mindestens 256 Bit kryptografisch zufällige Entropie. In der Datenbank liegt nur ein HMAC- oder nicht rückrechenbarer Digest, nie der Klartext-Token.
- Ein Link ist einmalig nutzbar, standardmäßig 24 Stunden gültig und kann vorher widerrufen werden. Zustände sind `pending`, `accepted`, `expired` und `revoked`; die Ablaufzeit wird serverseitig in UTC geprüft.
- Annahme setzt ein authentifiziertes, bestätigtes Konto voraus, dessen normalisierte E-Mail-Adresse der Einladung entspricht. Tokenkenntnis allein begründet keine Mitgliedschaft.
- Prüfung, Statuswechsel und Anlage von `TripMember` erfolgen atomar. Wiederverwendung, parallele Annahme, abgelaufene und widerrufene Links schlagen ohne Informationsleck fehl.
- Token, vollständige URL und Zieladresse erscheinen weder in Logs noch Analytics, Referrer-Daten oder Fehlermeldungen. Die Zielseite setzt eine strikte Referrer-Policy.

## 5. Autorisierung und Row Level Security

### 5.1 Einheitliche Mitgliedschaftsregel

Auf jeder Tabelle in einem über die Data API erreichbaren Schema wird RLS aktiviert. Tabellen ohne benötigten Browserzugriff erhalten zusätzlich keine Grants für `anon` oder `authenticated`. Policies richten sich ausdrücklich an Rollen; eine bloße Rolle `authenticated` ohne Zeilenprädikat ist unzureichend.

Ein Nutzer darf eine reisengebundene Zeile nur sehen oder verändern, wenn eine aktive Zeile `TripMember(trip_id, auth.uid())` existiert und alle Eltern-FKs dieselbe Reise ergeben. Bei Tabellen ohne direkte `trip_id` wird die Reise über die kürzeste unveränderliche Elternkette ermittelt. `UPDATE` benötigt sowohl `USING` für den bisherigen als auch `WITH CHECK` für den neuen Zustand. Dadurch kann eine Zeile nicht durch Ändern eines FK in eine andere Reise verschoben werden. Fremdschlüssel und Mitgliedschaftsspalten der Policy-Pfade werden indiziert.

Eine wiederverwendete Mitgliedschaftsprüfung darf nur in einem nicht exponierten Schema liegen. Falls dafür wegen rekursiver `TripMember`-Policies eine privilegierte Hilfsfunktion nötig ist, besitzt sie einen festen `search_path`, vollständig qualifizierte Tabellen, minimale Ausführungsrechte und eine explizite Prüfung von `auth.uid()`; `EXECUTE` für `PUBLIC` wird entzogen. Sonstige Datenbankfunktionen laufen grundsätzlich als Invoker. Views sind nur als `security_invoker` exponiert oder bleiben für Browserrollen gesperrt.

Direkte Browsermutation ist nicht automatisch für jede fachlich erlaubte Aktion vorgesehen. Atomare Vorgänge wie Candidate-Bestätigung, Versionswechsel, Dokumentabschluss und Löschung laufen über eng begrenzte Transaktionen/RPCs oder die authentifizierte Edge Function. Die zugrunde liegenden Tabellen bleiben für direkte Mutationen gesperrt.

### 5.2 Rollen

- **`anon`:** nicht angemeldet; keinerlei Zugriff auf Anwendungszeilen oder private Storage-Objekte.
- **`authenticated` / aktives Mitglied:** eines der zwei Konten mit aktiver Mitgliedschaft in der betroffenen Reise.
- **`trusted_backend`:** Edge Function oder eng begrenzte Datenbankoperation. Ein Service-Schlüssel umgeht RLS und darf deshalb erst nach eigener JWT-, Mitgliedschafts-, Zustands- und Eingabeprüfung eingesetzt werden.
- **Administration:** manueller, protokollierter Notfall- und Bereitstellungsweg; nicht aus der PWA erreichbar.

### 5.3 RLS-Matrix

Die Matrix verwendet die konzeptionellen Tabellennamen des Domain-Modells. Sie ist beim physischen Schema vollständig auf jede tatsächlich erzeugte Tabelle zu übertragen. Werden Referenzen, Reisende, Kontakte, Preise, Bedingungen oder Zusatzattribute in eigene Tabellen aufgeteilt, erhalten sie exakt die Policy ihres `TravelItem`-Elternpfads. Neue Tabellen starten immer ohne Browser-Grants und ohne erlaubende Policy.

In allen Zellen gilt zusätzlich: `anon` ist **nie** erlaubt; `trusted_backend` nur zweckgebunden nach expliziter Prüfung.

| Tabelle | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
| --- | --- | --- | --- | --- |
| `User` | eigenes Minimalprofil; Minimalprofile aktiver Mitglieder derselben Reise | Administration | Administration | Administration |
| `Trip` | aktives Mitglied dieser Reise | Administration | aktives Mitglied, nur fachlich änderbare Felder und mit Versionsprüfung | Administration; keine PWA-Hard-Deletes |
| `TripMember` | aktives Mitglied derselben Reise | Administration | Administration | Administration |
| `Invitation` | niemand im MVP | niemand im MVP | niemand im MVP | niemand im MVP |
| `Document` | aktives Mitglied über `trip_id`; gelöschte Inhalte nur soweit fachlich vorgesehen | aktives Mitglied, eigene Auth-ID als Uploader, serverseitige Limits | nur kontrollierter Dokument-Workflow; Mitglied darf freigegebene Löschaktion anstoßen | kein direkter Hard-Delete; Administration/Gesamtlöschung |
| `ExtractionRun` | aktives Mitglied über `Document.trip_id` | nur authentifizierte Edge Function im Auftrag eines Mitglieds | nur `trusted_backend` für erlaubte Zustandsübergänge | Administration/Aufbewahrungsprozess |
| `ExtractionCandidate` | aktives Mitglied über Run und Document | nur `trusted_backend` nach validiertem Run | Mitglied nur über kontrollierte Korrektur-, Verwerfungs- oder Bestätigungsoperation | kein direkter Delete |
| `CandidateField` | aktives Mitglied über Candidate → Run → Document | nur `trusted_backend` nach Schema- und Semantikvalidierung | niemand; unveränderlich | Administration/Aufbewahrungsprozess |
| `CandidateCorrection` | aktives Mitglied über Candidate-Kette | aktives Mitglied über kontrollierte, versionsgeprüfte Operation; Akteur muss `auth.uid()` sein | niemand; append-only | niemand; Aufbewahrungsprozess nur administrativ |
| `CandidateConfirmation` | aktives Mitglied über Candidate-Kette und Ziel-TravelItem | nur atomare Bestätigungsoperation im Auftrag eines aktiven Mitglieds | niemand; unveränderlich | niemand |
| `TravelItem` | aktives Mitglied über `trip_id` | aktives Mitglied über kontrollierte Anlage/Bestätigung | aktives Mitglied mit `USING`, `WITH CHECK` und Versionsprüfung | kein Hard-Delete; fachliche Löschung als kontrolliertes Update |
| `TravelItemRevision` | aktives Mitglied über `TravelItem.trip_id` | nur atomare TravelItem-Mutation | niemand; unveränderlich | niemand; administrativer Aufbewahrungsprozess vorbehalten |
| `TravelItemDocument` | aktives Mitglied, wenn sowohl Document als auch TravelItem derselben Reise angehören | nur kontrollierte Verknüpfung; beide Eltern müssen derselben Mitgliedsreise angehören | niemand; bei Änderung neue kontrollierte Relation | nur kontrollierte Entknüpfung, nicht kaskadierend |
| `Location` | aktives Mitglied über `trip_id` | aktives Mitglied | aktives Mitglied; Reise-FK unveränderlich, Versionsprüfung | nur wenn fachlich freigegeben und nicht referenziert; sonst Administration |
| `EventTypeDefinition` | angemeldete Nutzer; ausschließlich aktive MVP-Typen | Administration | Administration | Administration |
| `AccommodationDetails` | aktives Mitglied über `TravelItem` | nur zusammen mit kontrollierter TravelItem-Mutation | nur zusammen mit kontrollierter TravelItem-Mutation | nur zusammen mit fachlicher TravelItem-Änderung |
| `FlightDetails` | aktives Mitglied über `TravelItem` | wie `AccommodationDetails` | wie `AccommodationDetails` | wie `AccommodationDetails` |
| `FlightSegment` | aktives Mitglied über Details → TravelItem | kontrollierte TravelItem-Mutation; Elternreise muss übereinstimmen | kontrollierte TravelItem-Mutation; kein Wechsel des Elternaggregats | kontrollierte TravelItem-Mutation |
| `RailDetails` | aktives Mitglied über `TravelItem` | wie `AccommodationDetails` | wie `AccommodationDetails` | wie `AccommodationDetails` |
| `RailSegment` | aktives Mitglied über Details → TravelItem | wie `FlightSegment` | wie `FlightSegment` | wie `FlightSegment` |
| `BusDetails` | aktives Mitglied über `TravelItem` | wie `AccommodationDetails` | wie `AccommodationDetails` | wie `AccommodationDetails` |
| `BusSegment` | aktives Mitglied über Details → TravelItem | wie `FlightSegment` | wie `FlightSegment` | wie `FlightSegment` |
| `ActivityDetails` | aktives Mitglied über `TravelItem` | wie `AccommodationDetails` | wie `AccommodationDetails` | wie `AccommodationDetails` |
| physische TravelItem-Kindtabellen für Referenzen, Reisende, Kontakte, Preise, Bedingungen, Zusatzattribute | aktives Mitglied über Eltern-TravelItem | nur kontrollierte TravelItem-Mutation | nur kontrollierte TravelItem-Mutation; Elternwechsel verboten | nur kontrollierte TravelItem-Mutation |
| `storage.objects` im privaten Dokument-Bucket | aktives Mitglied über kontrollierten Objektpfad und vorhandenes `Document`; gelöschte/quarantänisierte Dokumente nicht lesbar | aktives Mitglied nur in reservierten Pfad einer eigenen neuen Document-Zeile | niemand; Originale sind unveränderlich, Upsert ist aus | kontrollierte Dokumentlöschung oder Administration |

RLS schützt auch Realtime: Es dürfen nur Änderungen an Zeilen ausgespielt werden, die der Abonnent regulär per `SELECT` lesen kann. Realtime-Payloads sind nur Invalidierungssignale; der Client lädt den kanonischen Stand erneut unter RLS.

## 6. Private Dokumente und Storage

Es gibt genau einen privaten Bucket für Originaldokumente. Öffentliche Buckets, öffentliche Objekt-URLs und dauerhafte Freigabelinks sind verboten. Ein Original wird nach erfolgreichem Upload nicht überschrieben; eine neue Fassung erhält eine neue Document- und Objekt-ID.

### 6.1 Nicht erratbare Pfade

Der Objektpfad wird serverseitig reserviert und besteht ausschließlich aus zufälligen technischen IDs, zum Beispiel:

```text
trips/{trip_uuid}/documents/{document_uuid}/{object_uuid}
```

Jede ID besitzt mindestens 122 Bit effektive Zufälligkeit. Originaldateiname, E-Mail-Adresse, Reisebezeichnung, Datum, Buchungsnummer und fortlaufende Zähler erscheinen nicht im Pfad. Der Pfad ist global eindeutig, wird in `Document.storage_object_key` gebunden und darf vom Browser nicht frei für ein anderes Dokument gewählt werden. Nicht erratbare Pfade ergänzen die Policy; sie ersetzen sie nicht.

### 6.2 Upload und Abruf

Der Upload ist nur für eine vorher unter RLS angelegte Document-Zeile im Status `uploading` möglich. Bucket-Regeln begrenzen Dateigröße und gemeldeten MIME-Typ bereits beim Upload. Nach dem Upload bleibt das Objekt in Quarantäne und ist für den zweiten Nutzer nicht abrufbar, bis serverseitige Prüfung Größe, Signatur, Container und Prüfsumme bestätigt und den Zustand auf `available` gesetzt hat.

Für den normalen Abruf wird ein authentifizierter Storage-Download bevorzugt. Falls eine Vorschau oder Plattformintegration zwingend eine Signed URL benötigt, wird sie erst nach erneuter Mitgliedschafts- und Dokumentstatusprüfung erzeugt, ist höchstens **60 Sekunden** gültig und wird weder persistiert noch geloggt. Antworten verwenden `Cache-Control: private, no-store` und eine strikte Referrer-Policy. Signed URLs sind Bearer-Geheimnisse und während ihrer Laufzeit weitergebbar; sie werden daher nicht als dauerhafte Zugriffssteuerung betrachtet.

Vorschauen werden als Blob geladen und über eine lokale Object-URL angezeigt, die beim Schließen, Abmelden und Seitenwechsel widerrufen wird. Dokumente werden niemals als ungeprüftes HTML eingebettet. Aktive Office-Inhalte, SVG, HTML und sonstige ausführbare Inhalte erhalten keine Inline-Vorschau; der Browser soll Downloads als Attachment behandeln. Bereits bewusst auf ein Gerät heruntergeladene Originale können serverseitig nicht zurückgerufen werden.

## 7. Upload-Grenzen, MIME-Typen und manipulierte Dateien

### 7.1 Betriebsgrenzen

Für den MVP gilt zunächst:

- maximal **20 MiB pro Original**;
- maximal **5 Dateien und 50 MiB pro Auswahlvorgang**;
- maximal **50 nicht gelöschte Originale** in der aktiven Reise;
- maximal **2 parallele Uploads pro Nutzer** und **1 aktive Extraktion pro Dokument**;
- die jeweils kleinere Grenze von Anwendung, Supabase, Edge Function, OpenAI-Modell und API ist maßgeblich.

Die Werte sind serverseitige Konfiguration und können nach repräsentativen Tests abgesenkt werden. Eine Anhebung ist eine bewusste Sicherheits- und Kostenentscheidung.

### 7.2 Erlaubte Typen

Die wirksame Positivliste wird serverseitig versioniert aus den aktuell tatsächlich unterstützten OpenAI-Datei- und Bildtypen sowie dem gewählten Modell abgeleitet. Sie ist keine dauerhaft eingefrorene lokale Produktliste. Das Frontend zeigt nur diese Konfiguration an; es erfindet keine eigene Liste. Die in den Produktgrundlagen ausdrücklich belegte Kernmenge umfasst:

- `application/pdf`;
- `image/png`, `image/jpeg`, `image/webp` und nicht animiertes `image/gif`;
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`);
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`);
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` (`.pptx`);
- `message/rfc822` (`.eml`);
- passive Textformate aus der zum gewählten Modell gehörenden OpenAI-Positivliste.

Weitere aktuell vom gewählten OpenAI-Modell unterstützte Formate werden in dieselbe versionierte Konfiguration aufgenommen, sobald die Anwendung sie anhand Signatur und Struktur sicher als tatsächlich verarbeitbar erkennen kann. Archive, Programme, ausführbare Skripte, Datenträgerabbilder, passwortgeschützte Dateien, makrofähige Office-Formate und SVG bleiben gesperrt, sofern sie nicht ausdrücklich unterstützt und mit einem isolierten, getesteten Prüfpfad sicher verarbeitet werden können. Ein plausibler Browser-MIME-Typ allein genügt nie. HEIC/HEIF wird nicht angenommen, solange es nicht in der maßgeblichen Provider-Positivliste steht.

### 7.3 Inhaltsprüfung und Quarantäne

Dateiendung und Browser-MIME sind Hinweise, keine Beweise. Vor Extraktion und Freigabe werden mindestens geprüft:

1. tatsächliche Bytezahl gegen die Grenze und die erwartete Uploadlänge;
2. Magic Bytes beziehungsweise Dateisignatur und Übereinstimmung mit Endung/MIME;
3. Containerstruktur von OOXML und vergleichbaren Formaten, einschließlich Pfadtraversal, ungewöhnlicher Dateianzahl und Dekompressionsbombe;
4. PDF-Struktur, Verschlüsselung/Passwortschutz, eingebettete Dateien und aktive Inhalte;
5. Bilddekodierbarkeit, Pixelobergrenze von 40 Megapixeln und bei GIF genau ein Bild;
6. kryptografische Prüfsumme des unveränderten Originals.

Parser arbeiten ohne Ausführung eingebetteter Makros, JavaScript, Links oder externer Ressourcen und mit festen Zeit-, Speicher- und Dekompressionslimits. Bei Signaturkonflikt, Polyglot-Verdacht, beschädigter Struktur, eingebettetem ausführbarem Inhalt oder Ressourcenlimit wird die Datei mit stabilem Fehlercode auf `invalid` beziehungsweise `unsupported` gesetzt und nicht an OpenAI gesendet. Kann im gewählten Edge-Function-Rahmen keine ausreichende Prüfung eines Formats gewährleistet werden, bleibt dieses Format gesperrt, bis ein isolierter Prüfpfad existiert.

Ein Malware-Scan ist vor Freigabe an das zweite Mitglied vorzusehen. Bis ein belastbarer Scanner integriert ist, werden nur die oben genannten passiven Kernformate akzeptiert und riskante Dateien nicht inline geöffnet. Ein Scan ersetzt weder Signaturprüfung noch sichere Darstellung.

## 8. Edge Function, OpenAI-Key und Prompt Injection

### 8.1 Authentifizierung der Edge Function

Die Extraktionsfunktion akzeptiert ausschließlich `POST` von der konfigurierten Produktionsorigin und benötigt ein Nutzer-JWT im Authorization-Header. CORS ist keine Autorisierung, reduziert aber Browsermissbrauch; Wildcard-Origins sind nicht erlaubt.

Vor jeder privilegierten Aktion prüft die Funktion:

1. Signatur, Issuer, Audience, Ablauf und erwartetes Supabase-Projekt des JWT;
2. aktives Auth-Konto und, für sensible Vorgänge, eine gültige aktuelle Sitzung;
3. aktive Trip-Mitgliedschaft aus der Datenbank;
4. dass die übergebene `document_id` über Metadaten zur selben Reise gehört;
5. erlaubten Dokumentstatus, Version, Idempotenzschlüssel, Limits und Budget;
6. dass `storage_object_key`, Modell, Prompt, Schema, Token-/Ausgabelimit und Providerparameter ausschließlich aus vertrauenswürdiger Serverkonfiguration stammen.

Die Funktion akzeptiert keine frei übermittelten Storage-Pfade, URLs, Prompttexte, Modelle oder OpenAI-Parameter. Ihr Request-Body enthält nur eng validierte technische IDs und einen Idempotenzschlüssel. Erst nach allen Prüfungen darf sie einen Service-Schlüssel verwenden. Fehler liefern neutrale Codes und keine Existenzbestätigung fremder IDs.

### 8.2 Schutz des OpenAI API Keys

Der OpenAI-Key liegt ausschließlich als Supabase-Secret der Edge Function vor. Er darf niemals in Repository, `VITE_*`-Variable, GitHub-Pages-Artefakt, Browser, Datenbankzeile, Clientfehler, Trace oder Log gelangen. Entwicklungs-, Test- und Produktionsumgebung erhalten getrennte OpenAI-Projekte und Schlüssel mit minimalen Rechten. Das Produktionsprojekt ist ausschließlich für die festgelegte API-Nutzung vorgesehen.

Der Key wird mindestens halbjährlich und sofort bei Verdacht rotiert. Deployment und CI erhalten den Key nicht, sofern sie ihn nicht für einen ausdrücklich getrennten Backend-Schritt benötigen. Produktionsbuilds werden auf Secret-Muster geprüft. Providerfehler werden vor dem Logging redigiert. Ein vermuteter Leak führt zu sofortigem Widerruf, neuem Key, Budgetstopp und Prüfung von Nutzung und Logs.

### 8.3 Prompt Injection in Reisedokumenten

Dokumentinhalt ist untrusted data, auch wenn er wie eine Systemanweisung, JSON-Schemaänderung oder Toolaufforderung formuliert ist. Die Schutzkette besteht aus mehreren unabhängigen Ebenen:

- Der feste serverseitige System-Prompt erklärt das Dokument ausdrücklich zu Daten und weist Anweisungen, Toolaufrufe und Formatänderungen aus dem Dokument zurück.
- Das Modell erhält keine Tools, keinen Browser, keine Datenbankzugänge, keine weiteren Dokumente und keine Geheimnisse. Eine erfolgreiche Injection kann daher keine Aktion ausführen oder fremde Daten abrufen.
- Prompt, Modell, Schema-Version und striktes Structured-Output-Schema werden nur serverseitig ausgewählt. Freitext, zusätzliche Properties, mehrere Ergebnisse und Reasoning-Inhalte werden abgelehnt.
- Schema-Konformität reicht nicht: Die Edge Function validiert Grenzen, Provenance, Evidence, Zeit-, Typ-, Referenz- und Semantikregeln erneut und verwirft geheime oder vollständige Zahlungsdaten.
- Evidence bleibt kurz und wird begrenzt. Dokumenttext wird nicht als HTML gerendert und die rohe Modellantwort nicht dauerhaft gespeichert.
- Das Resultat bleibt ein unbestätigter Candidate. Nur die sichtbare menschliche Prüfung und eine zweite serverseitige Validierung dürfen ein TravelItem erzeugen.

Prompt-Injection-Tests gehören bei jeder Änderung an Prompt, Modell oder Schema zum Release-Gate.

## 9. Rate Limits, Parallelität und monatliches API-Budget

Limits werden atomar serverseitig pro Auth-ID, Reise, Dokument und IP-Adresse gezählt. Clientseitige Zähler und Providerlimits sind nur zusätzliche Sicherungen.

| Aktion | MVP-Limit |
| --- | --- |
| Fehlgeschlagene Logins | 5 je Konto und IP in 15 Minuten, danach progressive Verzögerung |
| Document-Anlagen/Uploads | 10 je Nutzer pro Stunde, 20 je Reise pro Tag |
| Extraktionsstarts einschließlich manueller Retries | 10 je Nutzer pro Tag, 20 je Reise pro Tag |
| Aktive Extraktionen | 1 je Dokument, 1 je Nutzer, höchstens 2 global |
| Automatische technische Retries | höchstens 2 je Run mit exponentiellem Backoff; keine Retries bei fachlichen Fehlern |
| Candidate-Bestätigungen | 30 je Nutzer pro Stunde; immer idempotent und versionsgeprüft |
| Signed-URL-Erzeugung | 30 je Nutzer pro 15 Minuten |

Für OpenAI gilt ein hartes Anwendungsbudget von **20 EUR Gegenwert pro Kalendermonat** für das gesamte MVP-Projekt. Maßgeblich ist der Betrag in der tatsächlichen Provider-Abrechnungswährung. Vor einem Aufruf reserviert die Anwendung atomar dessen konservativ geschätzte Maximalkosten; eine parallele Anfrage kann das Restbudget daher nicht überziehen. Nach jedem erfolgreichen Responses-API-HTTP-Aufruf wird die anhand der Usage berechnete Providerbelastung sofort, idempotent und vor jeder Schema-/Semantikprüfung verbucht. Fehlt in einer möglicherweise kostenpflichtigen HTTP-200-Antwort eine verwertbare Usage, wird konservativ der noch nicht verbuchte Reservierungsrest berechnet. Ein späterer Validierungs- oder Speicherfehler darf Kosten daher nicht auf null zurückrollen.

Extraktions-Runs bilden eine dauerhafte Queue. Nur der interne Worker kann mit einem getrennten, in Function-Secrets und Vault provisionierten Credential einen fälligen Run beanspruchen. Claims verwenden kurze Leases und `SKIP LOCKED`; abgelaufene Leases werden deterministisch zurückgeführt. Automatische Wiederholung ist auf insgesamt drei Provider-Versuche begrenzt und respektiert dieselbe Kostenreservierung.

Bei 50 %, 75 % und 90 % wird administrativ gewarnt. Bei 100 % startet keine neue Extraktion; Upload, manuelle Erfassung, Prüfung vorhandener Kandidaten und Dokumentabruf bleiben verfügbar. Ein Override ist nur administrativ, zeitlich begrenzt und protokolliert möglich. Das OpenAI-Projektbudget und Provider-Kostenwarnungen bilden eine zweite Schutzschicht. Preise und Budgetumrechnung werden versioniert konfiguriert und vor jeder Reise geprüft.

Ein globaler Kill Switch kann alle neuen Provideraufrufe stoppen, ohne bestehende Daten oder manuelle Funktionen zu beeinträchtigen.

## 10. Logging, Monitoring und Vorfallbehandlung

Logs sind strukturiert und enthalten nur, was zur Betriebsdiagnose erforderlich ist:

- zufällige Korrelations-ID, technische User-, Trip-, Document- und Run-ID;
- Operation, Status, Dauer, Größenklasse statt exakter Inhalt, Modell-/Prompt-/Schema-Version;
- Provider-Request-ID, Rate-Limit-/Budgetentscheidung und stabiler inhaltsfreier Fehlercode.

Nicht geloggt werden Dokumentinhalt, Dateiname, E-Mail-Adresse, Buchungs- oder Ticketnummer, Adresse, Notizen, Evidence-Text, vollständiger Prompt, rohe Modellantwort, Passwörter, JWTs, Refresh Tokens, API Keys, Signed URLs, Authorization-Header oder Zahlungsdaten. Stacktraces und Providerantworten werden vor Speicherung redigiert. Candidate-Fundstellen sind Anwendungsdaten, keine Logs.

Operative Logs werden standardmäßig 30 Tage aufbewahrt, sind nur für die Administration zugänglich und werden danach gelöscht. Sicherheitsereignisse wie wiederholte Auth-Fehler, RLS-Verstöße, Budgetstopp, Secret-Rotation und administrative Löschung dürfen länger in inhaltsfreier Form aufbewahrt werden, sofern eine Frist vor Go-live festgelegt wird. Für den MVP werden keine zusätzlichen Analytics-, Session-Replay- oder Error-Tracking-Dienste eingebunden.

Bei einem Vorfall gilt: neue Extraktionen stoppen, betroffene Sitzungen und Schlüssel widerrufen, Umfang anhand inhaltsfreier IDs bestimmen, beide Nutzer verständlich informieren, Ursache beheben und Negativtest ergänzen. Inhalte werden nicht zur bequemeren Diagnose nachträglich in Logs kopiert.

## 11. Datenschutz: Minimierung, Export und Löschung

Supabase erhält die für Betrieb und Speicherung erforderlichen Daten; OpenAI erhält nur das konkrete Original für die angeforderte Extraktion. GitHub erhält keine Reise- oder Dokumentdaten. Providerregion, API-Datenverwendung, Aufbewahrung und Ausschluss der Nutzung zum Training allgemein verfügbarer Modelle werden vor privater Nutzung geprüft und dokumentiert. Temporäre OpenAI-Dateien werden nach dem Job bestmöglich gelöscht; ihre ID wird nur so lange wie technisch nötig gehalten.

### 11.1 Export

Ein Self-Service-Export ist kein MVP-Ziel. Es existiert aber ein getesteter administrativer Prozess. Nach frischer Authentifizierung und MFA erhält die anfragende Person:

- das eigene Profil und die eigene Mitgliedschaft;
- die gemeinsam zugänglichen strukturierten Reisedaten in einem dokumentierten, maschinenlesbaren Format;
- eigene Korrektur-, Bestätigungs- und Akteursdaten;
- die privaten Originaldokumente, zu deren Reise sie weiterhin Mitglied ist;
- eine kurze Erklärung der Felder, Zeitpunkte und Herkunftsbeziehungen.

Das Exportarchiv wird clientseitig oder in einem isolierten administrativen Prozess verschlüsselt, getrennt vom Passwort übergeben, nach erfolgreicher Übergabe gelöscht und niemals über eine langlebige öffentliche URL bereitgestellt.

### 11.2 Löschung

Es gibt drei getrennte Vorgänge:

1. **Document löschen:** Status terminal auf `deleted`, neue Extraktionen sperren, Storage-Blob entfernen und nur den festgelegten minimalen Tombstone erhalten. TravelItems bleiben bestehen.
2. **TravelItem löschen:** fachliche Löschung und Revision; Dokumente bleiben unabhängig erhalten.
3. **Gesamtlöschung:** Sitzungen zuerst widerrufen, Konten deaktivieren, Storage-Objekte und temporäre Providerdateien löschen, anschließend reisengebundene Datenbankzeilen, Profile und Auth-Konten nach definierter Reihenfolge entfernen oder, wo Integritätsreferenzen zwingend bleiben, irreversibel anonymisieren.

Da die Reise beiden Personen gemeinsam gehört, darf die Löschung eines einzelnen Kontos nicht stillschweigend gemeinsame Originale oder Reisedaten der anderen Person vernichten. Der Prozess unterscheidet daher Kontolöschung von gemeinsam bestätigter Gesamtlöschung. Personenbezogene Akteursfelder werden nach Kontolöschung anonymisiert, soweit ihre Beibehaltung nicht erforderlich und vereinbart ist. Eine Anfrage wird administrativ protokolliert, innerhalb einer vor Go-live festgelegten Frist abgearbeitet und durch einen nachgelagerten Test auf verwaiste Blobs, aktive Tokens und verbliebene Providerdateien verifiziert.

Verschlüsselte Backups besitzen eine festgelegte Aufbewahrungsfrist von höchstens 30 Tagen. Gelöschte Daten werden nicht selektiv aus unveränderlichen Backups rekonstruiert und nach Ablauf durch Backup-Löschung beziehungsweise Schlüsselvernichtung entfernt. Restore-Tests dürfen gelöschte Produktionsdaten nicht wieder in den aktiven Dienst einspielen.

## 12. Verlorene oder kompromittierte Geräte

Die PWA speichert nur die öffentliche App-Shell offline. Reisedaten, API-Antworten, Dokumente und Vorschaublobs werden nicht dauerhaft gecacht. Das begrenzt, beseitigt aber nicht das Risiko einer aktiven Sitzung oder bewusst heruntergeladener Dateien.

Bei Verlust oder Verdacht gilt folgender Ablauf:

1. Gerätesperre beziehungsweise Remote-Wipe des Betriebssystems auslösen, soweit verfügbar.
2. Alle Sitzungen des betroffenen Kontos administrativ widerrufen und das Konto vorübergehend deaktivieren.
3. Passwort ändern, MFA neu binden und erst danach das Konto wieder aktivieren.
4. Bei möglichem XSS-/Token-Diebstahl auch das zweite Konto prüfen, aktuelle Refresh Sessions widerrufen und Secret-/Deployment-Integrität kontrollieren.
5. Zugriffe anhand inhaltsfreier Logs prüfen; bei Verdacht OpenAI- und Service-Schlüssel rotieren und den Kill Switch aktivieren.

Ein kurzer Access-Token begrenzt die Restlaufzeit. Für besonders sensible Operationen wird zusätzlich eine aktuelle Sitzung geprüft, damit die bekannte Eigenschaft bereits ausgestellter Tokens bei Kontolöschung oder Sperre nicht allein über Sicherheit entscheidet. Die Nutzer werden ausdrücklich darauf hingewiesen, dass lokale Downloads nicht durch Abmeldung oder Serverlöschung verschwinden.

## 13. Konkrete negative Sicherheitstests

Für Tests werden neben den zwei legitimen Konten ein drittes authentifiziertes Nichtmitglied, eine zweite Testreise und getrennte Testobjekte angelegt. Kein Test verwendet echte Reisedokumente. Die folgenden Tests sind Release-Gate; ein unerwartet erfolgreicher Zugriff blockiert das Deployment.

| ID | Negativer Test | Erwartung |
| --- | --- | --- |
| AUTH-01 | Ohne Sitzung jede Data-API-Tabelle lesen oder verändern | `401/403` beziehungsweise leeres, nicht unterscheidbares Ergebnis; keine Zeile und kein Realtime-Event |
| AUTH-02 | Drittes Konto meldet sich an und verwendet bekannte Trip-, Document-, Candidate-, Location- und TravelItem-UUIDs | Jede Operation abgelehnt; keine Existenz-, Status- oder Timing-Auskunft über fremde Ressourcen |
| AUTH-03 | Mitglied setzt bei `INSERT`/`UPDATE` `trip_id`, Eltern-FK oder Akteurs-ID auf eine fremde Reise/einen anderen Nutzer | `WITH CHECK` beziehungsweise Transaktion lehnt vollständig ab; keine Teiländerung |
| AUTH-04 | Nutzer versucht TripMember oder Invitation direkt anzulegen, zu ändern oder zu löschen | Abgelehnt; Mitgliederzahl und Invitation-Tabelle unverändert |
| AUTH-05 | Nutzer liest Profile ohne gemeinsame aktive Reise oder setzt `user_metadata` auf `admin`/fremde Trip-ID | Kein zusätzlicher Zugriff; Metadaten haben keine Autorisierungswirkung |
| AUTH-06 | Abgelaufenes, falsch signiertes, für anderes Projekt ausgestelltes oder manipuliertes JWT ruft Edge Function auf | Vor jeder DB-/Storage-/OpenAI-Aktion abgelehnt |
| AUTH-07 | Gültiges JWT eines inzwischen deaktivierten Mitglieds beziehungsweise widerrufener Session ruft sensible Funktion auf | Abgelehnt; kein Provideraufruf |
| INV-01 | Erfundenes, abgelaufenes oder widerrufenes Einladungstoken sowie parallele doppelte Annahme | Neutrale Ablehnung; keine Reiseoffenlegung; höchstens eine atomare Annahme in späterer Phase |
| DB-01 | Für **jede** Matrixzeile werden `SELECT/INSERT/UPDATE/DELETE` als `anon`, Nichtmitglied und Mitglied ausgeführt | Nur die exakt aufgeführten Operationen gelingen; unveränderliche Tabellen bleiben unverändert |
| DB-02 | Mitglied versucht CandidateConfirmation ohne Candidate-Version, doppelt mit neuem Idempotenzschlüssel oder nach `discarded` | Atomare Ablehnung; kein TravelItem, keine Revision, keine Dokumentrelation |
| DB-03 | Zwei Mitglieder ändern dieselbe Trip-/Document-/Candidate-/TravelItem-Version parallel | Genau eine Änderung gewinnt; zweite erhält Versionskonflikt und überschreibt nichts |
| DB-04 | Direkter Schreibversuch auf CandidateField oder TravelItemRevision | Abgelehnt; Append-only-/Unveränderlichkeitsgarantie bleibt bestehen |
| STORE-01 | Öffentliche Bucket-URL, `anon`-Download oder Listing des privaten Buckets | Kein Objekt und keine Metadaten abrufbar |
| STORE-02 | Mitglied errät/kopiert einen Pfad einer zweiten Reise oder manipuliert Pfadsegmente | Upload, Download, List, Update und Delete abgelehnt |
| STORE-03 | Upsert/Overwrite auf vorhandenes Original und Upload ohne passende Document-Zeile | Abgelehnt; Prüfsumme und Original unverändert |
| STORE-04 | Signed URL wird nach 61 Sekunden, nach Document-Löschung und nach Sitzungswiderruf erneut verwendet | Nach Ablauf nicht nutzbar; es existiert keine langlebige URL. Dokumentlöschung verhindert neue URLs |
| FILE-01 | Datei heißt `.pdf`, besitzt aber EXE-/ZIP-Signatur oder widersprüchlichen MIME-Typ | Quarantäne und Ablehnung vor OpenAI; sicherer Fehlercode, kein Inhaltslog |
| FILE-02 | Passwortgeschützte/beschädigte PDF, PDF mit eingebettetem JavaScript/Datei, makrofähiges Office-Dokument | Keine aktive Vorschau oder Extraktion; nach Regel `invalid`/`unsupported` |
| FILE-03 | Zip-/OOXML-Bombe, Pfadtraversal im Container, 41-Megapixel-Bild, animiertes GIF und Datei über 20 MiB | Frühzeitiger Abbruch innerhalb Ressourcenlimit; kein Provideraufruf |
| AI-01 | Dokument enthält „Ignoriere Systemprompt“, verlangt fremde Dokumente, Secrets, Toolaufruf oder abweichendes JSON | Keine Aktion/Exfiltration; nur strictes Schema oder sicherer Run-Fehler; niemals TravelItem |
| AI-02 | Modell liefert schema-konforme, aber semantisch falsche IDs, zu viele Events, Geheimnisse oder widersprüchliche Zeiten | Servervalidierung verwirft atomar; keine Candidates beziehungsweise nur regelkonform unvollständige Candidates |
| AI-03 | Provider liefert Freitext, mehrere JSON-Werte, Timeout, Teilantwort oder Reasoning | Keine Teilpersistenz; begrenzter idempotenter technischer Retry; bestehende TravelItems unverändert |
| LIMIT-01 | Mehr als erlaubte Uploads/Extraktionen, parallele Starts oder Replay desselben Requests | `429`/stabiler Limitcode; höchstens ein Run/Ergebnis; keine zusätzlichen Kosten durch Replay |
| BUDGET-01 | Parallele Requests würden zusammen das verbleibende Monatsbudget überschreiten | Kostenreservierung lässt nur zulässige Requests zu; danach harter Stopp ohne Beeinträchtigung manueller Funktionen |
| SECRET-01 | Produktionsbuild, Source Maps, Repository und Clientnetzwerk werden nach OpenAI-/Service-Key-Mustern geprüft | Kein Secret vorhanden; nur öffentliche Supabase-Konfiguration im Frontend |
| LOG-01 | Fehler mit Dateiname, Buchungsnummer, Token, Signed URL und Dokumentanweisung wird provoziert | Logs enthalten nur IDs, Größenklasse und sicheren Fehlercode; alle vertraulichen Werte fehlen |
| DEVICE-01 | Sitzung wird auf Gerät A widerrufen; dort werden API, Storage, Realtime und Edge Function erneut genutzt | Refresh scheitert; spätestens nach Access-Token-Ablauf kein Zugriff; sensible Funktionen bereits durch Sitzungsprüfung gesperrt |
| PRIV-01 | Gesamtexport eines Kontos | Nur berechtigter Datenumfang, verschlüsseltes Artefakt, keine fremde Testreise, keine Secrets oder rohe Modellantwort |
| PRIV-02 | Document-, Konto- und Gesamtlöschung mit anschließendem DB-, Storage-, Session- und Providercheck | Definierte Daten entfernt/anonymisiert, keine verwaisten Blobs oder aktiven Sitzungen, unabhängige Daten des anderen Nutzers korrekt behandelt |

Zusätzlich wird automatisiert geprüft, dass jede neu angelegte Tabelle RLS aktiviert hat, keine unerwarteten Grants an `anon`/`authenticated` besitzt und jede exponierte View als Security Invoker arbeitet. Änderungen an RLS, Storage-Policies, Auth-Konfiguration, Prompt, Extraktionsschema, Uploadtypen oder Budgetlogik erfordern die jeweils betroffenen Negativtests erneut.

## 14. Offene Entscheidungen vor Implementierungsbeginn

Die folgenden fachlichen Punkte bleiben in den Grundlagen bewusst offen und müssen vor ihrer jeweiligen Umsetzung entschieden werden:

- Aufbewahrung eines Originals nach verworfenem Candidate und Behandlung seiner Korrekturen;
- Nutzerrecht zur gesonderten Dokumentlöschung und Umfang eines zulässigen Tombstones;
- endgültige physische Form der TravelItem-Kindtabellen und damit ihre konkreten Policy-Pfade;
- Scanner-/Isolationslösung für weitere, nicht passive Dateiformate;
- konkrete Provider-Aufbewahrung und sichere Löschung temporärer OpenAI-Dateien;
- Frist und Verantwortlicher für Kontolöschung sowie Aufbewahrung inhaltsfreier Sicherheitslogs.

Keine dieser Entscheidungen darf die unveränderlichen Sicherheitsgrenzen aufweichen: private Dokumente, aktive Reisemitgliedschaft für jeden Zugriff, kein Geheimnis im Frontend, keine automatische Bestätigung von LLM-Ausgaben und Default-Deny für jede neue Tabelle und jedes neue Storage-Objekt.
