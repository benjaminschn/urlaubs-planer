# MVP-Produktbrief: Gemeinsamer Reiseplaner

**Status:** Verbindliche Produktgrundlage für den MVP  
**Zielgruppe des Dokuments:** Produkt, Entwicklung und Abnahme  
**Stand:** 2. August 2026

## 1. Ziel und Abgrenzung

Der MVP ist eine privat genutzte, mobile-first Progressive Web App (PWA) für genau zwei Personen. Er validiert, ob Reisebestätigungen aus unterschiedlichen Quellen zuverlässig in einen gemeinsamen, verständlichen Reiseplan überführt werden können.

Der MVP unterstützt genau eine aktive gemeinsame Reise des festen Zweierkreises. Er ist kein allgemein verfügbares Produkt für beliebige Paare oder Gruppen und enthält noch keine Gruppen-, Einladungs- oder Organisationsfunktionen.

## 2. Problem und Produktversprechen

### Problem

Reiseinformationen liegen typischerweise verteilt in PDFs, Screenshots, Bildern, exportierten E-Mails und anderen Dokumenten verschiedener Anbieter vor. Dadurch müssen Reisende Daten wiederholt suchen, manuell zusammenführen und untereinander abgleichen. Besonders unterwegs erschwert das den schnellen Zugriff auf Zeiten, Orte, Buchungsdetails und Originalbestätigungen.

### Produktversprechen

> Lade beliebige Reisebestätigungen hoch und erhalte automatisch einen gemeinsamen, übersichtlichen Reiseplan.

Für den MVP bedeutet „beliebige Reisebestätigungen“: Dateien in allen Formaten, die von der für die Extraktion eingesetzten OpenAI-Schnittstelle und dem gewählten Modell als Dokument- oder Bildeingabe akzeptiert werden. Der Inhalt muss einer der fünf unterstützten Ereignisarten zugeordnet werden können. Eine fehlerfreie Erkennung wird nicht versprochen; deshalb ist vor der Übernahme jedes automatisch erkannten Ereignisses eine menschliche Kontrolle erforderlich.

## 3. Primäre Nutzer und Nutzungssituation

### Primäre Nutzer

- Zwei namentlich bekannte Personen, die gemeinsam eine Reise planen oder durchführen.
- Beide Personen sind gleichberechtigt und sehen sowie bearbeiten dieselben Reisedaten und Dokumente.
- Eine Unterscheidung zwischen Eigentümer, Administrator und Gast gibt es im MVP nicht.

### Nutzungssituationen

1. **Vor der Reise:** Eine Person lädt Buchungsbestätigungen hoch oder erfasst fehlende Reisebestandteile manuell. Erkannte Daten werden geprüft und gemeinsam in einer Timeline gesammelt.
2. **Während der Reise:** Beide Personen greifen vor allem mobil auf die chronologische Timeline, Ereignisdetails und Originaldokumente zu.
3. **Bei Änderungen:** Eine der beiden Personen korrigiert oder löscht ein Ereignis. Die Änderung ist anschließend für beide sichtbar.

## 4. Wichtigste Nutzeraufgaben

In absteigender Priorität müssen die beiden Nutzer:

1. sich sicher anmelden und auf ihre gemeinsame Reise zugreifen können;
2. Reisebestätigungen in allen von der eingesetzten OpenAI-Schnittstelle unterstützten Dokument- und Bildformaten hochladen können;
3. automatisch erkannte Buchungsdaten kontrollieren und korrigieren können;
4. bestätigte Reiseereignisse in einer gemeinsamen chronologischen Timeline sehen können;
5. Reiseereignisse manuell anlegen, bearbeiten und löschen können;
6. zugehörige Originaldokumente öffnen oder herunterladen können;
7. Änderungen der jeweils anderen Person nach erneutem Laden sehen können.

## 5. Verbindlicher MVP-Umfang

Der MVP umfasst ausschließlich:

- Anmeldung für zwei vorab eingerichtete persönliche Konten;
- eine aktive, für beide Konten gemeinsame Reise mit Titel sowie Start- und Enddatum;
- manuelle Anlage und Pflege von Reiseereignissen;
- die Ereignisarten Unterkunft, Flug, Bahn, Bus und Aktivität;
- Upload aller Dokument- und Bildformate, die von der eingesetzten OpenAI-Schnittstelle und dem gewählten Modell als Eingabe akzeptiert werden;
- automatische Extraktion relevanter Reisedaten aus einem hochgeladenen Dokument;
- einen verpflichtenden Kontroll- und Korrekturschritt vor der Aufnahme extrahierter Daten in die Timeline;
- eine gemeinsame, chronologisch sortierte Timeline bestätigter Ereignisse;
- gemeinsame Anzeige beziehungsweise Download der Originaldokumente;
- Nutzung als mobile-first PWA auf dem iPhone und als Webanwendung in unterstützten Desktop-Browsern.

