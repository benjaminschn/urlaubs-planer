# Mobile-first UX-Planung: Gemeinsamer Reiseplaner

**Grundlage:** `docs/product/brief.md`, Stand 2. August 2026  
**Geltungsbereich:** MVP für zwei vorab eingerichtete, gleichberechtigte Konten und genau eine aktive gemeinsame Reise  
**Schwerpunkt:** Abläufe, Informationshierarchie, Zustände und Abnahmekriterien; kein visuelles Designsystem, keine hochauflösenden Mockups und kein Code

## 1. UX-Leitlinien und Produktgrenzen

1. **Die Timeline ist der Ausgangspunkt.** Nach der Anmeldung landen Nutzer direkt bei der gemeinsamen Reise und sehen zuerst die chronologische Übersicht bestätigter Ereignisse.
2. **Hinzufügen ist eine Aufgabe mit zwei Wegen.** Ein Ereignis entsteht entweder aus einem Dokument oder durch manuelle Eingabe. Beide Wege münden vor dem Speichern in einer kontrollierbaren Ereignisansicht.
3. **Automatik bleibt ein Vorschlag.** Extrahierte Angaben sind Entwürfe. Unsicherheit wird sichtbar gemacht; nichts gelangt ohne ausdrückliche Bestätigung in die Timeline.
4. **Original und strukturierte Daten bleiben verbunden.** Vom Ereignis führt ein kurzer Weg zum Originaldokument; vom Dokument ist erkennbar, welche Entwürfe oder Ereignisse daraus entstanden sind.
5. **Mobile Aufgaben werden in kleine, sichere Schritte geteilt.** Wesentliche Entscheidungen und Pflichtangaben erscheinen früh. Seltene Detailfelder sind nachgelagert, aber vollständig erreichbar.
6. **Verbindungsprobleme dürfen keine Unklarheit über den Speicherstand erzeugen.** Die Oberfläche unterscheidet klar zwischen lokal eingegeben, wird übertragen, wird verarbeitet, gespeichert und fehlgeschlagen.

### Bewusste Abgrenzung: Einladung

Der MVP enthält keine Registrierung, Einladung oder Rollenverwaltung. Es existieren genau zwei außerhalb der App vorab eingerichtete Konten. Deshalb gibt es im MVP keinen ausführbaren Ablauf „Einladung annehmen“, keinen Einladungslink und keinen Einladungsscreen. Ein Aufruf eines nicht vorgesehenen oder alten Einladungslinks darf keine Reiseinformationen preisgeben und führt zur Anmeldung beziehungsweise zu einer neutralen Meldung, dass Einladungen in dieser Version nicht unterstützt werden.

## 2. Informationsarchitektur

### 2.1 Oberste Ebenen

```text
Öffentlicher Bereich
└── Anmeldung

Geschützter Bereich
└── Gemeinsame Reise
    ├── Timeline
    │   └── Ereignisdetails
    │       ├── Ereignis bearbeiten
    │       └── Zugehörige Dokumente
    ├── Hinzufügen
    │   ├── Dokument hochladen
    │   │   ├── Upload und Verarbeitung
    │   │   └── Entwürfe kontrollieren
    │   └── Ereignis manuell anlegen
    ├── Dokumente
    │   └── Dokumentansicht
    │       └── Zugehörige Entwürfe oder Ereignisse
    └── Reise
        ├── Reisedaten bearbeiten
        └── Abmelden
```

### 2.2 Informationshierarchie innerhalb der Reise

Die Reise zeigt Informationen in dieser Reihenfolge:

1. **Aktueller Kontext:** Reisetitel und Zeitraum.
2. **Nächste Aufgabe oder nächstes Ereignis:** laufende Uploads/Entwürfe als klar getrennte Arbeitsstände; bestätigte Ereignisse als Timeline.
3. **Primäre Aktion:** Dokument hochladen oder Ereignis manuell anlegen.
4. **Vertiefung:** vollständige Ereignisdetails und Originaldokumente.
5. **Verwaltung:** Reisedaten bearbeiten, Ereignis löschen, Abmelden.

Entwürfe werden nicht zwischen bestätigten Ereignissen dargestellt. Sie erscheinen in einem eigenen, deutlich benannten Arbeitsbereich wie „Zu prüfen“, damit der Status der gemeinsamen Timeline eindeutig bleibt.

### 2.3 Inhaltsmodelle aus UX-Sicht

- **Reise:** Titel, Startdatum, Enddatum.
- **Bestätigtes Ereignis:** Art, Titel und Startdatum als Pflichtkern; optional Uhrzeit, Ende, Orte, Buchungs- und Anbieterdaten, Personen, Preise, Bedingungen, Notizen, Teilstrecken, Zusatzangaben und Dokumente.
- **Entwurf:** dieselbe editierbare Struktur wie ein Ereignis, ergänzt um Herkunftsdokument, Erkennungsstatus und Hinweise auf unsichere oder fehlende Angaben.
- **Dokument:** Originaldatei, Dateiname, Dateityp, Verarbeitungsstatus, verständlicher Fehlerstatus und Verknüpfungen zu Entwürfen oder bestätigten Ereignissen.

## 3. Screen-Inventar

