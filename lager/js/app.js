import { IdbDb } from "./db.js";
import { Engine, QTYS } from "./engine.js";
import { Scanner, ROI } from "./scanner.js";
import { prefs, savePrefs, unlock, sound } from "./audio.js";
import { buildXlsx, readXlsx } from "./xlsx.js";
import { buildCommandSheet } from "./pdf.js";
import { analyzeImport, RESERVED } from "./products.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmt = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const stamp = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
const label = (p) => p.name || p.barcode;
const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", json: "application/json" };

const db = new IdbDb(), eng = new Engine(db);
const scanners = {};
let wake = null, tab = "Erfassen", chain = Promise.resolve(), msgTimer = null;

/* ---------- Rückmeldung ---------- */
function showMsg(text, kind, ms = 6000) {
  const m = $("#msg"); m.textContent = text || ""; m.className = text ? kind : "empty";
  clearTimeout(msgTimer); if (text && ms) msgTimer = setTimeout(() => { m.textContent = ""; m.className = "empty"; }, ms);
}
function feedback(r) {
  if (!r) return;
  sound(r.sound); showMsg(r.msg, r.ok ? "ok" : "err"); render();
  if (r.unknown && $("#modal").hidden) productForm({ barcode: r.unknown, isNew: true, select: !r.quick, quick: !!r.quick });
  if (r.ask === "finish") askFinish();
  if (r.finished) afterFinish(r.finished);
}
/** Alle Aktionen laufen nacheinander (kein Durcheinander bei schnellen Scans). */
function act(fn) {
  chain = chain.then(async () => { try { feedback(await fn()); } catch (e) { feedback({ ok: false, sound: "error", msg: "Fehler: " + (e.message || e) }); } });
  return chain;
}

/* ---------- Dialoge ---------- */
function dialog(title, body, buttons) {
  return new Promise((res) => {
    const m = $("#modal");
    m.innerHTML = `<div class="sheet"><h2>${esc(title)}</h2><div>${body}</div><div class="btns">${buttons.map((b, i) => `<button class="btn ${b.cls || ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
    m.hidden = false;
    m.onclick = (ev) => {
      const b = ev.target.closest("button[data-i]"); if (!b) return;
      const v = typeof buttons[+b.dataset.i].value === "function" ? buttons[+b.dataset.i].value(m) : buttons[+b.dataset.i].value;
      if (v === false) return; m.hidden = true; m.onclick = null; res(v);
    };
  });
}
async function askFinish() {
  const ok = await dialog("Erfassung abschließen?", `<p>Nach dem Abschluss sind in Erfassung Nr. ${eng.erf.id} keine Buchungen mehr möglich.</p>`,
    [{ label: "Ja, abschließen", value: true, cls: "ok" }, { label: "Nein, weiter erfassen", value: "no" }]);
  if (ok === true) act(() => eng.finish());
}
async function afterFinish(e) {
  const v = await dialog("Erfassung abgeschlossen", `<p>Nr. ${e.id} ist archiviert. Excel-Datei jetzt erzeugen?</p>`,
    [{ label: "Excel exportieren", value: "x", cls: "ok" }, { label: "Später", value: "l" }]);
  if (v === "x") exportErfassung(e.id);
}
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; } }
  catch (e) { if (e.name === "AbortError") return false; }
  const url = URL.createObjectURL(blob);
  await dialog("Datei bereit", `<p>${esc(name)}</p><a class="btn dark" href="${url}" download="${esc(name)}">Datei speichern / öffnen</a>`,
    [{ label: "Teilen …", value: () => { navigator.share && navigator.share({ files: [file] }).catch(() => {}); return false; } }, { label: "Schließen", value: 1 }]);
  setTimeout(() => URL.revokeObjectURL(url), 120000); return true;
}