## 6. Explizite Nicht-Ziele des MVP

Nicht Bestandteil des MVP sind:

- Registrierung für beliebige Nutzer, Einladungen, Gruppen und mehr als zwei Personen;
- mehrere gleichzeitig aktive Reisen sowie Reisevorlagen, Kopien oder Archive;
- direkter E-Mail-Import aus einem Postfach oder über eine Weiterleitungsadresse; eine manuell hochgeladene, unterstützte E-Mail-Datei ist dagegen erlaubt;
- Synchronisation mit Kalendern, Buchungsportalen oder anderen Drittanbietern;
- Erinnerungen, Push-Nachrichten und sonstige Benachrichtigungen;
- Konflikt-, Plausibilitäts- oder Vollständigkeitswarnungen;
- Kartenansicht, Navigation und Routenplanung;
- kollaborative Echtzeitbearbeitung, Kommentare und Änderungsverlauf;
- Offline-Bearbeitung oder garantierter Offline-Zugriff;
- weitere Ereignisarten, insbesondere Fähre, Mietwagen und Restaurantreservierung;
- automatische Umbuchung, Stornierung oder Aktualisierung aus neuen Dokumenten;
- automatische Veröffentlichung extrahierter Daten ohne Nutzerbestätigung;
- Kostenverwaltung, Summen, Budgetplanung, Währungsumrechnung oder Zahlungen; einzelne aus einer Bestätigung extrahierte Preisangaben dürfen am Ereignis gespeichert werden;
- öffentliche Freigabelinks, Export und Druckansichten;
- produktiver Einsatz für weitere Haushalte oder eine kommerzielle Veröffentlichung.


## 7. Funktionale Anforderungen

### FR-01 Anmeldung und Zugriff

- Es existieren genau zwei persönliche, vorab eingerichtete Konten.
- Jede Person kann sich an- und abmelden.
- Nicht angemeldete Personen erhalten keinen Zugriff auf Reise-, Ereignis- oder Dokumentdaten.
- Beide Konten besitzen identische Lese- und Schreibrechte auf die gemeinsame Reise.
- Ein Self-Service für Registrierung, Einladung, Kontowiederherstellung oder Rollenverwaltung ist nicht erforderlich.

### FR-02 Gemeinsame Reise

- Die gemeinsame Reise besitzt mindestens einen Titel, ein Startdatum und ein Enddatum.
- Beide Personen sehen dieselbe Reise und denselben aktuellen Datenstand.
- Titel, Startdatum und Enddatum können von beiden Personen geändert werden.
- Das Enddatum darf nicht vor dem Startdatum liegen.

### FR-03 Ereignisarten und gemeinsame Basisdaten

Der MVP unterstützt ausschließlich Unterkunft, Flug, Bahn, Bus und Aktivität. Das Datenformat wird von Anfang an umfangreich angelegt, damit möglichst viele Angaben aus realen Bestätigungen erhalten bleiben. Für jede Ereignisart gilt derselbe minimale Pflichtkern; alle weiteren Angaben sind optional und können später ergänzt werden.

#### Gemeinsame Felder aller Ereignisse

Jedes Ereignis kann folgende Angaben enthalten:

- Ereignisart und frei änderbarer Titel;
- Buchungsstatus: bestätigt, storniert oder unbekannt;
- Beginn und Ende mit lokalem Datum, optionaler Uhrzeit und fachlich relevanter Zeitzone;
- Genauigkeit einer Zeitangabe: exakte Uhrzeit, nur Datum oder unbekannt;
- Start-, Ziel- und Hauptort mit Name, vollständiger Adresse, Ort, Region, Land, Postleitzahl und optionalem Orts- beziehungsweise Anbieter-Code;
- Anbieter, Vermittler beziehungsweise Buchungsplattform;
- eine oder mehrere Buchungs-, Reservierungs-, Bestell- oder Vorgangsnummern;
- Namen der Reisenden beziehungsweise Gäste;
- Kontaktangaben des Anbieters: Telefon, E-Mail und Website;
- Buchungs-, Check-in- oder Verwaltungslink;
- Preisangaben: Gesamtpreis, Währung, bereits bezahlt, noch offen, Steuern und Gebühren;
- Zahlungsstatus und optional verwendete Zahlungsart ohne vollständige Zahlungsdaten;
- Buchungsdatum;
- Stornierungsfrist und Stornierungsbedingungen als strukturierte Angabe oder Freitext;
- freie Notizen;
- ein oder mehrere zugehörige Originaldokumente;
- zusätzliche anbieterspezifische Angaben als Bezeichnung-Wert-Paare, wenn eine Information keinem vorgesehenen Feld eindeutig zugeordnet werden kann.