| Screen / Oberfläche | Zweck | Wichtigste Inhalte | Primäre Aktion |
| --- | --- | --- | --- |
| Anmeldung | Sicherer Zugang für eines der zwei Konten | Anmeldefelder gemäß später festgelegtem Verfahren, Fehlerhinweis | Anmelden |
| Reise einrichten | Einmalige Anlage der gemeinsamen Reise, falls noch keine existiert | Titel, Startdatum, Enddatum | Reise erstellen |
| Timeline | Startscreen und gemeinsamer Reiseüberblick | Reise-Kopf, Arbeitsstände, chronologische Ereignisse | Hinzufügen |
| Hinzufügen-Auswahl | Einstieg in beide Erfassungswege | „Dokument hochladen“, „Manuell anlegen“ | Weg auswählen |
| Ereignisart wählen | Start der manuellen Erfassung | Unterkunft, Flug, Bahn, Bus, Aktivität | Art auswählen |
| Ereignisformular | Manuelles Anlegen oder Bearbeiten | Pflichtkern zuerst, optionale Abschnitte danach | Speichern |
| Upload-Auswahl | Eine oder mehrere Dateien auswählen | Dateiauswahl, Hinweise zu dynamisch unterstützten Formaten und lokalen Limits | Dateien auswählen |
| Upload-Warteschlange | Fortschritt je Datei nachvollziehen | Dateiname, Upload- und Verarbeitungsstatus, Fehler, Wiederholung | Status ansehen / Wiederholen |
| Entwurfsübersicht | Ergebnisse eines Dokuments ordnen | Anzahl erkannter Entwürfe, Arten, Bearbeitungsstand | Entwurf prüfen |
| Entwurf kontrollieren | Erkannte Daten prüfen und korrigieren | Originalzugriff, unsichere Felder, Pflichtkern, Details, Teilstrecken | Ereignis bestätigen |
| Ereignisdetails | Alle gespeicherten Angaben lesen | Zeit, Orte, Buchungsdetails, Teilstrecken, Dokumente | Bearbeiten |
| Dokumente | Alle erreichbaren Originale der Reise | Dateiname, Typ, Status, Verknüpfung | Dokument öffnen |
| Dokumentansicht | Original ansehen oder herunterladen | Vorschau, Metadaten, zugehörige Ereignisse/Entwürfe | Öffnen / Herunterladen |
| Reise bearbeiten | Gemeinsamen Reisekontext pflegen | Titel, Startdatum, Enddatum | Änderungen speichern |
| Bestätigungsdialoge | Folgenschwere Aktionen absichern | Auswirkung der Aktion | Löschen / Verwerfen bestätigen |

Auf kleinen Displays dürfen lange Formulare in logisch benannte Abschnitte gegliedert werden. Das ist ein zusammenhängender Vorgang; Nutzer müssen jederzeit erkennen, was bereits ausgefüllt ist, was noch fehlt und wie sie zurückkehren.

## 4. Navigation

### 4.1 Globale Navigation

Nach der Anmeldung gibt es nur einen Reisekontext. Eine Reiseauswahl ist daher unnötig.

- **Untere Navigation auf Mobilgeräten:** „Timeline“ und „Dokumente“ als stabile Ziele.
- **Prominente Aktion „Hinzufügen“:** von Timeline und Dokumenten erreichbar; öffnet eine Auswahl zwischen Upload und manueller Anlage.
- **Reisekopf:** Reisetitel und Zeitraum; führt zur Bearbeitung der Reise.
- **Kontomenü:** enthält mindestens „Abmelden“ und darf mit der Reisebearbeitung im Kopfbereich gebündelt sein, solange beide Ziele eindeutig beschriftet sind.
- **Detailnavigation:** Zurück führt zur vorherigen sinnvollen Ebene und erhält möglichst Scrollposition sowie noch nicht abgeschlossene Eingaben.

### 4.2 Navigationsregeln

- Browser-Zurück und iOS-Zurück-Geste dürfen keine unerwartete Bestätigung, Löschung oder doppelte Anlage auslösen.
- Beim Verlassen eines geänderten, noch nicht gespeicherten Formulars erfolgt eine Warnung mit „Weiter bearbeiten“ und „Änderungen verwerfen“.
- Ein Deep Link auf Reise-, Ereignis- oder Dokumentinhalte verlangt zuerst eine gültige Anmeldung und kehrt danach zum angeforderten, berechtigten Ziel zurück.
- Nicht vorhandene, gelöschte oder nicht zugängliche Ziele zeigen einen neutralen Fehler mit Rückweg zur Timeline.
- Laufende Uploads und Verarbeitungen bleiben über einen sichtbaren Arbeitsstatus erreichbar, auch wenn Nutzer zwischen Timeline und Dokumenten wechseln.

## 5. Hauptfluss: Anmelden und Zugang zur gemeinsamen Reise

### 5.1 Ablauf

1. Nutzer öffnet die PWA oder Webanwendung.
2. Ohne gültige Sitzung erscheint ausschließlich die Anmeldung; Reiseinformationen werden weder kurz eingeblendet noch über Fehlermeldungen verraten.
3. Nutzer gibt die Daten des vorab eingerichteten persönlichen Kontos ein beziehungsweise folgt dem später festgelegten einfachen Anmeldeverfahren.
4. Während der Prüfung ist die Aktion eindeutig als laufend markiert und gegen Mehrfachauslösung geschützt.
5. Bei Erfolg:
   - existiert die gemeinsame Reise, führt der Weg direkt zur Timeline;
   - existiert sie noch nicht, führt der Weg zur einmaligen Reiseeinrichtung.
