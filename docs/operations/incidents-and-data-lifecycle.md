# Incident- und Datenlebenszyklus-Runbook

**Stand:** 15. August 2026
**Aktueller Betriebsstand:** [Handoff](handoff.md)

## Prioritäten

- **P0:** fremde Reisedaten sichtbar, privilegiertes Secret öffentlich, unbestätigter Kandidat automatisch veröffentlicht.
- **P1:** Auth komplett ausgefallen, Produktionsprojekt pausiert, Dokumente ungeschützt abrufbar, Queue produziert unkontrollierte Kosten.
- **P2:** Teilfunktion ausgefallen, Realtime unterbrochen, OpenAI nicht verfügbar, PWA-Update festgefahren.

Bei P0/P1 zuerst weitere Exposition oder Kosten stoppen, dann Beweise sichern. Keine vertraulichen Dokumentinhalte, Tokens, Signed URLs, Dateinamen oder Modellantworten in Ticket, Chat oder Logs kopieren.

## Secret-Verdacht

1. Betroffenen Zugang identifizieren, ohne ihn auszugeben.
2. Zugang beim zuständigen Anbieter widerrufen/rotieren.
3. Supabase-/GitHub-Secret aktualisieren; privilegierte Werte niemals als Repository-Variable setzen.
4. Build-Artefakt und Git-Historie auf das Muster prüfen; öffentliches Artefakt ersetzen.
5. Auth-, Storage-, Function- und Provider-Logs nur nach IDs, Zeitpunkt, Größenklasse und sicheren Fehlercodes untersuchen.
6. Auswirkung, Rotationszeitpunkt und geprüfte Artefakte dokumentieren.

## Dokument-Incident

- Eine fehlgeschlagene lokale Prüfung belässt das Original in Quarantäne oder setzt es terminal auf `invalid`/`unsupported`.
- Bei terminaler Ablehnung oder einem fehlgeschlagenen Upload wird der Blob über eine private, wiederholbare Cleanup-Queue gelöscht; nur minimale Metadaten und der sichere Ablehnungsgrund verbleiben. Ein fehlgeschlagenes sofortiges Löschen bleibt als `queued`-Aufgabe erhalten und wird vom Cleanup-Worker erneut versucht. Nach 20 erfolglosen Versuchen wird die Aufgabe deterministisch `failed` und muss über den Health-Check alarmiert und kontrolliert untersucht werden; sie wird nicht automatisch wiederbelebt.
- Niemals einen Datensatz per Hand auf `available` setzen.

## Extraktions- und Kostenincident

- Neue Starts können durch Entfernen/Deaktivieren des OpenAI-Secrets oder Sperren des Function-Deployments gestoppt werden; bestehende manuelle Funktionen bleiben nutzbar.
- `processing`-Runs mit abgelaufener Lease werden vom Worker kontrolliert neu beansprucht; nicht direkt auf `succeeded` setzen.
- Providerkosten werden unmittelbar nach dem Provideraufruf im Ledger verbucht, auch wenn Antwortvalidierung oder Kandidatenspeicherung fehlschlägt.
- Vor Retry `provider_attempt_count`, Lease, Ledger und Idempotenzschlüssel prüfen.
- Bei Budgetabweichung Starts stoppen und Preis-Secrets gegen die aktuell gewählte Modellpreisversion prüfen.

## Konto, Sitzung und Zugriff

- Konto deaktivieren: `public.users.account_status = 'disabled'` kontrolliert administrativ ändern und alle Auth-Sitzungen widerrufen. Das ist kein PWA- oder Client-RPC-Flow.
- MFA-/Kontowiederherstellung verlangt frische Identitätsprüfung außerhalb der PWA.
- Der zweite Nutzer darf nicht über `user_metadata`, Client-RPCs oder direkte Tabellenwrites ersetzt werden.
- Gesamtexport oder Kontolöschung ist kein normaler PWA-Flow. Vor Durchführung Umfang, zweite betroffene Person, Dokument-/Providerdaten und Backupfolgen schriftlich freigeben.

## Aufbewahrung und Löschung

- Originale liegen ausschließlich im privaten Bucket `travel-documents`; Quarantäneobjekte sind nicht für Browser-SELECT freigegeben.
- Fachlich gelöschte TravelItems bleiben als Tombstone/Revisionsnachweis erhalten und erscheinen nicht in der normalen Timeline.
- Kandidaten werden nie automatisch veröffentlicht. Verwerfen löscht nicht stillschweigend das Original.
- Eine gesonderte Nutzerfunktion zur vollständigen Dokument-/Kontolöschung bleibt bis zur fachlichen Entscheidung gesperrt. Eine solche Löschung muss DB, Storage, Sessions, Kandidaten/Verknüpfungen und Providerreste als eine überprüfbare Operation behandeln.
- Backups dürfen nicht als primärer Löschmechanismus dienen. Restore-Proben müssen in einer isolierten Umgebung mit synthetischen Daten erfolgen; niemals Produktion testweise überschreiben.

## Abschluss eines Incidents

- Ursache und betroffene Zeitspanne geklärt.
- Betroffene IDs/Anzahl statt Inhalte dokumentiert.
- Secrets/Sitzungen rotiert oder widerrufen.
- Reproduzierbarer Negativtest ergänzt.
- Deployment- und Recovery-Schritt einmal nachweisbar ausgeführt.
- Offene Datenschutz-/Benachrichtigungspflichten von einer verantwortlichen Person bewertet.