Die einzigen Pflichtfelder für jede Ereignisart sind Ereignisart, Titel und Startdatum. Eine Uhrzeit, ein Enddatum, ein Ort und alle ereignisartspezifischen Angaben sind optional. Wenn ein Ende angegeben ist, darf es nicht vor dem Beginn liegen.

#### Unterkunft

Ein Unterkunftsereignis kann zusätzlich enthalten:

- Name und Art der Unterkunft;
- vollständige Adresse und optional Koordinaten;
- Check-in- und Check-out-Datum, jeweilige Uhrzeit beziehungsweise Zeitfenster und Zeitzone;
- Anzahl der Nächte, Zimmer und Gäste;
- Zimmer-, Apartment- oder Unterkunftsbezeichnung;
- Zimmernummer, Etage sowie Bett- oder Zimmerkonfiguration;
- Namen der Haupt- und Mitreisenden;
- Verpflegung beziehungsweise gebuchte Leistungen;
- Check-in-Verfahren, Zugangshinweise sowie Schlüssel- oder Zugangscode;
- Rezeption-, Gastgeber- und Notfallkontakt;
- besondere Wünsche und Hinweise der Unterkunft;
- Kostenaufschlüsselung, Kaution, Tourismusabgabe und Zahlungsplan;
- Buchungs- und Stornierungsbedingungen.

Für Unterkünfte gelten keine zusätzlichen Pflichtfelder über den gemeinsamen Pflichtkern hinaus.

#### Flug

Ein Flugereignis kann aus einer oder mehreren unmittelbar zusammengehörenden Flugstrecken bestehen. Jede Flugstrecke kann enthalten:

- Marketing- und ausführende Fluggesellschaft;
- Flugnummer, Buchungscode/PNR und Ticketnummer;
- Abflug- und Ankunftsflughafen mit Name, Ort und IATA- beziehungsweise ICAO-Code;
- planmäßige lokale Abflug- und Ankunftszeit mit jeweiliger Zeitzone;
- Terminal und Gate für Abflug und Ankunft;
- Flugstatus, sofern im Dokument enthalten;
- Passagiernamen;
- Sitzplatz, Kabinenklasse, Buchungs- und Tarifklasse;
- Freigepäck, Handgepäck und weitere gebuchte Leistungen;
- Check-in-Zeitraum und Check-in-Link;
- Ticket-, Tarif-, Umbuchungs- und Stornierungsbedingungen;
- Dauer der Strecke sowie Umstiegsdauer zur nächsten Strecke.

Für Flüge gelten keine zusätzlichen Pflichtfelder über den gemeinsamen Pflichtkern hinaus. Sind Flugstrecken vorhanden, ergibt sich die Timeline-Zeit des Ereignisses aus der ersten bis zur letzten enthaltenen Flugstrecke.

#### Bahn

Ein Bahnereignis kann aus einer oder mehreren unmittelbar zusammengehörenden Teilstrecken bestehen. Jede Teilstrecke kann enthalten:

- Anbieter beziehungsweise Betreiber;
- Zugart, Zugnummer und Linienbezeichnung;
- Abfahrts- und Zielbahnhof mit Name, Ort und optionalem Bahnhofscode;
- planmäßige lokale Abfahrts- und Ankunftszeit mit jeweiliger Zeitzone;
- Gleis für Abfahrt und Ankunft;
- Reisendenamen;
- Wagen, Sitzplatz, Klasse und Reservierungsstatus;
- Ticket-, Auftrags- und Reservierungsnummer;
- Ticketart, Gültigkeitszeitraum und Zugbindung;
- Tarif, BahnCard- oder sonstige Ermäßigung;
- Ticket-, Umbuchungs- und Stornierungsbedingungen;
- Dauer der Teilstrecke sowie Umstiegsdauer zur nächsten Teilstrecke.