6. Bei ungültigen Angaben bleibt der Nutzer auf der Anmeldung und erhält einen verständlichen, nicht rein farblichen Fehler.
7. Nach dem Abmelden werden geschützte Inhalte verlassen; Zurück-Navigation darf sie nicht erneut anzeigen.

### 5.2 Einladung annehmen

Dieser Teilfluss ist im MVP nicht vorhanden. Die zweite Person meldet sich mit ihrem ebenfalls vorab eingerichteten Konto an und sieht dieselbe gemeinsame Reise. Es wird weder eine Mitgliedschaft bestätigt noch eine Rolle gewählt. Ein unbekannter Einladungslink zeigt vor oder nach der Anmeldung lediglich, dass Einladungen nicht unterstützt werden, und bietet den Weg zur Anmeldung beziehungsweise Timeline an.

### 5.3 Akzeptanzkriterien

- Beide vorab eingerichteten Personen können sich jeweils mit ihrem eigenen Konto anmelden und abmelden.
- Nach erfolgreicher Anmeldung sehen beide dieselbe aktive Reise und nach erneutem Laden denselben bestätigten Datenstand.
- Ohne gültige Anmeldung sind Reise-, Ereignis- und Dokumentdaten weder über Navigation noch über direkte Links erreichbar.
- Fehlgeschlagene Anmeldungen zeigen eine verständliche Meldung und erlauben einen erneuten Versuch, ohne Eingaben unnötig zu verlieren.
- Mehrfaches Tippen während der Anmeldung erzeugt keine parallelen Anmeldevorgänge oder widersprüchlichen Zustände.
- Der MVP bietet keine Registrierung, Einladungsannahme, Rollenwahl oder Kontowiederherstellung an.

## 6. Hauptfluss: Reise erstellen und bearbeiten

„Reise erstellen“ ist die einmalige Einrichtung der genau einen gemeinsamen Reise. Nach ihrer Anlage gibt es keinen „Neue Reise“-Einstieg; beide Personen können stattdessen dieselben Reisedaten bearbeiten.

### 6.1 Ablauf

1. Nach der Anmeldung erkennt die App, dass noch keine aktive Reise eingerichtet ist.
2. Der leere Zustand erklärt kurz, dass beide Konten diese Reise gemeinsam sehen und bearbeiten.
3. Das Formular zeigt in einer kompakten Reihenfolge:
   1. Titel,
   2. Startdatum,
   3. Enddatum.
4. Die App prüft erforderliche Felder und verhindert ein Enddatum vor dem Startdatum.
5. Bei erfolgreichem Speichern erscheint die leere Timeline der neuen Reise mit den Einstiegen „Dokument hochladen“ und „Manuell anlegen“.
6. Spätere Änderungen erfolgen über den Reisekopf. Nach dem Speichern sehen beide Personen nach erneutem Laden die aktualisierten Daten.

### 6.2 Akzeptanzkriterien

- Eine Reise kann mit Titel, Startdatum und Enddatum angelegt werden.
- Fehlende Pflichtangaben und ein Enddatum vor dem Startdatum verhindern das Speichern und werden feldnah sowie in einer zusammenfassenden Meldung erklärt.
- Eine erfolgreiche Anlage erzeugt genau eine aktive Reise und führt zu deren Timeline.
- Nach der Anlage wird keine Möglichkeit angeboten, eine zweite aktive Reise zu erstellen.
- Beide Konten können Titel und Zeitraum ändern; die Änderung bleibt nach erneutem Laden erhalten und ist für das andere Konto sichtbar.
- Wiederholtes Absenden bei langsamer Verbindung erzeugt keine zweite Reise.

## 7. Hauptfluss: Reiseereignis manuell anlegen

### 7.1 Ablauf

1. Nutzer wählt „Hinzufügen“ und anschließend „Manuell anlegen“.
2. Nutzer wählt eine der fünf Arten: Unterkunft, Flug, Bahn, Bus oder Aktivität.
3. Das Formular priorisiert oberhalb der ersten optionalen Details:
   - Ereignisart,
   - Titel,
   - Startdatum,
   - optionale Uhrzeit und deren Genauigkeit,
   - optionales Ende,
   - zentrale Orts- oder Verbindungsangaben.
4. Weitere gemeinsame und artspezifische Angaben liegen in benannten, aufklappbaren Abschnitten. Vorhandene Teilstrecken werden in ihrer Reihenfolge angezeigt; Teilstrecken lassen sich hinzufügen, bearbeiten, umordnen oder entfernen.
5. „Speichern“ prüft den Pflichtkern und vorhandene Zeitfolgen unter Berücksichtigung der fachlichen Zeitzonen.
6. Bei Fehlern bleibt der Inhalt erhalten. Fokus und Fehlermeldung führen zur ersten zu korrigierenden Stelle.
7. Bei Erfolg entsteht ein bestätigtes Ereignis und die App führt zu dessen Details oder zur sichtbaren Position in der Timeline.

### 7.2 Bearbeiten und Löschen

- „Bearbeiten“ verwendet dieselbe Feldstruktur und zeigt alle gespeicherten Werte.
- „Löschen“ ist als nachrangige, destruktive Aktion platziert und verlangt eine Bestätigung mit verständlicher Auswirkung.
- Solange die Löschregel für zugehörige Originaldokumente offen ist, darf der Dialog keine nicht festgelegte Löschwirkung versprechen.

### 7.3 Akzeptanzkriterien

