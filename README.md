# QRPass

**Einfaches digitales Betriebsmittelbuch per QR-Code für kleine und mittlere Betriebe.**

QRPass verbindet jedes Betriebsmittel mit einem eigenen QR-Code. Mitarbeiter scannen den Code mit Smartphone oder Tablet und landen direkt beim richtigen Datensatz – ohne spezielle Scanner-Hardware und ohne sich durch ein großes ERP-System zu klicken.

> **QR scannen → Betriebsmittel öffnen → Störung, Wartung oder Prüfung erfassen → Verlauf bleibt nachvollziehbar.**

## Aktueller Stand

**Version 1.3.1 – Pilotversion / Code-Cleanup**

QRPass ist eine funktionierende Web-App/PWA auf Basis von Cloudflare Workers und D1. Die Daten liegen zentral in der Datenbank und nicht auf einem einzelnen Endgerät.

Version 1.3.1 enthält keine neue Produktfunktion, sondern ordnet die Projektstruktur für einen klareren und professionelleren Entwicklungsstand.

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
- keine spezielle Scanner-Hardware erforderlich

### Störungen, Wartungen und Prüfungen

- Störungen direkt am Betriebsmittel melden und erledigen
- Wartungen mit Intervall und Verlauf dokumentieren
- Prüfungen mit Prüfart, Datum, Prüfer, Ergebnis und nächstem Prüftermin erfassen
- fällige und überfällige Termine in der Übersicht
- nachvollziehbar, welcher angemeldete Benutzer einen Eintrag erstellt oder erledigt hat
- Admin kann Verlaufseinträge nach Bestätigung löschen

QRPass gibt bewusst **keine gesetzlichen Prüffristen vor**. Die jeweilige Firma hinterlegt die für sie festgelegten Prüffristen selbst.

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

### CSV-Import & Export

Der Betriebsmittel-Import läuft zweistufig:

1. CSV auswählen
2. Vorschau und Fehlerprüfung
3. Import ausdrücklich bestätigen

Vorhandene Betriebsmittel werden nicht automatisch überschrieben. Doppelte Anlagennummern werden erkannt und übersprungen.

Der Admin kann die Firmendaten außerdem als CSV exportieren, damit die Daten nicht ausschließlich in QRPass eingeschlossen sind.

### E-Mail-Erinnerungen

QRPass kann automatisch an anstehende und fällige **Prüfungen und Wartungen** erinnern.

- Empfänger frei wählbar
- Vorwarnung 7 / 14 / 30 / 60 Tage
- Prüfungen und Wartungen getrennt aktivierbar
- Testmail-Funktion
- mehrere Termine werden in einer Mail zusammengefasst
- keine tägliche Wiederholungs-Mail
- pro Termin maximal eine Vorwarnung und eine Erinnerung bei Fälligkeit

Die automatische Prüfung läuft über einen Cloudflare Cron Trigger. Für den Versand wird optional **Resend** verwendet.

## Technik

- HTML / CSS / JavaScript
- Progressive Web App (PWA)
- Cloudflare Workers
- Cloudflare D1
- serverseitige Mandantentrennung
- rollenbasierte Berechtigungsprüfung
- HttpOnly-Session-Cookies
- Passwort-/PIN-Verifier statt Klartext-Zugangsdaten in der QRPass-Datenbank
- Resend optional für E-Mail-Versand

## Projektstruktur

```text
QRPass/
├── README.md
├── CHANGELOG.md
├── wrangler.jsonc
├── docs/
│   ├── ARCHITECTURE.md
│   └── SETUP.md
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   └── assets/
│       ├── css/
│       └── js/
└── src/
    └── worker/
        ├── index.js
        └── pipeline/
```

`public/` enthält ausschließlich Dateien, die als statische Web-Assets ausgeliefert werden. Backend-Code liegt getrennt unter `src/worker/`.

Der aktive Cloudflare-Worker-Einstieg ist:

```text
src/worker/index.js
```

Die bestehende Worker-Middleware-Kette liegt vorerst unter `src/worker/pipeline/`. Sie wurde beim Cleanup absichtlich nicht funktional neu geschrieben, damit die produktiv getesteten Abläufe unverändert bleiben. Eine spätere interne Konsolidierung kann unabhängig davon erfolgen.

Mehr Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Deployment

```bash
npx wrangler deploy
```

Benötigt wird eine Cloudflare-D1-Bindung mit dem Namen:

```text
DB
```

### Optional: E-Mail-Versand

Für Passwort-Reset bzw. automatische Erinnerungen können folgende Cloudflare-Secrets/Variablen gesetzt werden:

```text
RESEND_API_KEY
RESET_FROM_EMAIL
REMINDER_FROM_EMAIL
APP_URL
```

**Keine API-Keys oder andere Secrets in das Repository committen.**

Eine kurze Einrichtungshilfe steht in [`docs/SETUP.md`](docs/SETUP.md).

## Produktidee

QRPass soll bewusst **kein vollständiges ERP, CMMS oder Warenwirtschaftssystem ersetzen**.

Die Zielgruppe sind Betriebe, die für ihre Betriebsmittel heute beispielsweise Excel, Papierlisten oder Ordner verwenden und eine kleine, leicht verständliche digitale Lösung direkt am Betriebsmittel suchen.

Der Schwerpunkt liegt auf einem möglichst kurzen Ablauf vor Ort:

**QR-Code scannen → richtigen Datensatz sehen → Aktion erfassen → fertig.**

## Pilotstatus

QRPass befindet sich aktuell in der Pilotphase. Der technische Kern funktioniert; der wichtigste nächste Schritt ist der Einsatz mit realen Betrieben und Rückmeldung aus der Praxis.

Feedback zu Bedienung, fehlenden Kernfunktionen, Datenschutz/IT-Anforderungen und Integrationsbedarf ist willkommen.

## Kontakt

**QRPass / Games‘nMore@Volme**  
E-Mail: `Qrpass@outlook.de`