/* ---------- Anzeige ---------- */
const UI = {
  none: ["Keine aktive Erfassung. „Erfass. Start“ drücken.", "st-neutral"],
  expect_product: ["Produktbarcode scannen", "st-neutral"],
  product: ["Mengenbefehl scannen oder Menge eingeben", "st-blue"],
  qty: ["Menge bestätigen oder abbrechen", "st-yellow"],
  confirmed: ["Produkt bestätigt. Nächsten Produktbarcode scannen.", "st-green"],
  paused: ["Erfassung unterbrochen. „Fortsetzen“ drücken.", "st-gray"],
  finished: ["Erfassung abgeschlossen. Neue mit „Erfass. Start“.", "st-gray"],
};
function render() {
  const e = eng.erf; let [txt, cls] = UI[eng.state];
  if (tab === "Zählen" && eng.active) [txt, cls] = ["Artikel scannen: jeder Scan zählt +1", "st-blue"];
  $("#erfInfo").innerHTML = e ? `<b>Erfassung Nr. ${e.id}</b><span>${fmt(e.start)}</span><span class="badge ${e.status}">${e.status}</span>` : `<b>Keine Erfassung</b>`;
  const x = $("#expect"); x.textContent = txt; x.className = cls;
  const p = eng.product;
  $("#prod").innerHTML = p
    ? `<div class="name">${esc(label(p))}</div><div class="meta">Barcode ${esc(p.barcode)}</div><div class="meta">Kategorie: ${esc(p.kategorie || "–")} · Variante: ${esc(p.variante || "–")}</div>
       <div class="q">Vorläufig: ${eng.qty}<small>${eng.parts.length ? esc(eng.parts.join(" + ")) : "noch keine Menge"}</small></div>`
    : `<div class="none">Kein Produkt ausgewählt</div>`;
  const st = eng.state === "paused" ? "Fortsetzen" : "Erfass. Start"; $("#btnStart").textContent = st; $("#btnStartZ").textContent = st;
  const li = (r, plus) => `<li><b>${esc(r.name)}</b>: ${plus && r.menge > 0 ? "+" : ""}${r.menge} <small>${pad(new Date(r.zeit).getHours())}:${pad(new Date(r.zeit).getMinutes())}</small></li>`;
  const none = `<li class="hint" style="list-style:none;margin-left:-22px">Noch keine Buchungen.</li>`;
  $("#recent").innerHTML = eng.recent.length ? eng.recent.map((r) => li(r, false)).join("") : none;
  $("#recentZ").innerHTML = eng.recent.length ? eng.recent.map((r) => li(r, true)).join("") : none;
  if (tab === "Zählen") updateQuick();
}
async function updateQuick() {
  const box = $("#qInfo"), p = eng.lastQuick;
  if (!eng.erf) { box.innerHTML = `<div class="none">Keine Erfassung. „Erfass. Start“ drücken.</div>`; return; }
  const b = await db.getBestand(eng.erf.id), sum = b.reduce((a, x) => a + x.gesamt, 0), one = p && b.find((x) => x.barcode === p.barcode);
  box.innerHTML = (p ? `<div class="name">Zuletzt: ${esc(label(p))}</div><div class="meta">${esc(p.barcode)} · ${esc(p.kategorie || "–")} · ${esc(p.variante || "–")}</div>` : `<div class="none">Noch nichts gezählt</div>`)
    + `<div class="q">${one ? "Summe Artikel: " + one.gesamt + " · " : ""}Gesamt: ${sum}</div>`;
}
const TABS = ["Erfassen", "Zählen", "Produkte", "Bestand", "Import", "Export", "Mehr"];
const vid = (n) => "#v-" + (n === "Zählen" ? "zaehlen" : n.toLowerCase());
function setTab(t) {
  stopCam();
  tab = t;
  TABS.forEach((n) => ($(vid(n)).hidden = n !== t));
  $("#tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === t));
  ({ Produkte: renderProducts, Bestand: renderBestand, Export: renderExport, Mehr: renderMore }[t] || (() => {}))();
  render(); window.scrollTo(0, 0);
}

/* ---------- Kamera ---------- */
const camKey = () => (tab === "Zählen" ? "Z" : "");
async function startCam(k = camKey()) {
  unlock();
  try {
    scanners[k] = scanners[k] || new Scanner($("#cam" + k), (code) => { if ($("#modal").hidden) act(() => (k === "Z" ? eng.quickCount(code) : eng.handleCode(code))); },
      () => feedback({ ok: false, sound: "error", msg: "Kein Code im Scanfenster erkannt. Bitte „SCAN“ erneut drücken." }), (on) => setArmed(on, k));
    await scanners[k].start(); $("#camWrap" + k).hidden = false; $("#btnCam" + k).textContent = "Kamera-Scanner stoppen";
    try { wake = await navigator.wakeLock?.request("screen"); } catch {}
  } catch (e) {
    const t = { NotAllowedError: "Kamerazugriff verweigert. iPhone: Einstellungen → Safari → Kamera → „Erlauben“ (bei installierter App ggf. erneut bestätigen).",
      NotFoundError: "Keine Kamera verfügbar.", NotReadableError: "Die Kamera wird gerade von einer anderen App benutzt.",
      LIB_MISSING: "Scanner-Bibliothek fehlt (lib/zxing.min.js). Bitte „node setup.mjs“ ausführen und neu veröffentlichen." }[e.name];
    stopCam(); feedback({ ok: false, sound: "error", msg: t || "Kamera konnte nicht gestartet werden: " + (e.message || e.name) });
  }
}
function setArmed(on, k = "") {
  const b = $("#btnScan" + k); b.classList.toggle("armed", on); b.textContent = on ? "Suche Code … im Rahmen halten" : "SCAN";
  $("#camWrap" + k).classList.toggle("armed", on);
}
function stopCam() {
  for (const k of ["", "Z"]) { if (scanners[k]) scanners[k].stop(); $("#camWrap" + k).hidden = true; $("#btnCam" + k).textContent = "Kamera-Scanner starten"; setArmed(false, k); }
  try { wake && wake.release(); } catch {} wake = null;
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stopCam(); });

