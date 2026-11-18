# Lagererfassung – Anleitung zum Einbinden

Die App ist eine Web-App (PWA). Sie läuft nach dem Veröffentlichen komplett auf dem iPhone, ohne Server und ohne Cloud. Veröffentlichen heißt nur: Die Dateien liegen einmal auf einer kostenlosen Webadresse (HTTPS), damit Safari die Kamera erlauben kann.

Es fehlt genau **eine** Datei, die ich in meiner Umgebung nicht herunterladen konnte: die Scanner-Bibliothek `zxing.min.js`. Das Skript `setup.mjs` holt sie. Excel, PDF, Datenbank und Strichcodes sind selbst geschrieben und brauchen nichts weiter.

---

## Weg A (empfohlen): GitHub Pages – alles im Browser, nichts installieren

Kostenlos, mit HTTPS. Die Scanner-Bibliothek lädt GitHub beim Veröffentlichen automatisch selbst herunter.

1. **Konto anlegen** auf https://github.com (kostenlos).
2. **Neues Repository** anlegen (Plus-Symbol oben rechts → *New repository*): Name `lager`, Sichtbarkeit **Public** (bei kostenlosen Konten nötig für Pages). Mit *Create repository* bestätigen.
3. **Dateien hochladen:** Zip entpacken. Im Repository auf *uploading an existing file* klicken und den **Inhalt** des Ordners hineinziehen (`index.html`, `style.css`, `manifest.webmanifest`, `sw.js`, `setup.mjs`, die Ordner `js`, `icons`, `lib`, `tests`). Dann *Commit changes*.
4. **Workflow-Datei anlegen.** Der Ordner `.github` ist auf Mac/Windows versteckt und wird beim Ziehen oft vergessen. Deshalb: *Add file → Create new file*, im Namensfeld exakt `.github/workflows/pages.yml` tippen (die Schrägstriche erzeugen die Ordner) und den Text aus dem **Anhang** unten einfügen. *Commit changes*.
5. **Pages einschalten:** *Settings → Pages → Build and deployment → Source:* **GitHub Actions** wählen.
6. **Veröffentlichung starten:** Reiter *Actions* öffnen. Läuft dort noch nichts, den Workflow „App veröffentlichen“ wählen und *Run workflow* klicken. Nach 1 bis 2 Minuten erscheint ein grüner Haken.
7. **Adresse:** `https://DEIN-NAME.github.io/lager/` (steht auch unter *Settings → Pages*).

## Weg B: Netlify Drop – Ordner einfach ziehen (mit PC/Mac)

1. **Node.js installieren** (einmalig): https://nodejs.org → LTS-Version.
2. Im entpackten Ordner ein Terminal öffnen (Windows: im Ordner `cmd` in die Adressleiste tippen; Mac: Rechtsklick auf Ordner → *Neues Terminal beim Ordner*) und ausführen:
   ```
   node setup.mjs
   ```
   Erfolgreich, wenn `OK ... -> lib/zxing.min.js` erscheint.
3. https://app.netlify.com/drop öffnen, **den ganzen Ordner** hineinziehen. Danach ein kostenloses Netlify-Konto anlegen und die Seite damit verbinden. Ohne Konto ist die Seite nach Netlifys Angaben nur vorübergehend online.
4. Netlify zeigt die Adresse an (`https://irgendwas.netlify.app`).

---

## Installation auf dem iPhone