Für Bahnfahrten gelten keine zusätzlichen Pflichtfelder über den gemeinsamen Pflichtkern hinaus. Sind Teilstrecken vorhanden, ergibt sich die Timeline-Zeit des Ereignisses aus der ersten bis zur letzten enthaltenen Teilstrecke.

#### Bus

Ein Busereignis kann aus einer oder mehreren unmittelbar zusammengehörenden Teilstrecken bestehen. Jede Teilstrecke kann enthalten:

- Anbieter beziehungsweise Betreiber;
- Linien-, Fahrt- oder Busnummer;
- Abfahrts- und Zielhaltestelle mit Name, Adresse, Ort und optionalem Haltestellencode;
- planmäßige lokale Abfahrts- und Ankunftszeit mit jeweiliger Zeitzone;
- Steig, Gate oder Abfahrtsbereich;
- Reisendenamen;
- Sitzplatz, Komfort- oder Buchungsklasse und Reservierungsstatus;
- Ticket-, Buchungs- und Reservierungsnummer;
- Ticketart und Gültigkeitszeitraum;
- Gepäckbestimmungen und gebuchte Zusatzleistungen;
- Ticket-, Umbuchungs- und Stornierungsbedingungen;
- Dauer der Teilstrecke sowie Umstiegsdauer zur nächsten Teilstrecke.

Für Busfahrten gelten keine zusätzlichen Pflichtfelder über den gemeinsamen Pflichtkern hinaus. Sind Teilstrecken vorhanden, ergibt sich die Timeline-Zeit des Ereignisses aus der ersten bis zur letzten enthaltenen Teilstrecke.

#### Aktivität

Ein Aktivitätsereignis kann zusätzlich enthalten:

- Art beziehungsweise Kategorie der Aktivität;
- Anbieter, Veranstalter oder Guide;
- Veranstaltungsort mit Name, vollständiger Adresse und optional Koordinaten;
- Treffpunkt und abweichender Endpunkt;
- Start, Einlass, Treffzeit und Ende mit lokaler Zeit und Zeitzone;
- Dauer;
- Teilnehmernamen und Teilnehmerzahl;
- Buchungs-, Ticket-, Gutschein- oder Voucher-Nummer;
- Ticketart, Anzahl der Tickets, Platz-, Bereichs- oder Sitzangaben;
- Sprache der Durchführung;
- enthaltene und nicht enthaltene Leistungen;
- Alters-, Gesundheits-, Zugangs- oder Teilnahmevoraussetzungen;
- Hinweise zu Kleidung, Ausrüstung, Anreise und rechtzeitigem Erscheinen;
- Barrierefreiheitsangaben;
- Kontakt- und Notfallangaben;
- Umbuchungs-, Stornierungs- und No-Show-Bedingungen.

Für Aktivitäten gelten keine zusätzlichen Pflichtfelder über den gemeinsamen Pflichtkern hinaus.

### FR-04 Manuelle Ereignisse

- Beide Personen können ein Ereignis einer unterstützten Art manuell anlegen.
- Vor dem Speichern werden die erforderlichen Angaben und zeitlichen Regeln geprüft.
- Beide Personen können jedes bestätigte Ereignis bearbeiten und löschen.
- Gelöschte Ereignisse müssen nicht durch die Nutzer wiederherstellbar sein.

### FR-05 Dokument-Upload

- Beide Personen können eine oder mehrere Dateien auswählen und hochladen.
- Akzeptiert werden alle Formate, die zum Zeitpunkt des Uploads von der eingesetzten OpenAI-Schnittstelle und dem gewählten Modell als `input_file` oder Bildeingabe unterstützt werden.
- Die App führt keine eigene, dauerhaft festgeschriebene Positivliste. Sie darf ein Format aber nur annehmen, wenn es tatsächlich verarbeitet werden kann.
- Nicht unterstützte, beschädigte, passwortgeschützte oder zu große Dateien werden mit einem verständlichen Grund abgelehnt.
- Für Größen- und Mengenlimits gelten höchstens die aktuellen Grenzen der eingesetzten OpenAI-Schnittstelle; die App darf zum Schutz vor versehentlichen sehr großen Uploads niedrigere Grenzen festlegen.
- Der Nutzer erhält einen verständlichen Status für Upload und Verarbeitung sowie eine verständliche Fehlermeldung bei einem Fehlschlag.
- Ein Dokument wird nicht allein durch den Upload als bestätigtes Timeline-Ereignis veröffentlicht.

