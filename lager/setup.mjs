// Lädt die einzige externe Bibliothek (ZXing, Kamera-Scanner) in den Ordner lib/.
// Aufruf:  node setup.mjs        (benötigt Node.js ab Version 18 und Internet – nur einmalig)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const FILES = [{
  target: "lib/zxing.min.js", must: "MultiFormatReader", minBytes: 100000,
  urls: ["https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js", "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js"],
}];

let failed = false;
for (const f of FILES) {
  let done = false;
  for (const url of f.urls) {
    try {
      process.stdout.write(`Lade ${url} ... `);
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (text.length < f.minBytes || !text.includes(f.must)) throw new Error("Datei sieht nicht korrekt aus");
      await mkdir(dirname(join(root, f.target)), { recursive: true });
      await writeFile(join(root, f.target), text);
      console.log(`OK (${Math.round(text.length / 1024)} KB) -> ${f.target}`);
      done = true; break;
    } catch (e) { console.log("Fehler: " + e.message); }
  }
  if (!done) { failed = true; console.error(`\nKonnte ${f.target} nicht laden. Internetverbindung prüfen und erneut versuchen.`); }
}
if (failed) process.exit(1);
console.log("\nFertig. Der Ordner kann jetzt veröffentlicht werden (siehe ANLEITUNG.md).");
