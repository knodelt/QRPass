# QRPass

QRPass ist ein bewusst einfaches digitales Maschinenbuch.

## Version 0.1

Enthalten:

- Maschinen anlegen und bearbeiten
- Dashboard mit offenen Störungen und fälligen Wartungen
- Suche nach Maschine, Anlagennummer und Bereich
- Störungen melden und als erledigt markieren
- Wartungen dokumentieren
- Freie Notizen im Maschinenverlauf
- QR-Code je Maschine erzeugen und drucken
- Direkter Aufruf einer Maschine über den QR-Link
- Responsive Oberfläche für Smartphone und Desktop
- PWA-Grundlage / Offline-App-Shell

## Wichtige Grenze von 0.1

Die Maschinendaten liegen aktuell im lokalen Browser-Speicher. Damit ist 0.1 eine funktionale Testversion für Oberfläche und Ablauf, aber noch kein Mehrbenutzer-Produkt.

Für 0.2 ist eine gemeinsame Cloudflare-D1-Datenbank vorgesehen. Dadurch können QR-Codes von beliebigen Firmenhandys geöffnet werden und alle sehen denselben Maschinenstand.

## Ziel

Kein komplettes CMMS und kein SAP-Ersatz. QRPass soll genau einen Ablauf extrem einfach machen:

**QR scannen → Maschine sehen → Störung/Wartung dokumentieren → fertig.**
