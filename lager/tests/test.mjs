// Ausführen: node tests/test.mjs
import { MemDb } from "../js/db.js";
import { Engine } from "../js/engine.js";
import { analyzeImport } from "../js/products.js";
import { buildXlsx, readXlsx } from "../js/xlsx.js";
let pass = 0, fail = 0;
const t = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "OK    " : "FEHLER"), name, ok ? "" : extra); };
const db = new MemDb(), e = new Engine(db);
await e.init();

// 1-3 Import
let map = new Map((await db.getAllProducts()).map((p) => [p.barcode, p]));
let a = analyzeImport([["Variante", "Barcode", "Kategorie", "Produktname"], ["500 ml", "111", "Getränke", "Wasser"], ["rot", "222", "Büro", "Stift"]], map);
t("1 Import neue Produkte", a.counts.neu === 2 && !a.errors.length);
await db.importProducts(a.items);
map = new Map((await db.getAllProducts()).map((p) => [p.barcode, p]));
a = analyzeImport([["Barcode", "Produktname", "Kategorie", "Variante"], ["111", "Wasser", "Getränke", "500 ml"], ["222", "Stift NEU", "Büro", "rot"], ["333", "Heft", "Büro", "A4"]], map);
t("2 Import vorhandene/neue gemischt", a.counts.unveraendert === 1 && a.counts.aktualisiert === 1 && a.counts.neu === 1);
await db.importProducts(a.items);
t("3 Update über Barcode", (await db.getProduct("222")).name === "Stift NEU" && (await db.getAllProducts()).length === 3);
const bad = analyzeImport([["Barcode", "Produktname", "Kategorie", "Variante"], ["1", "a", "b", "c"], ["1", "x", "y", "z"], ["", "n", "", ""], ["INVENTORY_QTY_1", "x", "", ""]], map);
t("  Fehler erkannt (doppelt, leer, reserviert) → Import blockiert", bad.errors.length === 3, JSON.stringify(bad.errors));
t("  fehlende Spalte → fataler Fehler", !!analyzeImport([["Barcode", "Name"], ["1", "x"]], map).fatal);

// Regeln ohne Erfassung
t("  Mengenbefehl ohne Erfassung abgelehnt", !(await e.handleCode("INVENTORY_QTY_10")).ok && e.state === "none");
t("  Produkt ohne Erfassung abgelehnt", !(await e.handleCode("111")).ok);
t("  Start erzeugt Erfassung", (await e.handleCode("INVENTORY_START")).ok && e.state === "expect_product" && e.erf.id === 1);
t("  zweiter Start erzeugt keine zweite Erfassung", !(await e.handleCode("INVENTORY_START")).ok && (await db.getAllErfassungen()).length === 1);
t("  Mengenbefehl ohne Produkt abgelehnt", !(await e.handleCode("INVENTORY_QTY_5")).ok);
t("  Bestätigen ohne Produkt abgelehnt", !(await e.handleCode("INVENTORY_CONFIRM")).ok);
t("  Unbekannter Befehlscode nie als Menge/Produkt", !(await e.handleCode("INVENTORY_QTY_99")).ok && !(await e.handleCode("INVENTORY_FOO")).unknown);
t("  Abbruch ohne offene Menge = Fehler", !(await e.handleCode("INVENTORY_CANCEL")).ok);

// 4 + 5
await e.handleCode("111"); t("  Produkt erkannt", e.state === "product");
t("  Bestätigen mit Menge 0 abgelehnt", !(await e.handleCode("INVENTORY_CONFIRM")).ok);
await e.handleCode("INVENTORY_QTY_10"); await e.handleCode("INVENTORY_QTY_10"); await e.handleCode("INVENTORY_QTY_5");
t("  vorläufige Summe 25, Zustand 'qty'", e.qty === 25 && e.state === "qty");
t("  Neuer Barcode bei offener Menge wird NICHT stillschweigend ersetzt", !(await e.handleCode("222")).ok && e.product.barcode === "111" && e.qty === 25);
t("  Abschließen bei offener Menge abgelehnt", !(await e.handleCode("INVENTORY_FINISH")).ok);
t("  vor Bestätigung noch nichts im Bestand", (await db.getBestand(1)).length === 0);
await e.handleCode("INVENTORY_CONFIRM");
t("4 10+10+5 = 25 gebucht", (await db.getBestand(1))[0].gesamt === 25 && e.qty === 0 && e.state === "confirmed");
await e.handleCode("111"); await e.handleCode("INVENTORY_QTY_10"); await e.handleCode("INVENTORY_CONFIRM");
t("5 gleiches Produkt +10 → 35, nur eine Zeile", (await db.getBestand(1)).length === 1 && (await db.getBestand(1))[0].gesamt === 35);
t("  letzte Buchungen: 2 Einträge, neueste zuerst", e.recent.length === 2 && e.recent[0].menge === 10 && e.recent[1].menge === 25);

