// Prüfung der Excel-Importdatei (rein, ohne Datenbankzugriff).
const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-zäöüß]/g, "");
const ALIAS = {
  barcode: ["barcode", "ean", "gtin"], name: ["produktname", "name", "produkt", "bezeichnung", "artikelname"],
  kategorie: ["kategorie", "category"], variante: ["variante", "variant"],
};
export const RESERVED = "INVENTORY_";

/** existing: Map barcode → {barcode,name,kategorie,variante}. Der Import ist nur erlaubt, wenn errors leer ist (alles oder nichts). */
export function analyzeImport(rows, existing) {
  const res = { fatal: null, errors: [], items: [], counts: { neu: 0, aktualisiert: 0, unveraendert: 0, fehler: 0 } };
  const nonEmpty = rows.findIndex((r) => r && r.some((v) => String(v).trim() !== ""));
  if (nonEmpty < 0) { res.fatal = "Die Datei enthält keine Daten."; return res; }
  const head = rows[nonEmpty].map(norm), col = {}, missing = [];
  for (const [k, names] of Object.entries(ALIAS)) { const i = head.findIndex((h) => names.includes(h)); if (i < 0) missing.push(k); else col[k] = i; }
  if (missing.length) { res.fatal = "Spalten fehlen in der Kopfzeile: " + missing.join(", ") + ". Erwartet: Barcode, Produktname, Kategorie, Variante."; return res; }
  const seen = new Map();
  for (let r = nonEmpty + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || row.every((v) => String(v).trim() === "")) continue;
    const g = (k) => String(row[col[k]] ?? "").trim(), line = r + 1;
    const p = { barcode: g("barcode"), name: g("name"), kategorie: g("kategorie"), variante: g("variante") };
    let err = null;
    if (!p.barcode) err = "Barcode fehlt";
    else if (p.barcode.startsWith(RESERVED)) err = `Barcode darf nicht mit ${RESERVED} beginnen (reserviert für Befehle)`;
    else if (p.barcode.length > 64) err = "Barcode zu lang";
    else if (seen.has(p.barcode)) err = `Doppelter Barcode ${p.barcode} (schon in Zeile ${seen.get(p.barcode)})`;
    if (err) { res.errors.push({ zeile: line, text: err }); continue; }
    seen.set(p.barcode, line);
    const old = existing.get(p.barcode);
    p.status = !old ? "neu" : (old.name === p.name && old.kategorie === p.kategorie && old.variante === p.variante) ? "unveraendert" : "aktualisiert";
    res.counts[p.status]++; res.items.push(p);
  }
  res.counts.fehler = res.errors.length;
  return res;
}