- Jede der fünf unterstützten Ereignisarten kann nur mit Art, Titel und Startdatum gespeichert werden.
- Alle optionalen gemeinsamen und artspezifischen Felder sind erreichbar, speicherbar und nach erneutem Laden unverändert vorhanden.
- Flug-, Bahn- und Busereignisse können mindestens zwei Teilstrecken enthalten; deren Reihenfolge und Daten bleiben erhalten.
- Ein vorhandenes Ende vor dem Beginn oder eine eindeutig ungültige Zeitfolge innerhalb einer Teilstrecke verhindert das Speichern bis zur Korrektur.
- Datumswerte ohne Uhrzeit sind zulässig und werden als solche bewahrt, nicht als erfundene Uhrzeit dargestellt.
- Fachliche lokale Zeitzonen bleiben erhalten und werden nicht irreführend in die Gerätezeitzone umgerechnet.
- Erfolgreiches Speichern erzeugt genau ein bestätigtes Ereignis; Abbruch oder Validierungsfehler erzeugen keines.
- Beide Konten können jedes bestätigte Ereignis bearbeiten und löschen.

## 8. Hauptfluss: Dokument hochladen

### 8.1 Ablauf

1. Nutzer wählt „Hinzufügen“ und „Dokument hochladen“.
2. Die Dateiauswahl erlaubt eine oder mehrere Dateien aus den auf dem Gerät verfügbaren Quellen.
3. Vor dem Start zeigt die App Dateinamen und gegebenenfalls verständliche lokale Größen- oder Mengenlimits. Sie behauptet keine dauerhaft festgeschriebene Formatliste.
4. Jede Datei erhält einen eigenen Eintrag in der Warteschlange und durchläuft unabhängig die Zustände aus Abschnitt 9.
5. Eine vorab erkennbare Ablehnung nennt den Grund, beispielsweise nicht unterstützt, zu groß, beschädigt oder passwortgeschützt.
6. Nach erfolgreichem Upload beginnt die Verarbeitung automatisch. Die App bleibt navigierbar.
7. Bei erfolgreicher Extraktion zeigt der Eintrag Anzahl und Status der erzeugten Entwürfe und führt zu deren Kontrolle.
8. Ein Upload allein veröffentlicht kein Ereignis.

### 8.2 Akzeptanzkriterien

- Nutzer können eine oder mehrere Dateien auswählen; jede Datei besitzt einen unabhängig verständlichen Status.
- Tatsächlich unterstützte Dokument- und Bildformate können angenommen werden, ohne dass die UX eine dauerhaft feste Positivliste voraussetzt.
- Nicht unterstützte, beschädigte, passwortgeschützte oder zu große Dateien werden mit einem konkreten, handlungsorientierten Grund abgelehnt.
- Dateiname und Dateityp bleiben vor, während und nach der Verarbeitung erkennbar.
- Eine erfolgreich hochgeladene Datei startet die Extraktion und kann einen oder mehrere Entwürfe beziehungsweise Teilstrecken hervorbringen.
- Während Upload und Verarbeitung bleiben Timeline und bereits bestätigte Ereignisse bedienbar und unverändert.
- Kein Upload und kein Extraktionsergebnis erscheint ohne ausdrückliche Bestätigung als Timeline-Ereignis.
- Wiederholung oder Mehrfachauslösung erzeugt weder doppelte Dokumente noch doppelte bestätigte Ereignisse, soweit derselbe laufende Vorgang erneut ausgelöst wird.

## 9. Upload-, Verarbeitungs-, Fehler- und Wiederholungszustände

Status wird immer je Datei gezeigt. Ein Gesamtstatus darf ergänzen, aber nicht die betroffene Datei verschleiern.

| Zustand | Anzeige und Information | Verfügbare Aktionen |
| --- | --- | --- |
| Ausgewählt | Dateiname, Typ, Größe sofern bekannt; noch nicht gestartet | Entfernen, Upload starten |
| Wartet | Position oder Hinweis, dass der Start aussteht | Entfernen, soweit noch nicht begonnen |
| Wird hochgeladen | Fortschritt, wenn technisch verlässlich; sonst laufender Indikator | Im Hintergrund weiterarbeiten; gegebenenfalls abbrechen |
| Upload unterbrochen | Bereits übertragener Stand nur zeigen, wenn zuverlässig fortsetzbar; Ursache neutral benennen | Fortsetzen oder erneut versuchen |
| Upload fehlgeschlagen | Verständlicher Grund, Eingriffsmöglichkeiten | Erneut versuchen, andere Datei wählen, Eintrag entfernen |
| Wird verarbeitet | Upload abgeschlossen; Analyse kann dauern; kein Prozentwert ohne belastbare Grundlage | Im Hintergrund weiterarbeiten, Status später erneut prüfen |
| Verarbeitung fehlgeschlagen | Dokument bleibt erreichbar; Fehler verändert keine Ereignisse | Verarbeitung erneut anstoßen, manuell erfassen, Dokument öffnen |
| Nicht zuordenbar | Keine unterstützte Ereignisart sicher erkannt | Manuell erfassen, Verarbeitung erneut versuchen, Dokument öffnen |
| Entwürfe bereit | Anzahl der Entwürfe, offene Prüfungen | Jetzt kontrollieren |
| Teilweise geprüft | Anzahl bestätigter, offener und verworfener Entwürfe | Prüfung fortsetzen |
| Abgeschlossen | Alle zugehörigen Entwürfe entschieden | Ereignisse ansehen, Dokument öffnen |

### Regeln für Wiederholungen