// 6
await e.handleCode("222"); await e.handleCode("INVENTORY_QTY_20"); await e.handleCode("INVENTORY_CANCEL");
t("6 Abbruch: Menge nicht gebucht, Produkt bleibt gewählt", e.qty === 0 && e.product && (await db.getBestand(1)).length === 1);
// 11 manuell
await e.addQty(47); await e.handleCode("INVENTORY_QTY_1");
t("11/12 manuelle 47 + gescannte 1 kombinierbar = 48", e.qty === 48);
// 8 pause mit offener Menge
const pr = await e.handleCode("INVENTORY_PAUSE");
t("8 Unterbrechen verwirft offene Menge", pr.ok && e.state === "paused" && e.qty === 0 && (await db.getBestand(1)).length === 1);
t("  Scan während unterbrochen abgelehnt", !(await e.handleCode("111")).ok);
// 7/9 fortsetzen
const rs = await e.handleCode("INVENTORY_START");
t("7/9 Fortsetzen: gleiche Nr. 1, bestätigte Menge erhalten", rs.ok && e.erf.id === 1 && (await db.getAllErfassungen()).length === 1 && (await db.getBestand(1)).find((b) => b.barcode === "111").gesamt === 35);

// 10 unbekannter Barcode
const u = await e.handleCode("999");
t("10 unbekannter Barcode meldet 'unknown'", !u.ok && u.unknown === "999");
await db.putProduct({ barcode: "999", name: "Neu", kategorie: "", variante: "" });
t("10 angelegtes Produkt direkt nutzbar (ohne erneuten Scan)", e.selectProduct(await db.getProduct("999")).ok && e.state === "product");
await e.addQty(3); await e.handleCode("INVENTORY_CONFIRM");
// EAN-Variante
await db.putProduct({ barcode: "0012345678905", name: "EAN13", kategorie: "", variante: "" });
t("  UPC-A (12) findet EAN-13 mit führender 0", (await e.lookup("012345678905"))?.name === "EAN13");

// 17 unerwartetes Schließen
await e.handleCode("111"); await e.handleCode("INVENTORY_QTY_30");
const e2 = new Engine(db); await e2.init();
t("17 Neustart: Erfassung wiederhergestellt, bestätigte Mengen da", e2.erf.status === "aktiv" && (await db.getBestand(1)).length === 2);
t("17 Neustart: offene Menge verworfen, mit Hinweis, nie gebucht", e2.qty === 0 && e2.notice.includes("verworfen") && (await db.getBestand(1)).find((b) => b.barcode === "111").gesamt === 35);
// Speicherfehler
await e2.handleCode("111"); await e2.addQty(4); db.fail = true;
const f = await e2.confirm(); db.fail = false;
t("  Speicherfehler: Menge bleibt offen, nichts gebucht, Bestand unverändert", !f.ok && e2.qty === 4 && (await db.getBestand(1)).find((b) => b.barcode === "111").gesamt === 35);
await e2.cancel();

// 13/14 Abschluss
const fq = await e2.handleCode("INVENTORY_FINISH");
t("  Abschluss verlangt Bestätigung (ask)", fq.ask === "finish" && e2.erf.status === "aktiv");
const before = Date.now(), fin = await e2.finish();
t("13 Abschließen mit Zeitstempel", fin.ok && e2.erf.status === "abgeschlossen" && Math.abs(new Date(e2.erf.end) - before) < 5000);
t("  nach Abschluss keine Buchung mehr", !(await e2.handleCode("111")).ok && !(await e2.addQty(1)).ok);
const n = await e2.handleCode("INVENTORY_START");
t("14 Neue Erfassung, alte unverändert", n.ok && e2.erf.id === 2 && (await db.getBestand(1)).length === 2 && (await db.getAllErfassungen())[0].status === "abgeschlossen");
t("  neue Erfassung startet bei 0", (await db.getBestand(2)).length === 0);

// 16 Export
const pm = new Map((await db.getAllProducts()).map((p) => [p.barcode, p]));
const rows = [["Barcode", "Produktname", "Kategorie", "Variante", "Bestand"], ...(await db.getBestand(1)).map((b) => [b.barcode, pm.get(b.barcode).name, pm.get(b.barcode).kategorie, pm.get(b.barcode).variante, b.gesamt])];
const back = await readXlsx(await buildXlsx(rows).arrayBuffer());
t("16 Excel-Export: Gesamtmengen korrekt, jedes Produkt einmal", back.length === 3 && back.find((r) => r[0] === "111")[4] === "35" && new Set(back.map((r) => r[0])).size === 3);
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
