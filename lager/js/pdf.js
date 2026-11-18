// A4-Befehlsblatt als echtes Vektor-PDF (Strichbreite exakt, keine Bibliothek nötig).
import { code128Widths } from "./code128.js";

export const QTYS = [1, 5, 10, 15, 20, 24, 30, 35];
export const CONTROLS = [
  ["Bestätigen", "INVENTORY_CONFIRM"], ["Abbruch", "INVENTORY_CANCEL"], ["Start", "INVENTORY_START"],
  ["Unterbrechen", "INVENTORY_PAUSE"], ["Abschließen", "INVENTORY_FINISH"],
];
const MM = 72 / 25.4, PW = 595.276, PH = 841.89;
const n = (v) => Number(v.toFixed(3)).toString();
const pdfEsc = (s) => s.replace(/[\\()]/g, "\\$&");

export function buildCommandSheet({ modW = 0.21, barH = 7.3 } = {}) {
  const margin = 12, colW = (210 - 2 * margin) / 2, quiet = 5;
  const maxModules = Math.max(...[...QTYS.map((q) => "INVENTORY_QTY_" + q), ...CONTROLS.map((c) => c[1])]
    .map((t) => code128Widths(t).reduce((a, b) => a + b, 0)));
  modW = Math.min(modW, (colW - 2 * quiet) / maxModules);
  let c = "0 g\n";
  const text = (x, y, s, size, bold) =>
    (c += `BT /F${bold ? 2 : 1} ${size} Tf ${n(x * MM)} ${n(PH - y * MM)} Td (${pdfEsc(s)}) Tj ET\n`);
  const rect = (x, y, w, h) => (c += `${n(x * MM)} ${n(PH - (y + h) * MM)} ${n(w * MM)} ${n(h * MM)} re f\n`);
  const bars = (code, x, y) => {
    let cx = x;
    code128Widths(code).forEach((w, i) => { if (i % 2 === 0) rect(cx, y, w * modW, barH); cx += w * modW; });
  };
  const cell = (label, code, col, top, size) => {
    const x = margin + col * colW;
    text(x + quiet, top + 10, label, size, true);
    bars(code, x + quiet, top + 13);
    text(x + quiet, top + 13 + barH + 4.5, code, 7, false);
  };
  text(margin, 20, "Befehlsblatt Lagererfassung", 20, true);
  text(margin, 26, `Code 128 · Strichbreite ${modW.toFixed(2).replace(".", ",")} mm · Höhe ${barH.toFixed(1).replace(".", ",")} mm`, 8, false);
  const rowH = 30;
  text(margin, 38, "Mengen", 13, true);
  QTYS.forEach((q, i) => cell(String(q), "INVENTORY_QTY_" + q, i % 2, 42 + Math.floor(i / 2) * rowH, 24));
  text(margin, 172, "Steuerbefehle", 13, true);
  CONTROLS.forEach(([l, code], i) => cell(l, code, i % 2, 176 + Math.floor(i / 2) * rowH, 20));

  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${c.length} >>\nstream\n${c}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 255);
  return new Blob([bytes], { type: "application/pdf" });
}