- „Erneut versuchen“ wirkt nur auf den fehlgeschlagenen Schritt der betroffenen Datei.
- Bei unklarem Antwortausgang, etwa Verbindungsabbruch während des Bestätigens, prüft die App zuerst den Serverstand und zeigt „Speicherstatus wird geprüft“ statt sofort ein zweites Ereignis anzulegen.
- Eine Wiederholung bewahrt das Originaldokument und vorhandene Entwurfskorrekturen, soweit sie fachlich noch zum selben Verarbeitungsergebnis gehören.
- Wenn eine Wiederholung bisherige Entwürfe ersetzen würde, wird die Auswirkung vorab erklärt und bestätigt.
- Ein Fehler in einer Datei blockiert andere Dateien der Warteschlange nicht.

## 10. Hauptfluss: Erkannte Informationen kontrollieren und korrigieren

### 10.1 Entwurfsübersicht

Nach der Extraktion sieht der Nutzer zuerst:

- aus welchem Dokument die Ergebnisse stammen;
- wie viele Ereignisentwürfe erkannt wurden;
- vorgeschlagene Art, Titel und Startdatum je Entwurf;
- welche Entwürfe noch zu prüfen, bestätigt oder verworfen sind;
- ob mehrere Teilstrecken enthalten sind.

Hin- und Rückreise werden grundsätzlich als getrennte Ereignisse angeboten. Nutzer können die Anzahl der Entwürfe und die Zuordnung zusammengehörender Teilstrecken vor der Übernahme korrigieren.

### 10.2 Kontrolle eines Entwurfs

1. Nutzer öffnet einen Entwurf.
2. Oben stehen Herkunftsdokument, vorgeschlagene Ereignisart und Prüfstatus.
3. Pflichtkern und zeitlich wesentliche Angaben folgen zuerst. Unsichere Angaben sind zusätzlich mit Text oder Symbol gekennzeichnet und als prüfbar benannt; leere Felder werden nicht mit Vermutungen gefüllt.
4. Nutzer kann alle Angaben ändern, ergänzen oder entfernen, einschließlich Ereignisart, Teilstrecken und zusätzlichen Bezeichnung-Wert-Paaren.
5. Das Original ist ohne Verlust der Formulareingaben erreichbar, idealerweise in einer mobilen Wechselansicht; auf breiteren Displays kann eine parallele Ansicht verwendet werden.
6. Vor der Bestätigung validiert die App Pflichtkern und Zeitfolgen.
7. Nutzer bestätigt den Entwurf, kehrt zur Entwurfsübersicht zurück oder verwirft ihn nach Bestätigung der Auswirkung.

### 10.3 Akzeptanzkriterien

- Jeder erzeugte Entwurf ist vor der Veröffentlichung einzeln einsehbar und vollständig änderbar.
- Nutzer können Ereignisart, Anzahl der Ereignisse, Teilstrecken sowie sämtliche erkannten Felder korrigieren, ergänzen oder entfernen.
- Unsichere Angaben sind nicht allein farblich und nicht als sicher gekennzeichnet; nicht erkannte Angaben bleiben leer.
- Das Originaldokument kann während der Prüfung geöffnet werden, ohne dass bereits vorgenommene Korrekturen verloren gehen.
- Ein Dokument mit mehreren Buchungen kann mehrere getrennt prüfbare Entwürfe erzeugen.
- Pflichtfeld- und Zeitfehler verhindern die Bestätigung, nicht aber das weitere Bearbeiten oder den Zugriff auf das Original.
- Ein verworfener Entwurf erzeugt kein Timeline-Ereignis. Die Auswirkung auf das Original wird erst nach Festlegung der offenen Aufbewahrungsregel verbindlich formuliert.

## 11. Hauptfluss: Ereignis bestätigen

### 11.1 Ablauf

1. Nach abgeschlossener Prüfung wählt der Nutzer „Ereignis bestätigen“.
2. Die App validiert mindestens Ereignisart, Titel, Startdatum und alle vorhandenen Zeitfolgen.
3. Während des Speicherns bleibt die Aktion gesperrt und der Zustand wird verständlich angekündigt.
4. Bei Erfolg:
   - entsteht genau ein bestätigtes Ereignis;
   - bleibt das Original mit dem Ereignis verknüpft;
   - wird der Entwurf als bestätigt markiert;
   - erscheint das Ereignis chronologisch in der Timeline.
5. Bei einem fachlichen Fehler kehrt der Nutzer zur betreffenden Stelle zurück; bei einem technischen Fehler bleiben alle Korrekturen erhalten und die Bestätigung kann wiederholt werden.

### 11.2 Akzeptanzkriterien

- Nur eine ausdrückliche Betätigung von „Ereignis bestätigen“ veröffentlicht den geprüften Entwurf.
- Vorher erscheint der Entwurf weder in der Timeline noch als bestätigtes Ereignis für das andere Konto.
- Ungültige Pflicht- oder Zeitangaben verhindern die Bestätigung und werden konkret erklärt.
- Nach erfolgreicher Bestätigung ist das Ereignis für beide Konten nach erneutem Laden sichtbar und das Original bleibt verknüpft.
- Doppeltippen, erneutes Laden oder Wiederholen nach unklarem Verbindungsstatus erzeugt kein Duplikat.
- Ein technischer Fehler verändert keine bereits bestätigten Ereignisse und verliert keine korrigierten Entwurfsdaten.

## 12. Timeline und Ereignisdetails

### 12.1 Timeline