/* ---------- Produkte ---------- */
const matches = (p, q) => !q || [p.barcode, p.name, p.kategorie, p.variante].some((v) => String(v || "").toLowerCase().includes(q));
const itemHtml = (p, right = "") => `<button class="item" data-bc="${esc(p.barcode)}"><span><span class="t">${esc(label(p))}</span><span class="s">${esc(p.barcode)} · ${esc(p.kategorie || "–")} · ${esc(p.variante || "–")}</span></span>${right}</button>`;
async function renderProducts() {
  const q = $("#pSearch").value.trim().toLowerCase(), all = (await db.getAllProducts()).filter((p) => matches(p, q)).sort((a, b) => label(a).localeCompare(label(b), "de"));
  $("#pList").innerHTML = (all.slice(0, 200).map((p) => itemHtml(p)).join("") || `<div class="card hint">Keine Produkte. Über „Import“ oder „Neu“ anlegen.</div>`) + (all.length > 200 ? `<div class="hint">${all.length} Treffer – erste 200 angezeigt, bitte Suche verfeinern.</div>` : "");
}
function productForm({ barcode = "", isNew = true, select = false, quick = false }) {
  return (async () => {
    const old = isNew ? null : await db.getProduct(barcode), lock = !isNew || !!barcode;
    const body = `<label>Barcode<input id="f_bc" value="${esc(barcode)}" ${lock ? "readonly" : ""} autocapitalize="off"></label>
      <label>Produktname<input id="f_n" value="${esc(old?.name)}"></label><label>Kategorie<input id="f_k" value="${esc(old?.kategorie)}"></label>
      <label>Variante<input id="f_v" value="${esc(old?.variante)}"></label><div id="f_e" class="err-l"></div>`;
    const prod = await dialog(isNew ? (barcode ? "Unbekannter Barcode – Produkt anlegen" : "Neues Produkt") : "Produkt bearbeiten", body, [
      { label: "Speichern", cls: "ok", value: (m) => {
        const p = { barcode: m.querySelector("#f_bc").value.trim(), name: m.querySelector("#f_n").value.trim(), kategorie: m.querySelector("#f_k").value.trim(), variante: m.querySelector("#f_v").value.trim() };
        const err = !p.barcode ? "Barcode fehlt." : p.barcode.startsWith(RESERVED) ? `Barcode darf nicht mit ${RESERVED} beginnen.` : null;
        if (err) { m.querySelector("#f_e").textContent = err; return false; }
        return p; } },
      { label: "Abbrechen", value: null }]);
    if (!prod) return;
    if (isNew && (await db.getProduct(prod.barcode))) return feedback({ ok: false, sound: "error", msg: `Barcode ${prod.barcode} existiert bereits.` });
    try { await db.putProduct(prod); } catch (e) { return feedback({ ok: false, sound: "error", msg: "Speicherfehler: Produkt nicht gespeichert. " + e.message }); }
    eng.names.delete(prod.barcode); await eng.refreshRecent();
    if (select) act(() => eng.selectProduct(prod)); else if (quick) act(() => eng.quickBook(prod)); else showMsg("Produkt gespeichert.", "ok");
    if (tab === "Produkte") renderProducts();
  })();
}
function pickProduct() {
  return new Promise(async (res) => {
    const all = (await db.getAllProducts()).sort((a, b) => label(a).localeCompare(label(b), "de")), m = $("#modal");
    m.onclick = null;
    m.innerHTML = `<div class="sheet"><h2>Produkt auswählen</h2><input id="q" type="search" placeholder="Name, Barcode, Kategorie, Variante"><div class="list" id="res" style="margin-top:8px"></div><div class="btns"><button class="btn" id="x">Schließen</button></div></div>`;
    m.hidden = false;
    const draw = () => { const q = $("#q").value.trim().toLowerCase(), f = all.filter((p) => matches(p, q)); $("#res").innerHTML = f.slice(0, 60).map((p) => itemHtml(p)).join("") || `<div class="hint">Keine Treffer.</div>`; };
    draw(); $("#q").oninput = draw;
    $("#res").onclick = (e) => { const b = e.target.closest("[data-bc]"); if (b) { m.hidden = true; res(all.find((p) => p.barcode === b.dataset.bc)); } };
    $("#x").onclick = () => { m.hidden = true; res(null); };
  });
}