Maßgebliche Produktreferenzen sind die offiziellen OpenAI-Seiten zu [Dateieingaben](https://developers.openai.com/api/docs/guides/file-inputs#full-list-of-accepted-file-types) und [Bildeingaben](https://developers.openai.com/api/docs/guides/images-vision#image-input-requirements). Stand dieses Produktbriefs werden zahlreiche Dokument-, Tabellen-, Präsentations-, E-Mail-, Text- und Codeformate akzeptiert. Für direkte Bildeingaben werden PNG, JPEG, WebP und nicht animiertes GIF genannt; HEIC/HEIF gehört nicht zur veröffentlichten Liste.

### FR-06 Automatische Extraktion

- Nach erfolgreichem Upload versucht das Produkt, aus jeder Datei einen oder mehrere Entwürfe zu erzeugen. Eine Bestätigung mit Hin- und Rückreise darf somit mehrere Ereignisse ergeben.
- Die Extraktion ordnet jeden Entwurf einer der fünf unterstützten Ereignisarten zu und befüllt soweit erkennbar deren Felder und Teilstrecken.
- Nicht sicher erkannte oder nicht vorhandene Angaben bleiben leer oder werden als unsicher kenntlich gemacht; Angaben dürfen nicht als sicher dargestellt werden, wenn sie lediglich vermutet wurden.
- Angaben, die keinem vorgesehenen Feld eindeutig zugeordnet werden können, dürfen als zusätzliche anbieterspezifische Angaben erhalten bleiben.
- Schlägt die Extraktion fehl oder kann der Inhalt keiner unterstützten Ereignisart zugeordnet werden, bleiben Dokument und Fehlermeldung zugänglich. Der Nutzer kann die Daten manuell erfassen oder den Vorgang erneut anstoßen.

### FR-07 Kontrolle und Korrektur

- Jeder automatisch erzeugte Entwurf wird vor der Bestätigung mit allen erkannten, änderbaren Daten angezeigt.
- Der Nutzer kann Ereignisart, Anzahl der erzeugten Ereignisse, Teilstrecken und sämtliche extrahierten Felder korrigieren, ergänzen oder entfernen.
- Pflichtfelder und zeitliche Regeln werden vor der Bestätigung geprüft.
- Erst eine ausdrückliche Bestätigung erzeugt ein Ereignis in der gemeinsamen Timeline.
- Der Nutzer kann den Entwurf verwerfen, ohne ein Ereignis zu erzeugen. Ob dabei auch das Originaldokument gelöscht wird, ist eine offene Produktentscheidung.

### FR-08 Gemeinsame Timeline

- Die Timeline zeigt ausschließlich bestätigte Ereignisse der gemeinsamen Reise.
- Ereignisse sind primär chronologisch nach ihrem Beginn sortiert.
- Bei identischem Beginn ist die Sortierung stabil und nachvollziehbar.
- Pro Ereignis sind mindestens Art, Titel und Startdatum erkennbar. Optionale Orte oder Verbindungen werden angezeigt, wenn sie vorhanden sind.
- Die Detailansicht enthält alle gespeicherten Ereignisdaten und gegebenenfalls einen Zugriff auf das Originaldokument.
- Nach einem erneuten Laden sehen beide Personen denselben bestätigten Stand.

### FR-09 Originaldokumente

- Ein hochgeladenes Original bleibt mit dem daraus bestätigten Ereignis verknüpft.
- Beide angemeldeten Personen können das Original öffnen oder herunterladen.
- Der Dateiname und der Dateityp bleiben erkennbar.
- Originaldokumente sind für nicht angemeldete Personen nicht über einen allgemein zugänglichen Link abrufbar.
- Das Löschen eines Ereignisses löscht das zugehörige Dokument nicht zwingend; die endgültige Regel ist vor Implementierungsbeginn zu entscheiden.

### FR-10 Fehler- und Leerzustände

- Die App erklärt verständlich, wenn noch keine Ereignisse vorhanden sind.
- Fehler bei Anmeldung, Upload, Extraktion, Validierung und Dokumentabruf werden verständlich und handlungsorientiert dargestellt.
- Ein fehlgeschlagener Verarbeitungsschritt darf bereits bestätigte Ereignisse nicht verändern oder duplizieren.

## 8. Nichtfunktionale Anforderungen

### NFR-01 Plattform und Bedienbarkeit

- Die PWA ist für die aktuelle öffentliche iOS-/Safari-Version sowie mindestens einen aktuellen Desktop-Browser, zunächst Safari oder Chrome, ausgelegt.
- Alle Kernaufgaben sind auf einem iPhone ab 375 CSS-Pixel Breite ohne horizontales Scrollen durchführbar.
- Die Kernfunktionen bleiben im Desktop-Browser vollständig nutzbar.
- Die App ist installierbar, sofern der jeweilige Browser die Installation von PWAs unterstützt; die Installation ist keine Voraussetzung für die Nutzung.

### NFR-02 Leistung

- Navigation, Timeline und Formulare reagieren im normalen privaten Gebrauch ohne störende Verzögerung.
- Bei länger dauerndem Upload und bei der Extraktion zeigt die App unmittelbar einen nachvollziehbaren Status und bleibt bedienbar.

### NFR-03 Zuverlässigkeit und Datenintegrität

- Bestätigte Ereignisse bleiben nach Abmeldung, erneutem Laden und Anmeldung des anderen Kontos erhalten.
- Wiederholte Bestätigung oder Wiederholung einer fehlgeschlagenen Anfrage erzeugt nicht unbeabsichtigt doppelte Ereignisse.
- Extraktionsergebnisse überschreiben niemals ohne ausdrückliche Bestätigung bestehende Ereignisse.

### NFR-04 Datenschutz und Sicherheit

- Reise- und Dokumentdaten sind ausschließlich für die zwei autorisierten Konten zugänglich.
- Anmeldedaten, Reiseinhalte und Dokumente werden bei der Übertragung verschlüsselt.
- Geheimnisse und Anmeldedaten werden nicht im Klartext gespeichert.
- Für die automatische Extraktion dürfen nur die hierfür erforderlichen Dokumentinhalte verarbeitet werden.
- Der eingesetzte Extraktionsdienst darf die Inhalte nicht zum Training allgemein verfügbarer Modelle verwenden, sofern dies vertraglich oder durch entsprechende Produkteinstellungen ausgeschlossen werden kann.
- Fehlerprotokolle enthalten keine vollständigen Dokumentinhalte, Anmeldedaten oder unnötigen personenbezogenen Daten.
- Vor privater Nutzung ist festgelegt, wie sämtliche Reise-, Ereignis- und Dokumentdaten gelöscht werden können; ein Self-Service-Löschdialog ist im MVP nicht erforderlich.

### NFR-05 Barrierearmut

- Formulare besitzen verständliche Bezeichnungen, Fehlerhinweise sind nicht ausschließlich farblich codiert und Text weist ausreichenden Kontrast auf.

### NFR-06 Sprache und Zeitangaben

- Die Produktsprache des MVP ist Deutsch.
- Datums- und Zeitangaben werden eindeutig und in einem für deutschsprachige Nutzer vertrauten Format dargestellt.
- Gespeicherte Reisezeiten behalten ihre fachlich relevante lokale Zeitzone; eine bloße Umrechnung in die Gerätezeitzone darf den Reiseablauf nicht verfälschen.

### NFR-07 Betriebsrahmen

- Der MVP ist für genau zwei Konten, eine aktive Reise, höchstens 30 bestätigte Ereignisse und höchstens 50 Originaldokumente ausgelegt.
- Eine formale Verfügbarkeitsgarantie, 24/7-Support oder Disaster-Recovery-Zusage ist nicht Bestandteil des MVP.
- Es muss vor Nutzung eine dokumentierte Möglichkeit zur Datensicherung und Wiederherstellung geben.

## 9. Zentrale Begriffe und Definitionen

| Begriff | Verbindliche Definition im MVP |
| --- | --- |
| **Konto** | Persönlicher Zugang einer der genau zwei autorisierten Personen. |
| **Zweierkreis** | Die beiden gleichberechtigten Konten, die dieselbe Reise und alle zugehörigen Inhalte teilen. |
| **Reise** | Der gemeinsame Container aus Titel, Reisezeitraum, Ereignissen und Dokumenten. Im MVP existiert genau eine aktive Reise. |
| **Reiseereignis** | Ein zeitlich einordenbarer Bestandteil der Reise mit einer der fünf unterstützten Ereignisarten. |
| **Ereignisart** | Unterkunft, Flug, Bahn, Bus oder Aktivität. Andere Ereignisarten werden im MVP nicht gespeichert. |
| **Pflichtkern** | Die drei für jedes Reiseereignis erforderlichen Angaben: Ereignisart, Titel und Startdatum. |
| **Teilstrecke** | Ein einzelner Flug beziehungsweise eine einzelne Bahn- oder Busfahrt innerhalb eines zusammengehörenden Verkehrsereignisses. |
| **Dokument** | Eine hochgeladene und von der eingesetzten OpenAI-Schnittstelle unterstützte Dokument- oder Bilddatei, die als Original erhalten und zur Extraktion verarbeitet wird. |
| **Originaldokument** | Die unveränderte, vom Nutzer hochgeladene Datei. Technisch notwendige Vorschauen oder Konvertierungen ersetzen sie nicht. |
| **Extraktion** | Automatische Ableitung strukturierter Ereignisdaten aus einem Dokument. Sie erzeugt zunächst nur einen Entwurf. |
| **Entwurf** | Noch nicht bestätigtes Extraktionsergebnis, das nicht in der gemeinsamen Timeline erscheint. |
| **Bestätigung** | Ausdrückliche Nutzeraktion, mit der ein geprüfter Entwurf als gemeinsames Ereignis gespeichert wird. |
| **Timeline** | Gemeinsame chronologische Darstellung aller bestätigten Ereignisse der Reise. |
| **Fachliche Zeitzone** | Die am jeweiligen Reiseort beziehungsweise für die Verbindung geltende Zeitzone einer Zeitangabe. |

## 10. Annahmen

Die folgenden Annahmen gelten für den MVP und sind vor einer Ausweitung erneut zu prüfen:

- **A-01:** Die beiden Nutzer kennen und vertrauen einander; deshalb sind identische Rechte und das Fehlen eines Änderungsverlaufs akzeptabel.
- **A-02:** Die zwei Konten werden außerhalb der App vorab eingerichtet. Registrierung, Einladung und Self-Service-Wiederherstellung sind für den privaten Test nicht nötig.
- **A-03:** Genau eine aktive Reise reicht aus, um das zentrale Produktversprechen zu validieren.
- **A-04:** Ein Dokument kann mehrere Ereignisse oder Teilstrecken enthalten. Die automatische Aufteilung mit anschließender menschlicher Kontrolle ist für den privaten MVP ausreichend.
- **A-05:** Die von der eingesetzten OpenAI-Schnittstelle akzeptierten Dokument- und Bildformate decken die realen Reisebestätigungen des Zweierkreises ausreichend ab. Nicht unterstützte iPhone-Formate können bei Bedarf vor dem Upload konvertiert werden.
- **A-06:** Deutsche und englische Reisebestätigungen sind für den privaten Test ausreichend. Die Oberfläche bleibt deutsch.
- **A-07:** Eine menschliche Prüfung ist zumutbar und fachlich notwendig; die Extraktion soll Eingabeaufwand reduzieren, nicht Verantwortung ersetzen.
- **A-08:** Eine chronologische Timeline bietet im MVP mehr Kernnutzen als eine Kartenansicht.
- **A-09:** Eine aktive Internetverbindung ist für Anmeldung, Upload, Extraktion und Datenabruf verfügbar.
- **A-10:** Die festgelegten Mengen- und Dateigrenzen decken eine private Reise des Zweierkreises ab.

## 11. Offene Produktentscheidungen

Diese Entscheidungen verändern das zentrale MVP-Versprechen nicht, müssen aber vor Implementierungsbeginn verbindlich festgelegt werden:

1. **Anmeldeverfahren:** Passwort, Einmal-Link oder ein anderes einfaches Verfahren für die zwei vorab eingerichteten Konten.
2. **Lokale Dateigrenzen:** Ob die App niedrigere Größen- oder Mengenlimits als die eingesetzte OpenAI-Schnittstelle setzt.
3. **Dokumente ohne Ereignis:** Ob ein verworfener Entwurf sein Originaldokument behält und wo solche Dokumente erreichbar sind.
4. **Löschregel:** Ob das Löschen eines Ereignisses das einzige zugehörige Originaldokument mitlöscht oder separat aufbewahrt.
5. **Zeitzonen-Eingabe:** Wie die fachliche Zeitzone bei manueller Erfassung gewählt beziehungsweise vorgeschlagen wird.
6. **Extraktionssprachen:** Ob neben Deutsch und Englisch weitere Sprachen ohne zugesicherte Qualität zugelassen werden.
7. **Zusammengehörende Teilstrecken:** Nach welcher einfachen Regel mehrere Flüge, Bahn- oder Busfahrten als ein Ereignis oder als getrennte Ereignisse vorgeschlagen werden. Hin- und Rückreise sollen grundsätzlich getrennte Ereignisse sein.

## 12. Messbare Akzeptanzkriterien

Die Abnahme ist ein pragmatischer gemeinsamer Funktionstest der beiden tatsächlichen Nutzer. Prozentwerte, große Testmatrizen, formale Lasttests und eine bestimmte Extraktionsgenauigkeit sind für den privaten MVP nicht erforderlich. Der MVP ist abnahmefähig, wenn diese Checkliste einmal vollständig bestanden ist:

- **AC-01:** Beide Personen können sich mit ihrem eigenen Konto anmelden, abmelden und auf dieselbe Reise zugreifen. Ohne Anmeldung sind Reise, Ereignisse und Dokumente nicht zugänglich.
- **AC-02:** Eine Person legt ein Ereignis an oder ändert es. Nach erneutem Laden sieht die andere Person denselben gespeicherten Stand.
- **AC-03:** Je ein Unterkunfts-, Flug-, Bahn-, Bus- und Aktivitätsereignis kann ausschließlich mit Ereignisart, Titel und Startdatum bestätigt, anschließend bearbeitet und gelöscht werden.
- **AC-04:** Optionale gemeinsame und ereignisartspezifische Detailfelder können bei allen fünf Ereignisarten gespeichert werden und bleiben nach erneutem Laden unverändert erhalten. Ein Verkehrsereignis mit mindestens zwei Teilstrecken kann ebenfalls gespeichert werden.
- **AC-05:** Eindeutig ungültige Zeitfolgen in vorhandenen optionalen Zeitangaben, etwa Check-out vor Check-in oder Ankunft vor Abfahrt innerhalb derselben Teilstrecke unter Berücksichtigung der Zeitzonen, verhindern die Bestätigung bis zur Korrektur.
- **AC-06:** Mindestens je eine reale PDF-, Bild- und weitere unterstützte Dokumentdatei, zum Beispiel DOCX oder EML, lässt sich hochladen. Eine absichtlich nicht unterstützte Datei wird mit verständlichem Grund abgelehnt.
- **AC-07:** Je eine reale oder repräsentative Bestätigung für Unterkunft, Flug, Bahn, Bus und Aktivität erzeugt mindestens einen kontrollierbaren Entwurf. Die vorgeschlagene Ereignisart und mindestens zwei befüllte Felder stimmen jeweils mit dem Dokument überein; sämtliche Angaben lassen sich vor der Bestätigung korrigieren, ergänzen oder entfernen.
- **AC-08:** Eine Bestätigung mit mehreren Buchungen oder Reiseabschnitten kann mehrere Entwürfe beziehungsweise Teilstrecken erzeugen und vor der Übernahme korrigiert werden.
- **AC-09:** Kein automatisch erzeugter Entwurf erscheint ohne ausdrückliche Bestätigung in der Timeline.
- **AC-10:** Bestätigte Ereignisse erscheinen bei beiden Personen in sinnvoller chronologischer Reihenfolge. Ereignisse ohne genaue Uhrzeit werden am richtigen Reisetag angezeigt.
- **AC-11:** Beide Personen können jedes zugeordnete Originaldokument öffnen oder herunterladen; ohne gültige Anmeldung ist dies nicht möglich.
- **AC-12:** Ein absichtlich ausgelöster Upload- oder Extraktionsfehler beschädigt oder verändert keine bereits bestätigten Ereignisse und zeigt einen verständlichen Status.
- **AC-13:** Der vollständige Kernablauf Anmeldung → Upload → Prüfung/Korrektur → Bestätigung → Timeline → Originaldokument funktioniert auf einem aktuellen iPhone sowie in einem aktuellen Desktop-Browser.

## 13. MVP-Erfolg und Entscheidung nach dem Test

Der MVP gilt als produktseitig validiert, wenn die Akzeptanzkriterien erfüllt sind, beide Nutzer ihn für mindestens eine echte gemeinsame Reise verwenden und anschließend beide bestätigen, dass:

- die wichtigen Dokumente für Unterkünfte, Flüge, Bahn, Bus und Aktivitäten in der App auffindbar waren, sofern diese Ereignisarten auf der Reise vorkamen;
- die automatische Extraktion gegenüber einer vollständig manuellen Pflege spürbar Arbeit gespart hat;
- Timeline und Originaldokumente unterwegs praktisch nutzbar waren;
- sie die App für eine weitere gemeinsame Reise wieder verwenden würden.

Diese Validierung entscheidet über eine nächste Phase. Sie begründet noch nicht automatisch die Aufnahme zurückgestellter Funktionen.
