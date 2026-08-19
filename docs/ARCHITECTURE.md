# QRPass Architektur

## Überblick

```text
Browser / PWA
     │
     ├── statische Oberfläche aus public/
     │
     └── /api/*
           │
           ▼
    Cloudflare Worker
           │
           ├── Auth / Rollen / Mandantentrennung
           ├── Betriebsmittel / Verlauf / Prüfungen
           ├── Import / Export / Konto
           └── Erinnerungen
           │
           ▼
       Cloudflare D1

Cloudflare Cron ──► Worker scheduled() ──► Resend ──► E-Mail
```

## Frontend

Alle öffentlich ausgelieferten Dateien liegen unter `public/`.

- `public/index.html` – Einstiegspunkt
- `public/sw.js` – PWA-Service-Worker
- `public/manifest.json` – PWA-Metadaten
- `public/assets/js/` – Browserlogik
- `public/assets/css/` – Styles

Das Frontend ist bewusst ohne großes Framework aufgebaut und bleibt als HTML/CSS/JavaScript-PWA leicht auslieferbar.

## Backend

Der aktive Worker-Einstieg ist:

```text
src/worker/index.js
```

Die produktiv gewachsene Middleware-Kette liegt unter:

```text
src/worker/pipeline/
```

Sie ist derzeit absichtlich als Kette erhalten. Dadurch ändert der Repository-Cleanup keine bereits getestete Fachlogik. Die Versionshistorie des Projekts liegt zusätzlich vollständig in Git, sodass die Middleware später unabhängig konsolidiert werden kann.

## Datenhaltung

QRPass nutzt Cloudflare D1 mit einer Mandanten-ID (`tenant_id`) zur Trennung der Firmenkonten.

Zu den zentralen Bereichen gehören unter anderem:

- Firmen / Einstellungen
- Admin-Benutzer
- Mitarbeiter
- Sitzungen
- Betriebsmittel
- Verlaufseinträge
- Passwort-Reset
- E-Mail-Erinnerungseinstellungen und Versandprotokoll

Schema-Erweiterungen werden von den aktuellen Worker-Schichten additiv angelegt.

## Authentifizierung & Rollen

QRPass unterscheidet derzeit:

- `admin`
- `employee`

Admin-Zugänge verwenden E-Mail + Passwort. Mitarbeiter melden sich über Firmen-Code und persönliche PIN an. Berechtigungen werden nicht nur in der Oberfläche, sondern serverseitig im Worker geprüft.

## QR-Ablauf

Ein Betriebsmittel erhält einen Link in der Form:

```text
/#machine/<id>
```

Der daraus erzeugte QR-Code führt direkt zum jeweiligen Betriebsmittel. Falls noch keine Sitzung besteht, merkt sich die Anwendung das Ziel und öffnet es nach erfolgreicher Anmeldung erneut.

## E-Mail-Erinnerungen

Der Cron Trigger ruft an Werktagen den `scheduled()`-Handler auf. QRPass prüft aktivierte Firmen auf fällige bzw. bald fällige Prüfungen und Wartungen.

Pro Termin werden höchstens zwei Stufen protokolliert:

- Vorwarnung
- fällig / überfällig

Der Versand erfolgt optional über Resend. API-Schlüssel werden ausschließlich als Cloudflare-Secrets erwartet und gehören nicht ins Repository.

## Deployment-Grenze

`wrangler.jsonc` definiert `public/` als einziges statisches Asset-Verzeichnis. Dadurch werden Backend-Quellen aus `src/` nicht versehentlich als öffentliche Web-Dateien ausgeliefert.
