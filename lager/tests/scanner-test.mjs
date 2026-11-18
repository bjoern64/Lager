// Prüft nur die Scan-Sperre (ohne Kamera): node tests/scanner-test.mjs
import { Scanner } from "../js/scanner.js";
const got = []; const s = new Scanner({}, (c) => got.push(c));
const feed = (code, t) => s.accept(code, t);
let ok = true; const T = (n, c) => { ok &&= c; console.log(c ? "OK    " : "FEHLER", n); };
// Code bleibt 1 s lang im Bild (alle 90 ms erkannt) → nur 1 Verarbeitung
for (let t = 0; t <= 1000; t += 90) feed("INVENTORY_QTY_10", t);
T("Dauererkennung desselben Codes → 1 Treffer", got.length === 1);
// Code verlässt das Bild (>0,7 s Lücke), kommt wieder → zählt erneut (10 + 10)
feed("INVENTORY_QTY_10", 2300); T("Code erneut gezeigt nach Pause → 2. Treffer", got.length === 2);
// Anderer Code direkt danach → sofort angenommen (nach 350 ms)
feed("INVENTORY_QTY_5", 2700); T("anderer Code → angenommen", got.length === 3 && got[2] === "INVENTORY_QTY_5");
// Flackern (kurze Lücke 300 ms) → kein Doppelzählen
feed("INVENTORY_QTY_5", 3000); feed("INVENTORY_QTY_5", 3300); T("kurzes Flackern → nicht doppelt", got.length === 3);
process.exit(ok ? 0 : 1);