/* ---------- Bestand / Export ---------- */
let bSel = null;
async function renderBestand() {
  const ers = (await db.getAllErfassungen()).sort((a, b) => b.id - a.id), sel = $("#bSel");
  if (!ers.length) { sel.innerHTML = ""; $("#bList").innerHTML = `<div class="card hint">Noch keine Erfassung.</div>`; return; }
  if (!ers.find((e) => e.id === bSel)) bSel = eng.erf ? eng.erf.id : ers[0].id;
  sel.innerHTML = ers.map((e) => `<option value="${e.id}" ${e.id === bSel ? "selected" : ""}>Nr. ${e.id} · ${e.status} · ${fmt(e.start)}</option>`).join("");
  const pm = new Map((await db.getAllProducts()).map((p) => [p.barcode, p])), q = $("#bSearch").value.trim().toLowerCase();
  const rows = (await db.getBestand(bSel)).map((b) => ({ ...(pm.get(b.barcode) || { barcode: b.barcode }), gesamt: b.gesamt })).filter((p) => matches(p, q)).sort((a, b) => label(a).localeCompare(label(b), "de"));
  $("#bList").innerHTML = rows.map((p) => `<div class="item"><span><span class="t">${esc(label(p))}</span><span class="s">${esc(p.barcode)} · ${esc(p.kategorie || "–")} · ${esc(p.variante || "–")}</span></span><span class="n">${p.gesamt}</span></div>`).join("") || `<div class="card hint">Keine Buchungen in dieser Erfassung.</div>`;
}
async function renderExport() {
  const ers = (await db.getAllErfassungen()).sort((a, b) => b.id - a.id);
  $("#eList").innerHTML = ers.map((e) => `<div class="item"><span><span class="t">Erfassung Nr. ${e.id} · ${e.status}</span><span class="s">${fmt(e.start)}${e.end ? " – " + fmt(e.end) : ""}</span></span><button class="btn small dark" data-x="${e.id}">Excel</button></div>`).join("") || `<div class="card hint">Noch keine Erfassung.</div>`;
}
async function exportErfassung(id) {
  try {
    const e = (await db.getAllErfassungen()).find((x) => x.id === id), pm = new Map((await db.getAllProducts()).map((p) => [p.barcode, p]));
    const rows = [["Barcode", "Produktname", "Kategorie", "Variante", "Bestand"], ...(await db.getBestand(id)).map((b) => { const p = pm.get(b.barcode) || {}; return [b.barcode, p.name || "", p.kategorie || "", p.variante || "", b.gesamt]; })
      .sort((a, b) => a[1].localeCompare(b[1], "de") || a[0].localeCompare(b[0]))];
    await deliver(buildXlsx(rows, { widths: [18, 34, 18, 14, 10] }), `Lagererfassung_${stamp(e.end || new Date().toISOString())}.xlsx`);
  } catch (err) { feedback({ ok: false, sound: "error", msg: "Fehler beim Excel-Export: " + (err.message || err) }); }
}