- Zeigt ausschließlich bestätigte Ereignisse.
- Gruppiert Ereignisse nach lokalem Reisetag und sortiert primär nach Beginn. Bei gleichem Beginn bleibt die Reihenfolge stabil und nachvollziehbar.
- Ereignisse ohne Uhrzeit erscheinen am richtigen Tag mit „ganztägig“ beziehungsweise „Uhrzeit nicht angegeben“, nicht mit einer erfundenen Standardzeit.
- Jede kompakte Ereigniskarte zeigt mindestens Art, Titel und Startdatum; vorhandene Uhrzeit, relevante Start-/Zielverbindung oder Hauptort ergänzen die Orientierung.
- Stornierte Ereignisse bleiben inhaltlich erkennbar und sind textlich als „Storniert“ bezeichnet; Status wird nicht ausschließlich farblich vermittelt.
- Ein getrennter Bereich „Zu prüfen“ kann oberhalb der Timeline auf offene Entwürfe oder laufende Verarbeitungen hinweisen, zählt aber nicht als Teil der Timeline.

### 12.2 Ereignisdetails

Die Detailansicht priorisiert:

1. Art, Titel und Buchungsstatus;
2. Beginn, Ende und fachlich relevante lokale Zeitzone;
3. Start, Ziel oder Hauptort;
4. Teilstrecken in Reise-Reihenfolge;
5. Buchungs- und Anbieterangaben;
6. Reisende, Leistungen, Preise, Bedingungen und Notizen;
7. zusätzliche Anbieterangaben;
8. zugehörige Originaldokumente;
9. nachrangige Aktionen „Bearbeiten“ und „Löschen“.

Nicht vorhandene optionale Felder werden im Lesemodus weggelassen, statt als lange Liste leerer Werte zu erscheinen.

### 12.3 Akzeptanzkriterien

- Die Timeline enthält ausschließlich bestätigte Ereignisse und sortiert sie primär chronologisch nach Beginn.
- Bei identischem Beginn bleibt die Reihenfolge nach erneutem Laden stabil.
- Jedes Ereignis zeigt mindestens Art, Titel und Startdatum; vorhandene zentrale Orts- oder Verbindungsangaben sind erkennbar.
- Ereignisse ohne genaue Uhrzeit erscheinen am richtigen Reisetag und werden nicht mit einer erfundenen Uhrzeit dargestellt.
- Alle gespeicherten Werte einschließlich Teilstrecken und Zusatzangaben sind in den Ereignisdetails erreichbar.
- Offene Entwürfe und Verarbeitungen sind klar von bestätigten Timeline-Ereignissen getrennt.
- Nach erneutem Laden sehen beide Konten denselben bestätigten Stand.

## 13. Dokumente und Dokumentansicht

### 13.1 Dokumentenübersicht

- Zeigt Originale mit Dateiname, Dateityp und aktuellem Verarbeitungsstatus.
- Macht sichtbar, ob ein Dokument mit bestätigten Ereignissen, offenen Entwürfen oder einem Fehler verbunden ist.
- Ordnet Dokumente nachvollziehbar, beispielsweise neueste Uploads zuerst; die gewählte Ordnung bleibt stabil.
- Bietet keinen öffentlichen Freigabelink.

### 13.2 Dokumentansicht

1. Nutzer öffnet ein Dokument aus der Übersicht oder aus einem Ereignis.
2. Die App zeigt eine Vorschau, wenn das Format im Browser zuverlässig darstellbar ist.
3. Unabhängig von der Vorschau bleiben Dateiname, Dateityp und „Original öffnen/herunterladen“ verfügbar.
4. Zugehörige bestätigte Ereignisse und offene Entwürfe sind als Navigation sichtbar.
5. Scheitert die Vorschau, bleibt das Original weiterhin zum Öffnen oder Herunterladen erreichbar. Scheitert auch der Abruf, zeigt die App eine handlungsorientierte Wiederholungsmöglichkeit.

### 13.3 Akzeptanzkriterien

- Beide angemeldeten Konten können jedes zugeordnete Original über das Ereignis öffnen oder herunterladen.
- Dateiname und Dateityp bleiben erkennbar.
- Eine fehlende oder fehlgeschlagene Vorschau verhindert nicht den angebotenen Abruf des Originals, sofern dieses verfügbar ist.
- Ohne gültige Anmeldung ist das Original auch über einen zuvor kopierten direkten Link nicht zugänglich.
- Dokumentfehler zeigen eine Wiederholungsmöglichkeit und verändern keine Ereignisse oder Entwürfe.
- Die UX behauptet keine endgültige Aufbewahrungs- oder Löschwirkung, bis die offenen Regeln für verworfene Entwürfe und gelöschte Ereignisse entschieden sind.

## 14. Leere Zustände, Ladezustände und Fehlerzustände

| Kontext | Leerer oder ladender Zustand | Fehler und nächster Schritt |
| --- | --- | --- |
| Reise | „Noch keine gemeinsame Reise eingerichtet“ mit kurzem Nutzenhinweis | Erneut laden; bei anhaltendem Fehler Abmelden und später erneut versuchen |
| Timeline | „Noch keine Ereignisse“ mit „Dokument hochladen“ als primärer und „Manuell anlegen“ als zweiter Aktion | Timeline erneut laden; vorhandene lokale Anzeige nicht kommentarlos leeren |
| Zu prüfen | „Keine offenen Entwürfe“ | Fehlgeschlagene Verarbeitungen separat mit Wiederholung zeigen |
| Dokumente | „Noch keine Dokumente“ mit Upload-Einstieg | Abruf erneut versuchen; bereits bekannte Dokumente nicht als gelöscht darstellen |
| Ereignisdetails | Strukturierter Platzhalter nur bei kurzer Ladezeit, danach klare Meldung | „Ereignis konnte nicht geladen werden“, erneut versuchen oder zur Timeline |
| Dokumentansicht | Vorschau wird geladen; Dateiname bleibt sichtbar | Vorschau erneut versuchen oder Original öffnen/herunterladen |
| Formulare | Beim Laden bestehender Daten keine leeren editierbaren Felder vortäuschen | Speichern erneut versuchen; Eingaben bleiben erhalten |

