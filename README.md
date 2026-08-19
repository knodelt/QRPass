# QRPass

**Einfaches digitales Betriebsmittelbuch per QR-Code für kleine und mittlere Betriebe.**

QRPass verbindet jedes Betriebsmittel mit einem eigenen QR-Code. Mitarbeiter scannen den Code mit Smartphone oder Tablet und landen direkt beim richtigen Datensatz – ohne spezielle Scanner-Hardware und ohne sich durch ein großes ERP-System zu klicken.

> **QR scannen → Betriebsmittel öffnen → Störung, Wartung oder Prüfung erfassen → Verlauf bleibt nachvollziehbar.**

## Aktueller Stand

**Version 1.3 – Pilotversion**

QRPass ist als funktionierende Web-App/PWA mit Cloudflare Workers und D1 aufgebaut. Die Daten liegen zentral in der Datenbank und nicht nur auf einem einzelnen Endgerät.

## Funktionen

### Betriebsmittel

Unterstützte Betriebsmittelarten:

- Maschinen
- prüfpflichtige Anlagen
- Leitern und Tritte
- Stapler / Flurförderzeuge
- Kräne
- Hebezeuge
- Anschlagmittel
- sonstige Betriebsmittel

Je Betriebsmittel können unter anderem Anlagennummer, Bereich, Hersteller, Modell, Seriennummer, Wartungsdaten, Prüfdaten und Notizen hinterlegt werden.

### QR-Codes

- eigener QR-Code je Betriebsmittel
- direkter Aufruf des richtigen Datensatzes nach dem Scan
- druckbares QR-Etikett
- Firmenlogo auf dem Etikett möglich
- kein spezieller QR-Scanner notwendig

### Störungen

- Störung direkt am Betriebsmittel melden
- offene Störungen anzeigen
- Störung als erledigt markieren
- nachvollziehbar, wer gemeldet bzw. erledigt hat
- Admin kann Verlaufseinträge nach Bestätigung löschen

### Wartungen

- Wartung dokumentieren
- Wartungsintervall hinterlegen
- letzte und nächste Wartung sichtbar
- fällige Wartungen in der Übersicht
- Eintrag mit Benutzerzuordnung im Verlauf

### Prüfungen

- Prüfungen je Betriebsmittel aktivierbar
- Prüfart
- Prüfdatum
- Prüfer / befähigte Person
- Ergebnis: ohne Mangel / Mangel / außer Betrieb
- nächster Prüftermin
- Prüfintervall
- fällige und überfällige Prüfungen in der Übersicht

QRPass gibt bewusst **keine gesetzlichen Prüffristen vor**. Die jeweilige Firma hinterlegt die für sie festgelegten Prüffristen selbst.

### Verlauf & Nachvollziehbarkeit

Störungen, Wartungen, Prüfungen und Notizen werden chronologisch am Betriebsmittel gespeichert. QRPass speichert zusätzlich, welcher angemeldete Benutzer einen Eintrag erstellt oder eine Störung erledigt hat.

### Rollen & Anmeldung

**Admin**

- Firmenkonto verwalten
- Betriebsmittel anlegen und bearbeiten
- Mitarbeiter verwalten
- Betriebsmittel archivieren / wiederherstellen / endgültig löschen
- Verlaufseinträge löschen
- Daten importieren und exportieren
- E-Mail-Erinnerungen konfigurieren

**Mitarbeiter**

- Anmeldung mit Firmen-Code + persönlicher PIN
- Betriebsmittel anzeigen
- Störungen melden und erledigen
- Wartungen und Prüfungen eintragen
- Notizen hinzufügen

### Archiv

Betriebsmittel können archiviert werden, ohne den bisherigen Verlauf zu verlieren. Erst eine separate, bestätigte Admin-Aktion löscht ein archiviertes Betriebsmittel dauerhaft.

### CSV-Import & Export

QRPass unterstützt den Massenimport von Betriebsmitteln per CSV.

Der Import läuft zweistufig:

1. CSV auswählen
2. Vorschau und Fehlerprüfung
3. Import ausdrücklich bestätigen

Vorhandene Betriebsmittel werden nicht automatisch überschrieben. Doppelte Anlagennummern werden erkannt und übersprungen.

Zusätzlich kann der Admin die Firmendaten als CSV exportieren, damit die Daten nicht ausschließlich in QRPass eingeschlossen sind.

### E-Mail-Erinnerungen

QRPass 1.3 kann automatisch an anstehende und fällige **Prüfungen und Wartungen** erinnern.

- Empfänger frei wählbar
- Vorwarnung 7 / 14 / 30 / 60 Tage
- Prüfungen und Wartungen getrennt aktivierbar
- Testmail-Funktion
- mehrere Termine werden in einer Mail zusammengefasst
- keine tägliche Wiederholungs-Mail
- pro Termin maximal eine Vorwarnung und eine Erinnerung bei Fälligkeit

Die automatische Prüfung läuft über einen Cloudflare Cron Trigger. Für den Versand wird optional **Resend** verwendet.

## Firmenanpassung

Ein Firmen-Admin kann QRPass an den eigenen Betrieb anpassen:

- Firmenname
- Firmenlogo
- Akzentfarbe
- Headerfarbe
- Hintergrundfarbe

## Technik

- HTML / CSS / JavaScript
- Progressive Web App (PWA)
- Cloudflare Workers
- Cloudflare D1
- serverseitige Mandantentrennung
- rollenbasierte Berechtigungsprüfung
- sichere HttpOnly-Session-Cookies
- Passwort-/PIN-Verifier statt Klartext-Zugangsdaten in der QRPass-Datenbank
- Resend optional für E-Mail-Versand

Der aktive Worker-Einstieg ist `worker-v13.js`.

## Deployment

Das Projekt ist für Cloudflare Workers mit statischen Assets ausgelegt.

```bash
npx wrangler deploy
```

Benötigt wird eine D1-Bindung mit dem Namen:

```text
DB
```

Die nötigen Tabellen bzw. zusätzlichen Spalten werden von den aktuellen Worker-Versionen beim ersten Zugriff additiv angelegt.

### Optional: E-Mail-Versand

Für Passwort-Reset bzw. automatische Erinnerungen können folgende Cloudflare-Secrets/Variablen gesetzt werden:

```text
RESEND_API_KEY
RESET_FROM_EMAIL
REMINDER_FROM_EMAIL
APP_URL
```

**Keine API-Keys oder andere Secrets in das Repository committen.**

## Produktidee

QRPass soll bewusst **kein vollständiges ERP, CMMS oder Warenwirtschaftssystem ersetzen**.

Die Zielgruppe sind Betriebe, die für ihre Betriebsmittel heute beispielsweise Excel, Papierlisten oder Ordner verwenden und eine kleine, leicht verständliche digitale Lösung direkt am Betriebsmittel suchen.

Der Schwerpunkt liegt auf einem möglichst kurzen Ablauf vor Ort:

**QR-Code scannen → richtigen Datensatz sehen → Aktion erfassen → fertig.**

## Pilotstatus

QRPass befindet sich aktuell in der Pilotphase. Der technische Kern funktioniert, der nächste wichtige Schritt ist der Einsatz mit realen Betrieben und das Sammeln von Rückmeldungen aus der Praxis.

Feedback zu Bedienung, fehlenden Kernfunktionen, Datenschutz/IT-Anforderungen und Integrationsbedarf ist ausdrücklich willkommen.

## Kontakt

**QRPass / Games‘nMore@Volme**  
E-Mail: `Qrpass@outlook.de`
