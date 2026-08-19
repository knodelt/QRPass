# QRPass Setup

## Voraussetzungen

- Cloudflare Workers
- Cloudflare D1
- optional Resend für E-Mails

## D1

Der Worker erwartet eine D1-Bindung mit dem Namen:

```text
DB
```

Die konkrete Datenbank wird im Cloudflare-Projekt mit dieser Bindung verbunden.

## Deployment

```bash
npx wrangler deploy
```

Cloudflare verwendet dabei:

- Worker: `src/worker/index.js`
- statische Assets: `public/`
- API-Routen: `/api/*`

## E-Mail-Versand

Für Passwort-Zurücksetzung und E-Mail-Erinnerungen kann Resend verwendet werden.

Cloudflare-Secrets / Variablen:

```text
RESEND_API_KEY
RESET_FROM_EMAIL
REMINDER_FROM_EMAIL
APP_URL
```

`RESEND_API_KEY` muss als Secret gespeichert werden und darf niemals in Git committed werden.

Beispiel für einen Absender nach verifizierter Domain:

```text
QRPass <erinnerung@example.de>
```

Ohne eingerichteten Mailversand bleibt QRPass grundsätzlich nutzbar; die betreffenden Mailfunktionen werden lediglich nicht aktiviert.

## Cron

Die automatische Erinnerungsprüfung ist in `wrangler.jsonc` konfiguriert:

```text
30 6 * * 1-5
```

Das entspricht einer Ausführung an Werktagen um 06:30 UTC.

## Lokale Entwicklung

Falls Wrangler lokal verfügbar ist:

```bash
npx wrangler dev
```

Für produktive Daten sollte weiterhin die konfigurierte Cloudflare-Umgebung verwendet werden.

## Sicherheit

- keine API-Keys in Quellcode oder README eintragen
- keine Produktionsdaten in Testdateien committen
- Admin-/Mitarbeiterrechte werden serverseitig geprüft
- vor strukturellen Änderungen an der Worker-Pipeline immer den aktuellen produktiven Stand sichern
