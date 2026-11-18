// XLSX lesen und schreiben – ohne Bibliothek (ZIP "store" zum Schreiben, DecompressionStream zum Lesen).
const escX = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1))
    : { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e]);
const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

const crcT = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (~c) >>> 0; };

function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), len = f.data.length, crc = crc32(f.data);
    const lh = new Uint8Array(30 + nm.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(12, 0x21, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, len, true); dv.setUint32(22, len, true); dv.setUint16(26, nm.length, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, len, true); cv.setUint32(24, len, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true); ch.set(nm, 46);
    parts.push(lh, f.data); cd.push(ch); off += lh.length + len;
  }
  const size = cd.reduce((a, c) => a + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, off, true);
  return new Blob([...parts, ...cd, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** rows: Array von Zeilen (erste Zeile = Kopfzeile). Zahlen bleiben Zahlen, alles andere wird Text (Barcodes behalten führende Nullen). */
export function buildXlsx(rows, { sheet = "Bestand", widths = [] } = {}) {
  const enc = new TextEncoder(), X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sd = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1), s = ri === 0 ? ' s="1"' : "";
    return typeof v === "number" ? `<c r="${ref}"${s}><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escX(v ?? "")}</t></is></c>`;
  }).join("") + "</row>").join("");
  const cols = widths.length ? "<cols>" + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>" : "";
  const f = (name, s) => ({ name, data: enc.encode(X + s) });
  return zip([
    f("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    f("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f("xl/workbook.xml", `<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escX(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    f("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    f("xl/styles.xml", `<styleSheet ${ns}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    f("xl/worksheets/sheet1.xml", `<worksheet ${ns}>${cols}<sheetData>${sd}</sheetData></worksheet>`),
  ]);
}

const attr = (tag, name) => { const m = tag.match(new RegExp("(?:^|\\s)" + name + '="([^"]*)"')); return m ? unesc(m[1]) : null; };
const tText = (x) => [...x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");
const numStr = (v) => { const s = v.trim(); if (/^-?\d+$/.test(s)) return s; const x = Number(s); return Number.isFinite(x) ? String(x) : s; };

/** Liest das erste Tabellenblatt → Array von Zeilen (alles als Text). */
export async function readXlsx(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Das ist keine gültige XLSX-Datei.");
  const cnt = dv.getUint16(e + 10, true), ents = {}; let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < cnt; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("XLSX-Datei ist beschädigt.");
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    ents[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method: dv.getUint16(p + 10, true), csz: dv.getUint32(p + 20, true), lo: dv.getUint32(p + 42, true) };
    p += 46 + nl + el + cl;
  }
  const get = async (name) => {
    const en = ents[name]; if (!en) return null;
    const s = en.lo + 30 + dv.getUint16(en.lo + 26, true) + dv.getUint16(en.lo + 28, true), data = u8.subarray(s, s + en.csz);
    if (en.method === 0) return dec.decode(data);
    if (en.method !== 8) throw new Error("Nicht unterstützte ZIP-Komprimierung.");
    if (typeof DecompressionStream === "undefined") throw new Error("Dieses iOS kann XLSX nicht entpacken (iOS 16.4 oder neuer nötig).");
    return dec.decode(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  };
  let path = null;
  const wb = await get("xl/workbook.xml"), rels = await get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const rid = (wb.match(/<sheet\b[^>]*>/) || [""])[0].match(/r:id="([^"]*)"/);
    for (const t of rels.match(/<Relationship\b[^>]*>/g) || []) if (rid && attr(t, "Id") === rid[1]) {
      const tg = attr(t, "Target"); path = tg[0] === "/" ? tg.slice(1) : "xl/" + tg;
    }
  }
  if (!path || !ents[path]) path = Object.keys(ents).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!path) throw new Error("Kein Tabellenblatt in der Datei gefunden.");
  const sstXml = await get("xl/sharedStrings.xml"), sst = sstXml ? [...sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => tText(m[1])) : [];
  const sheet = await get(path), rows = [];
  for (const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = (attr(m[1], "r") || "").match(/^([A-Z]+)(\d+)$/); if (!ref || !m[2]) continue;
    const t = attr(m[1], "t"), vm = m[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/), v = vm ? unesc(vm[1]) : "";
    let val;
    if (t === "s") val = sst[+v] ?? ""; else if (t === "inlineStr") val = tText(m[2]);
    else if (t === "str") val = v; else if (t === "b") val = v === "1" ? "TRUE" : "FALSE"; else if (t === "e") val = ""; else val = v === "" ? "" : numStr(v);
    const ci = ref[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, ri = +ref[2] - 1;
    if (ri > 500000 || ci > 200) continue;
    (rows[ri] ||= [])[ci] = val;
  }
  return Array.from(rows, (r) => Array.from(r || [], (v) => v ?? ""));
}