### Übergreifende Regeln

- Ladeindikatoren benennen möglichst die Tätigkeit: „Timeline wird geladen“, „Datei wird hochgeladen“, „Dokument wird ausgewertet“, „Ereignis wird gespeichert“.
- Nach einigen Sekunden ergänzt ein Hinweis, dass der Vorgang länger dauern kann. Es werden keine unbelegten Restzeiten oder künstlichen Prozentwerte angezeigt.
- Fehler stehen nah am betroffenen Inhalt, enthalten eine kurze Ursache soweit bekannt und mindestens einen sinnvollen nächsten Schritt.
- Validierungsfehler sind feldnah und zusätzlich am Formularanfang zusammengefasst; Links in der Zusammenfassung führen zum Feld.
- Technische Fehlermeldungen geben keine vertraulichen Inhalte, Anmeldedaten oder internen Diagnosedaten preis.
- Bereits bestätigte Inhalte verschwinden bei einem Aktualisierungsfehler nicht kommentarlos. Die App kennzeichnet, dass der gezeigte Stand möglicherweise nicht aktuell ist.

## 15. Langsame oder unterbrochene Verbindung

Der MVP setzt eine aktive Internetverbindung voraus und verspricht weder Offline-Bearbeitung noch garantierten Offline-Zugriff. Die UX verhindert dennoch vermeidbaren Datenverlust und macht den Stand transparent.

- Ein globaler, nicht blockierender Hinweis meldet „Keine Verbindung“ beziehungsweise „Verbindung wird wiederhergestellt“.
- Bereits sichtbar geladene Inhalte dürfen lesbar bleiben, werden aber mit „Stand möglicherweise nicht aktuell“ gekennzeichnet. Daraus entsteht keine Offline-Garantie.
- Netzwerkabhängige Aktionen werden bei fehlender Verbindung entweder deaktiviert und erklärt oder in einem klaren „noch nicht gesendet“-Zustand gehalten; sie dürfen nicht als gespeichert erscheinen.
- Formulareingaben bleiben beim fehlgeschlagenen Speichern auf dem Screen erhalten. Eine dauerhafte Offline-Warteschlange ist nicht erforderlich.
- Uploads zeigen Unterbrechung je Datei. Fortsetzen wird nur angeboten, wenn es technisch belastbar ist; andernfalls lautet die Aktion „Erneut hochladen“.
- Laufende Verarbeitung kann serverseitig fortgesetzt werden. Nach Wiederverbindung fragt die App den tatsächlichen Status ab, statt dieselbe Extraktion blind erneut zu starten.
- Nach einem Timeout beim Bestätigen oder Speichern prüft die App zuerst, ob die Aktion erfolgreich war. Bis dahin lautet der Status „Speicherstatus wird geprüft“.
- Anmeldung und geschützte Dokumentabrufe schlagen bei fehlender Verbindung verständlich fehl und bieten einen erneuten Versuch.

## 16. Mobile Besonderheiten für iPhone und PWA

- Alle Kernaufgaben funktionieren ab 375 CSS-Pixel Breite ohne horizontales Scrollen. Breite Tabellen oder Teilstrecken werden in gestapelten Karten beziehungsweise Abschnitten dargestellt.
- Primäre Aktionen liegen gut erreichbar und werden nicht von Safari-Bedienelementen, der Home-Anzeige oder der Bildschirmtastatur verdeckt. Safe Areas werden berücksichtigt.
- Touch-Ziele sind ausreichend groß und voneinander getrennt; kleine Icon-only-Aktionen werden vermieden oder besitzen eine eindeutige zugängliche Bezeichnung.
- Die Dateiauswahl berücksichtigt die auf iOS angebotenen Quellen wie Dateien und Fotos. Kameraaufnahme darf angeboten werden, sofern das resultierende Format tatsächlich verarbeitet werden kann.
- HEIC/HEIF wird nicht als unterstützt versprochen. Wenn ein ausgewähltes iPhone-Foto nicht verarbeitet werden kann, erklärt die App den Grund und empfiehlt eine praktische Konvertierung beziehungsweise Auswahl eines unterstützten Exports.
- Große Uploads dürfen nicht davon abhängen, dass eine installierte PWA dauerhaft im Hintergrund weiterläuft. Beim Verlassen wird der Nutzer darauf hingewiesen, wenn ein Upload dadurch unterbrochen werden könnte.
- Installation als PWA ist optional. Die Webanwendung bleibt in Safari vollständig nutzbar; Installationshinweise blockieren keinen Kernfluss.
- Statusleiste, Browser-Zurück, PWA-Standalone-Modus und Wechsel zwischen Apps führen nicht zu doppelten Aktionen oder verlorenen bestätigten Daten.
- Datums- und Zeiteingaben zeigen ein für deutschsprachige Nutzer eindeutiges Format. Die fachliche Zeitzone wird sichtbar bewahrt, auch wenn die Gerätezeitzone abweicht.
- Formulare reagieren auf die Bildschirmtastatur: aktives Feld und Fehlermeldung bleiben sichtbar, passende Eingabetastaturen werden verwendet, und Fokus springt nicht unerwartet.