/* ---------- Import ---------- */
let pending = null;
async function onImportFile(file) {
  const out = $("#impOut"); pending = null;
  try {
    const rows = await readXlsx(await file.arrayBuffer()), map = new Map((await db.getAllProducts()).map((p) => [p.barcode, p])), a = analyzeImport(rows, map);
    if (a.fatal) { out.innerHTML = `<p class="err-l">${esc(a.fatal)}</p>`; return; }
    const c = a.counts;
    out.innerHTML = `<table class="tbl"><tr><td>Neue Produkte</td><td><b>${c.neu}</b></td></tr><tr><td>Aktualisierte Produkte</td><td><b>${c.aktualisiert}</b></td></tr><tr><td>Unveränderte Produkte</td><td><b>${c.unveraendert}</b></td></tr><tr><td>Fehlerhafte Datensätze</td><td><b class="${c.fehler ? "err-l" : ""}">${c.fehler}</b></td></tr></table>`;
    if (a.errors.length) out.innerHTML += `<p class="err-l">Import gesperrt – bitte Datei korrigieren (alles oder nichts):</p>` + a.errors.slice(0, 40).map((e) => `<div class="err-l">Zeile ${e.zeile}: ${esc(e.text)}</div>`).join("") + (a.errors.length > 40 ? `<div class="hint">… und ${a.errors.length - 40} weitere</div>` : "");
    else if (a.items.length) { pending = a; out.innerHTML += `<button class="btn ok" id="impGo">Jetzt importieren</button>`; }
  } catch (e) { out.innerHTML = `<p class="err-l">Fehler beim Lesen der Datei: ${esc(e.message || e)}</p>`; }
}
async function doImport() {
  if (!pending) return;
  try { await db.importProducts(pending.items.filter((p) => p.status !== "unveraendert")); eng.names.clear(); await eng.refreshRecent(); const c = pending.counts; pending = null;
    $("#impOut").innerHTML = `<p><b>Import abgeschlossen.</b> Neu: ${c.neu}, aktualisiert: ${c.aktualisiert}, unverändert: ${c.unveraendert}.</p>`; sound("confirm"); }
  catch (e) { $("#impOut").innerHTML = `<p class="err-l">Speicherfehler – es wurde nichts importiert: ${esc(e.message || e)}</p>`; sound("error"); }
}