1. **In Safari** (nicht in einem anderen Browser) die Adresse öffnen.
2. *Teilen* (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → *Hinzufügen*.
3. **Wichtig:** Die App vom Home-Bildschirm starten und die **Produkte dort importieren**. Safari und die installierte App haben auf iOS getrennte Datenspeicher. Wer erst in Safari arbeitet und dann installiert, startet mit leeren Daten.
4. Beim ersten Kamerastart *Erlauben* wählen.
5. **Offline-Test:** App einmal online öffnen und kurz warten. Dann Flugmodus an und die App neu starten. Sie muss normal starten und Erfassungen erlauben.

## Bedienung in Kürze

- **Produkte:** Reiter *Import* → Excel (XLSX) mit den Spalten `Barcode, Produktname, Kategorie, Variante` wählen. Enthält die Datei Fehler (doppelte oder leere Barcodes), wird nichts importiert. Zuerst die Datei korrigieren. Excel speichert Barcodes mit führenden Nullen nur dann richtig, wenn die Spalte als **Text** formatiert ist.
- **Befehlsblatt:** *Mehr → PDF erzeugen*, dann im Teilen-Menü *Drucken*. Es enthält 13 Code-128-Strichcodes (Mengen 1, 5, 10, 15, 20, 24, 30, 35 sowie Bestätigen, Abbruch, Start, Unterbrechen, Abschließen). Vorgabe: Strichbreite 0,21 mm, Höhe 7,3 mm. **Schlecht lesbar?** Strichbreite auf 0,30 mm stellen und neu drucken. Das ist der häufigste Grund für schwaches Scannen.
- **Scannen:** Kamera 12 bis 20 cm vom Code halten, Code quer ins Bild. Dieselbe Menge zweimal zählt erst, wenn der Code kurz aus dem Bild war.
- **Excel-Export:** Nach *Abschließen* erscheint die Frage nach dem Export. Später jederzeit unter *Export*. Speichern über das Teilen-Menü → *In Dateien sichern*.
- **Datensicherung (bitte wöchentlich):** *Mehr → Sicherung erstellen* und die Datei in „Dateien“ ablegen. Wiederherstellen ebenfalls unter *Mehr*. Die App erinnert nach 7 Tagen.

## Aktualisieren

Geänderte Dateien im Repository ersetzen (Weg A: *Add file → Upload files*, Workflow läuft automatisch). Bei Weg B den Ordner erneut auf Netlify ziehen. Die App aktualisiert sich im Hintergrund. Nach zweimaligem Schließen und Öffnen ist die neue Version aktiv. Ändert man Programmdateien, in `sw.js` die Zeile `const V = "lager-v2";` auf `lager-v3` erhöhen.

## Wenn etwas nicht geht

| Problem | Lösung |
|---|---|
| „Scanner-Bibliothek FEHLT“ (unter *Mehr*) | `lib/zxing.min.js` fehlt. Weg A: *Actions*-Lauf prüfen und neu starten. Weg B: `node setup.mjs` ausführen und neu hochladen. |
| Kamera startet nicht | iPhone: *Einstellungen → Safari → Kamera* auf „Fragen“ oder „Erlauben“. Adresse muss mit `https://` beginnen. |
| Kein Ton | Stummschalter am iPhone prüfen, in der App unter *Mehr* „Testton“. Die Anzeige funktioniert auch ohne Ton. |
| Daten weg | Safari kann Daten löschen. Unter *Mehr → Sicherung wiederherstellen* die letzte Sicherung einspielen. |
| Alte Version bleibt | App komplett schließen (nach oben wischen) und zweimal neu öffnen. |

## Tests auf dem iPhone (kann ich nicht für Sie ausführen)

Bitte nach der Installation prüfen (entspricht den Tests 15, 18, 19, 20 der Spezifikation):

1. PDF-Befehlsblatt erzeugen, ausdrucken, **alle 13 Codes** einzeln scannen (Menge erscheint, Befehle wirken).
2. Produktbarcode scannen und Mengencodes 10 + 10 + 5 scannen, bestätigen: Summe 25.
3. Flugmodus an, App vom Home-Bildschirm starten, erfassen, bestätigen.
4. App während einer bestätigten Buchung schließen und neu öffnen: Buchung ist da, eine offene Menge wurde verworfen und es erscheint ein Hinweis.

## Automatisch getestet (in meiner Umgebung)

- 39 Logiktests (Spezifikationstests 1–14, 16, 17 und alle Fehlerregeln): `node tests/test.mjs`
- Scan-Sperre: `node tests/scanner-test.mjs`
- Echter Browser (Chromium): Import, Erfassung, Unterbrechen, Fortsetzen, Neuladen mit offener Menge, Abschluss, Excel-/PDF-/Sicherungs-Export, Service Worker
- Alle 13 Strichcodes im gerenderten PDF unabhängig ausgelesen und mit der Code-128-Norm verglichen
- Excel-Dateien in beide Richtungen mit openpyxl gegengeprüft

**Nicht prüfbar ohne iPhone:** das tatsächliche Lesen mit der iPhone-Kamera (ZXing-Bibliothek fehlte in meiner Umgebung) und das Verhalten von Safari beim Offline-Start und bei der Home-Bildschirm-Installation.

---

## Anhang: Inhalt für `.github/workflows/pages.yml`

```yaml
name: App veröffentlichen
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node setup.mjs
      - run: mkdir _site && cp -r index.html style.css manifest.webmanifest sw.js js lib icons _site/
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deployment
        uses: actions/deploy-pages@v4
```