## 17. Grundlegende Anforderungen an Barrierefreiheit

- Seiten, Überschriften, Bereiche, Listen und Formulare verwenden eine nachvollziehbare semantische Struktur und sinnvolle Fokusreihenfolge.
- Jedes Eingabefeld besitzt eine dauerhaft verständliche Bezeichnung. Platzhalter ersetzen keine Bezeichnung.
- Pflichtfelder, optionale Felder, Formathinweise und Zeitzonen sind textlich eindeutig beschrieben.
- Fehler, Unsicherheit, Stornierung, Fortschritt und Erfolg werden nie ausschließlich über Farbe vermittelt, sondern zusätzlich durch Text und gegebenenfalls ein verständliches Symbol.
- Text und informative Bedienelemente besitzen ausreichenden Kontrast; Vergrößerung und größere iOS-Schriftgrößen führen nicht zu abgeschnittenen Inhalten oder horizontalem Scrollen in Kernflüssen.
- Alle Funktionen sind per Tastatur bedienbar. Sichtbarer Fokus, logische Fokusführung und ein sinnvoller Fokus nach Dialogen, Fehlern und Navigation sind erforderlich.
- Statusänderungen wie Upload abgeschlossen, Verarbeitung fehlgeschlagen oder Ereignis gespeichert werden für Screenreader angemessen angekündigt, ohne laufende Fortschrittsmeldungen störend zu wiederholen.
- Dialoge besitzen einen beschreibenden Titel, halten den Fokus, sind eindeutig schließbar und geben ihn anschließend an den Auslöser zurück.
- Touch-Ziele sind ausreichend groß; Gesten besitzen eine sichtbare Alternative. Keine Kernaktion erfordert Drag-and-drop, langes Drücken oder eine komplexe Geste.
- Dokumentvorschauen erhalten einen benannten Alternativweg zum Öffnen oder Herunterladen. Die App behauptet keine Barrierefreiheit des hochgeladenen Fremddokuments.
- Bewegung und Animation sind nicht erforderlich, um Status oder Inhalt zu verstehen, und berücksichtigen reduzierte Bewegungseinstellungen.
- Zeitkritische Interaktionen werden vermieden; lange Uploads und Prüfungen laufen nicht durch eine kurze UI-Zeitüberschreitung kommentarlos aus.

## 18. Übergreifende Abnahmeszenarien

Zusätzlich zu den Kriterien der einzelnen Hauptflüsse muss der MVP folgende End-to-End-Szenarien bestehen:

1. **Kernablauf auf iPhone:** Anmeldung → PDF/Bild/Dokument auswählen → Uploadstatus verfolgen → mindestens einen Entwurf prüfen und korrigieren → ausdrücklich bestätigen → Ereignis in der Timeline öffnen → Originaldokument öffnen.
2. **Gemeinsamer Stand:** Konto A legt ein Ereignis an oder ändert es; Konto B sieht nach erneutem Laden denselben bestätigten Stand.
3. **Fehler ohne Seiteneffekt:** Ein absichtlich ausgelöster Upload-, Extraktions-, Speicher- oder Dokumentabruf-Fehler zeigt einen verständlichen nächsten Schritt und verändert oder dupliziert kein bestätigtes Ereignis.
4. **Minimale Ereignisse:** Unterkunft, Flug, Bahn, Bus und Aktivität lassen sich jeweils nur mit Art, Titel und Startdatum bestätigen, danach bearbeiten und löschen.
5. **Zeit und Teilstrecken:** Ein Verkehrsereignis mit mindestens zwei Teilstrecken bleibt nach erneutem Laden korrekt; eine eindeutig ungültige Zeitfolge verhindert die Bestätigung.
6. **Zugriffsschutz:** Nach Abmeldung sowie über direkte Ereignis- und Dokumentlinks bleiben sämtliche privaten Inhalte unzugänglich.
7. **Mobile Belastbarkeit:** Der gesamte Kernablauf funktioniert bei 375 CSS-Pixel Breite ohne horizontales Scrollen, mit sichtbaren Fokus-/Fehlerzuständen und ohne von Browserleisten oder Tastatur verdeckte Primäraktion.

## 19. Vor Implementierungsbeginn zu entscheidende UX-Punkte

Diese Punkte sind laut Produktbrief offen und beeinflussen Texte oder Detailverhalten der beschriebenen Flüsse:

1. konkretes Anmeldeverfahren für die zwei vorhandenen Konten;
2. lokale Datei- und Mengenlimits;
3. Aufbewahrung eines Originaldokuments nach Verwerfen aller Entwürfe;
4. Auswirkung des Ereignislöschens auf zugehörige Originaldokumente;
5. Auswahl oder Vorschlag der fachlichen Zeitzone bei manueller Eingabe;
6. zugelassene Extraktionssprachen neben Deutsch und Englisch;
7. Regel für die vorgeschlagene Gruppierung zusammengehörender Teilstrecken.

Bis diese Entscheidungen fallen, müssen UI-Texte neutral bleiben und dürfen insbesondere keine Löschwirkung, Formatunterstützung oder automatische Gruppierungslogik versprechen, die produktseitig noch nicht festgelegt ist.