/* ---------- Mehr ---------- */
async function renderMore() {
  const last = await db.getSetting("lastBackup"), sheet = (await db.getSetting("sheet")) || { modW: 0.21, barH: 7.3 };
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  $("#v-mehr").innerHTML = `
  <div class="card"><h3>Befehlsblatt (A4, PDF)</h3><p>Code 128, schwarz-weiß, zwei Spalten. Drucken über Teilen → Drucken.</p>
    <label>Strichbreite in mm<input id="sMod" type="number" step="0.01" min="0.15" max="0.4" value="${sheet.modW}"></label>
    <label>Barcode-Höhe in mm<input id="sH" type="number" step="0.1" min="5" max="20" value="${sheet.barH}"></label>
    <p class="hint">Vorgabe 0,21 mm / 7,3 mm. Lässt sich ein Code schlecht lesen, Strichbreite auf 0,30 erhöhen.</p>
    <button class="btn ok" id="mPdf">PDF erzeugen</button></div>
  <div class="card"><h3>Töne</h3><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="aMute" style="width:28px;min-height:28px;margin:0" ${prefs.muted ? "checked" : ""}>Töne aus</label>
    <label>Lautstärke<input type="range" id="aVol" min="0.1" max="1" step="0.05" value="${prefs.volume}"></label><button class="btn" id="aTest">Testton</button>
    <p class="hint">Hinweis: Der Stummschalter des iPhones kann Töne unterdrücken. Die Anzeige funktioniert immer.</p></div>
  <div class="card"><h3>Datensicherung</h3><p>Safari kann lokale Daten löschen. Bitte regelmäßig sichern und die Datei in „Dateien“ ablegen.</p>
    <p class="${last && Date.now() - new Date(last) < 7 * 864e5 ? "" : "err-l"}">Letzte Sicherung: ${last ? fmt(last) : "noch nie"}</p>
    <button class="btn ok" id="mBackup">Sicherung erstellen</button>
    <label class="btn filebtn">Sicherung wiederherstellen<input type="file" id="mRestore" accept=".json,application/json"></label>
    <p class="hint">Dauerhafter Speicher: ${persisted === null ? "unbekannt" : persisted ? "zugesichert" : "nicht zugesichert (Sicherung wichtig)"}</p></div>
  <div class="card"><h3>Info</h3><p class="hint">Installation: Safari → Teilen → „Zum Home-Bildschirm“. Scanner-Bibliothek: ${window.ZXing ? "geladen" : "FEHLT"}. Version 2.5</p></div>`;
}
async function makeBackup() {
  try { const d = await db.exportAll(), ok = await deliver(new Blob([JSON.stringify(d)], { type: MIME.json }), `Lager_Sicherung_${stamp(new Date().toISOString())}.json`);
    if (ok) { await db.setSetting("lastBackup", new Date().toISOString()); renderMore(); } }
  catch (e) { feedback({ ok: false, sound: "error", msg: "Sicherung fehlgeschlagen: " + (e.message || e) }); }
}
async function restore(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.format !== "lager-backup" || !["produkte", "erfassungen", "bestand", "buchungen"].every((k) => Array.isArray(d[k]))) throw new Error("Das ist keine Sicherungsdatei dieser App.");
    const ok = await dialog("Sicherung wiederherstellen?", `<p>Die Sicherung enthält ${d.produkte.length} Produkte und ${d.erfassungen.length} Erfassungen (${fmt(d.exportiert)}).</p><p class="err-l">Alle aktuellen Daten auf diesem Gerät werden dadurch ersetzt. Erstellen Sie vorher eine Sicherung, falls nötig.</p>`,
      [{ label: "Ja, Daten ersetzen", value: true, cls: "bad" }, { label: "Abbrechen", value: "no" }]);
    if (ok !== true) return;
    await db.restoreAll(d); stopCam(); eng.reset(); await eng.init(); render(); renderMore(); showMsg("Sicherung wiederhergestellt.", "ok");
  } catch (e) { feedback({ ok: false, sound: "error", msg: "Wiederherstellung fehlgeschlagen (nichts geändert): " + (e.message || e) }); }
}

