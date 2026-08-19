# Changelog

Alle wesentlichen Änderungen an QRPass werden hier zusammengefasst.

## 1.3.1 – Repository Cleanup

- Projektstruktur in `public/`, `src/worker/` und `docs/` gegliedert
- statische Web-Assets und Backend-Code klar getrennt
- aktiver Worker-Einstieg auf `src/worker/index.js` vereinheitlicht
- Versionsdateien aus dem Repository-Root entfernt
- Frontend-Dateien logisch nach JavaScript und CSS sortiert
- README, Architektur- und Setup-Dokumentation aktualisiert
- keine funktionale Änderung gegenüber 1.3.0

## 1.3.0 – E-Mail-Erinnerungen

- Erinnerungen für Prüfungen und Wartungen
- Vorwarnung 7 / 14 / 30 / 60 Tage
- Testmail-Funktion
- Cloudflare Cron Trigger
- Resend-Integration
- Schutz vor täglichen Wiederholungsmails

## 1.2.0 – Import & Pilotfähigkeit

- CSV-Massenimport für Betriebsmittel
- Vorschau und Fehlerprüfung vor dem Import
- Dublettenerkennung über Anlagennummern
- vorhandene Betriebsmittel werden nicht automatisch überschrieben
- CSV-Datenexport

## 1.1.x – Betriebsmittel & Prüfungen

- Betriebsmittelarten wie Maschine, Leiter, Stapler, Kran, Hebezeug und Anschlagmittel
- Prüfungen mit Prüfart, Prüfer, Ergebnis und nächstem Termin
- Fälligkeitsanzeige
- Prüfungs- und Notizeinträge durch Admin löschbar
- QR-Etikett für Betriebsmittel

## 1.0.x – Pilotbasis

- Firmenkonten und Mandantentrennung
- Admin- und Mitarbeiterrollen
- Mitarbeiter-Login per Firmen-Code + PIN
- Maschinen/Betriebsmittel, Störungen, Wartungen und Verlauf
- QR-Code-Zugriff
- Archivierung
- Impressum und Datenschutz
- PWA und Cloudflare-D1-Backend