/* ---------- Start ---------- */
async function main() {
  $("#tabs").innerHTML = TABS.map((t) => `<button>${t}</button>`).join("");
  $("#tabs").onclick = (e) => { if (e.target.tagName === "BUTTON") setTab(e.target.textContent); };
  document.addEventListener("pointerdown", unlock, { passive: true });
  // Mengen-Tastenfeld (fest unten, über SCAN): wirkt wie ein gescannter Mengenbefehl
  $("#qtyPad").innerHTML = QTYS.map((q) => `<button class="btn" data-q="${q}">${q}</button>`).join("");
  $("#qtyPad").onclick = (e) => { const b = e.target.closest("button[data-q]"); if (b) { unlock(); act(() => eng.addQty(+b.dataset.q)); } };
  // Beim Tippen darf die feste Tastenleiste das Eingabefeld nicht verdecken (sonst sieht man die Zahl nicht).
  document.addEventListener("focusin", (e) => { if (e.target.matches("input")) { document.body.classList.add("typing"); setTimeout(() => e.target.scrollIntoView({ block: "nearest" }), 350); } });
  document.addEventListener("focusout", () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches("input")) document.body.classList.remove("typing"); }, 400));
  document.querySelectorAll(".reticle").forEach((el) => { const r = el.style; r.left = ROI.x * 100 + "%"; r.top = ROI.y * 100 + "%"; r.width = ROI.w * 100 + "%"; r.height = ROI.h * 100 + "%"; });
  for (const k of ["", "Z"]) {
    $("#btnScan" + k).onclick = async () => { unlock(); if (!scanners[k] || !scanners[k].running) await startCam(k); if (scanners[k] && scanners[k].running) scanners[k].arm(); };
    $("#btnCam" + k).onclick = () => { if (scanners[k] && scanners[k].running) stopCam(); else startCam(k); };
  }
  $("#btnStartZ").onclick = () => act(() => eng.start()); $("#btnPauseZ").onclick = () => act(() => eng.pause()); $("#btnFinishZ").onclick = () => act(() => eng.requestFinish());
  $("#btnUndo").onclick = () => act(() => eng.undoQuick());
  $("#btnCodeZ").onclick = () => { const v = $("#inCodeZ").value; $("#inCodeZ").value = ""; act(() => eng.quickCount(v)); };
  $("#inCodeZ").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnCodeZ").click(); });
  $("#btnSearchZ").onclick = async () => { const p = await pickProduct(); if (p) act(() => eng.quickBook(p)); };
  $("#btnConfirm").onclick = () => act(() => eng.confirm());
  $("#btnCancel").onclick = () => act(() => eng.cancel());
  $("#btnStart").onclick = () => act(() => eng.start());
  $("#btnPause").onclick = () => act(() => eng.pause());
  $("#btnFinish").onclick = () => act(() => eng.requestFinish());
  $("#btnQty").onclick = () => { const v = $("#inQty").value.trim(), n = Number(v); $("#inQty").value = ""; act(() => (/^\d+$/.test(v) && n >= 1 ? eng.addQty(n) : { ok: false, sound: "error", msg: "Bitte eine ganze Zahl ab 1 eingeben." })); };
  $("#btnCode").onclick = () => { const v = $("#inCode").value; $("#inCode").value = ""; act(() => eng.handleCode(v)); };
  $("#inCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnCode").click(); });
  $("#inQty").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnQty").click(); });
  $("#btnSearch").onclick = async () => { const p = await pickProduct(); if (p) act(() => eng.selectProduct(p)); };
  $("#pSearch").oninput = renderProducts; $("#pNew").onclick = () => productForm({ isNew: true });
  $("#pList").onclick = (e) => { const b = e.target.closest("[data-bc]"); if (b) productForm({ barcode: b.dataset.bc, isNew: false }); };
  $("#bSel").onchange = (e) => { bSel = +e.target.value; renderBestand(); }; $("#bSearch").oninput = renderBestand;
  $("#fileImp").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onImportFile(f); };
  $("#impOut").onclick = (e) => { if (e.target.id === "impGo") doImport(); };
  $("#eList").onclick = (e) => { const b = e.target.closest("[data-x]"); if (b) exportErfassung(+b.dataset.x); };
  $("#v-mehr").onclick = async (e) => {
    const id = e.target.id;
    if (id === "mPdf") {
      const s = { modW: +$("#sMod").value || 0.21, barH: +$("#sH").value || 7.3 };
      try { await db.setSetting("sheet", s); await deliver(buildCommandSheet(s), "Befehlsblatt_Lagererfassung.pdf"); } catch (err) { feedback({ ok: false, sound: "error", msg: "Fehler beim PDF-Export: " + err.message }); }
    }
    if (id === "mBackup") makeBackup();
    if (id === "aTest") { unlock(); sound("scan"); setTimeout(() => sound("confirm"), 400); setTimeout(() => sound("cancel"), 1000); setTimeout(() => sound("error"), 1500); }
  };
  $("#v-mehr").oninput = (e) => { if (e.target.id === "aMute") prefs.muted = e.target.checked; if (e.target.id === "aVol") prefs.volume = +e.target.value; savePrefs(); };
  $("#v-mehr").onchange = (e) => { if (e.target.id === "mRestore") { const f = e.target.files[0]; e.target.value = ""; if (f) restore(f); } };
  try {
    await db.open(); await eng.init();
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  } catch (e) { $("#expect").textContent = "Speicher nicht verfügbar: " + (e.message || e) + " (Privates Surfen aus? Genug Speicherplatz frei?)"; return; }
  setTab("Erfassen"); render();
  if (eng.notice) showMsg(eng.notice, "err", 0);
  else { const last = await db.getSetting("lastBackup"); if ((await db.getAllErfassungen()).length && (!last || Date.now() - new Date(last) > 7 * 864e5)) showMsg("Hinweis: Letzte Datensicherung älter als 7 Tage (Mehr → Datensicherung).", "info", 10000); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
main();
