// Zustandssteuerung der Erfassung – unabhängig von Oberfläche und Datenbank-Technik.
export const QTYS = [1, 5, 10, 15, 20, 24, 30, 35];
export const CMD = { INVENTORY_CONFIRM: "confirm", INVENTORY_CANCEL: "cancel", INVENTORY_START: "start", INVENTORY_PAUSE: "pause", INVENTORY_FINISH: "finish" };
QTYS.forEach((q) => (CMD["INVENTORY_QTY_" + q] = q));
const MAX_TOTAL = 1000000;
const R = (ok, msg, sound, extra) => ({ ok, msg, sound: sound || (ok ? "scan" : "error"), ...extra });
const label = (p) => p.name || p.barcode;

export class Engine {
  constructor(db) { Object.assign(this, { db, erf: null, product: null, qty: 0, parts: [], confirmed: false, recent: [], notice: "", names: new Map() }); }

  async init() {
    this.erf = await this.db.getOpenErfassung();
    const p = await this.db.getSetting("pending");
    if (p && p.qty > 0) this.notice = `Beim letzten Schließen war eine unbestätigte Menge offen (${p.qty} Stück, Barcode ${p.barcode}). Sie wurde verworfen und NICHT gebucht.`;
    if (p) await this.db.setSetting("pending", null);
    await this.refreshRecent();
  }
  get state() {
    const e = this.erf;
    if (!e) return "none"; if (e.status === "abgeschlossen") return "finished"; if (e.status === "unterbrochen") return "paused";
    if (this.product) return this.qty > 0 ? "qty" : "product";
    return this.confirmed ? "confirmed" : "expect_product";
  }
  get active() { return !!this.erf && this.erf.status === "aktiv"; }
  inactiveMsg() {
    const s = this.erf && this.erf.status;
    return s === "unterbrochen" ? "Erfassung ist unterbrochen – zuerst „Fortsetzen“ drücken." : "Keine aktive Erfassung – zuerst „Erfass. Start“ drücken.";
  }
  reset() { this.product = null; this.qty = 0; this.parts = []; }
  async savePending() {
    try { await this.db.setSetting("pending", this.qty > 0 && this.product ? { erfId: this.erf.id, barcode: this.product.barcode, qty: this.qty } : null); } catch {}
  }
  async refreshRecent() {
    this.recent = [];
    if (!this.erf) return;
    const rows = await this.db.getRecent(this.erf.id, 3);
    for (const r of rows) {
      let p = this.names.get(r.barcode); if (p === undefined) { p = await this.db.getProduct(r.barcode); this.names.set(r.barcode, p); }
      this.recent.push({ name: p ? label(p) : r.barcode, menge: r.menge, zeit: r.zeit });
    }
  }
  async lookup(code) {
    this.names.delete(code);
    return (await this.db.getProduct(code)) || (code.length === 12 && (await this.db.getProduct("0" + code))) ||
      (code.length === 13 && code[0] === "0" && (await this.db.getProduct(code.slice(1)))) || null;
  }

  /** Einziger Eingang für gescannte oder manuell eingegebene Codes. */
  async handleCode(raw) {
    const code = String(raw ?? "").trim();
    if (!code) return R(false, "Leerer Code.");
    if (code.startsWith("INVENTORY_")) {
      const c = CMD[code];
      if (c === undefined) return R(false, `Unbekannter Befehlscode: ${code}`);
      if (typeof c === "number") return this.addQty(c);
      return this[{ confirm: "confirm", cancel: "cancel", start: "start", pause: "pause", finish: "requestFinish" }[c]]();
    }
    return this.scanProduct(code);
  }
  async scanProduct(code) {
    if (!this.active) return R(false, this.inactiveMsg());
    if (this.qty > 0) return R(false, `Offene Menge (${this.qty}) vorhanden – zuerst bestätigen oder abbrechen. Neuer Barcode wurde nicht übernommen.`);
    const p = await this.lookup(code);
    if (!p) return R(false, `Unbekannter Barcode ${code} – Produkt bitte anlegen.`, "error", { unknown: code });
    return this.selectProduct(p);
  }
  selectProduct(p) {
    if (!this.active) return R(false, this.inactiveMsg());
    if (this.qty > 0) return R(false, `Offene Menge (${this.qty}) vorhanden – zuerst bestätigen oder abbrechen.`);
    this.product = p; this.qty = 0; this.parts = []; this.confirmed = false;
    this.names.set(p.barcode, p);
    return R(true, `Produkt: ${label(p)}`);
  }
  async addQty(n) {
    if (!this.active) return R(false, this.inactiveMsg());
    if (!this.product) return R(false, "Kein Produkt ausgewählt – zuerst Produktbarcode scannen.");
    if (!Number.isInteger(n) || n < 1) return R(false, "Menge muss eine ganze Zahl ab 1 sein.");
    if (this.qty + n > MAX_TOTAL) return R(false, "Menge zu groß.");
    this.qty += n; this.parts.push(n); this.confirmed = false;
    await this.savePending();
    return R(true, `+${n} → vorläufig ${this.qty}`);
  }
  async confirm() {
    if (!this.active) return R(false, this.inactiveMsg());
    if (!this.product) return R(false, "Bestätigen nicht möglich: kein Produkt ausgewählt.");
    if (this.qty <= 0) return R(false, "Bestätigen nicht möglich: Menge ist 0.");
    const { product, qty } = this; let total;
    try { total = await this.db.book(this.erf.id, product.barcode, qty); }
    catch (e) { return R(false, "Speicherfehler – Menge wurde NICHT gebucht, sie bleibt offen. " + (e.message === "NOT_ACTIVE" ? "Erfassung ist nicht aktiv." : e.message || "")); }
    this.reset(); this.confirmed = true;
    await this.savePending(); await this.refreshRecent();
    return R(true, `Gebucht: ${qty} × ${label(product)} (Summe ${total})`, "confirm");
  }
  /** Schnellzählung: jeder gescannte Artikel wird sofort mit +1 gebucht (kein Bestätigen). */
  async quickCount(raw) {
    const code = String(raw ?? "").trim();
    if (!code) return R(false, "Leerer Code.");
    if (!this.active) return R(false, this.inactiveMsg());
    if (code.startsWith("INVENTORY_")) return R(false, "Befehlscodes gelten nur im Reiter „Erfassen“. Hier bitte nur Artikel scannen.");
    const p = await this.lookup(code);
    if (!p) return R(false, `Unbekannter Barcode ${code} – Produkt bitte anlegen.`, "error", { unknown: code, quick: true });
    return this.quickBook(p);
  }
  async quickBook(p) {
    if (!this.active) return R(false, this.inactiveMsg());
    let total;
    try { total = await this.db.book(this.erf.id, p.barcode, 1); }
    catch (e) { return R(false, "Speicherfehler – NICHT gezählt. " + (e.message === "NOT_ACTIVE" ? "Erfassung ist nicht aktiv." : e.message || "")); }
    this.lastQuick = p; this.names.set(p.barcode, p);
    await this.refreshRecent();
    return R(true, `+1 ${label(p)} (Summe ${total})`, "scan", { total });
  }
  /** Nimmt die letzte Schnellzählung als Gegenbuchung (−1) zurück; das Protokoll bleibt vollständig. */
  async undoQuick() {
    if (!this.active) return R(false, this.inactiveMsg());
    const p = this.lastQuick; if (!p) return R(false, "Nichts zum Zurücknehmen.");
    const b = (await this.db.getBestand(this.erf.id)).find((x) => x.barcode === p.barcode);
    if (!b || b.gesamt < 1) return R(false, "Zurücknehmen nicht möglich: Bestand dieses Artikels ist 0.");
    let total;
    try { total = await this.db.book(this.erf.id, p.barcode, -1); } catch (e) { return R(false, "Speicherfehler – nichts geändert. " + (e.message || "")); }
    this.lastQuick = null; await this.refreshRecent();
    return R(true, `Zurückgenommen: −1 ${label(p)} (Summe ${total})`, "cancel", { total });
  }
  async cancel() {
    if (!this.active) return R(false, this.inactiveMsg());
    if (this.qty > 0) { const q = this.qty; this.qty = 0; this.parts = []; await this.savePending(); return R(true, `Abgebrochen: ${q} Stück verworfen (nichts gebucht).`, "cancel"); }
    if (this.product) { this.reset(); return R(true, "Produktauswahl aufgehoben.", "cancel"); }
    return R(false, "Abbruch: es gibt nichts abzubrechen.");
  }
  async start() {
    try {
      const { erf, resumed } = await this.db.startOrResume();
      this.erf = erf; this.reset(); this.confirmed = false; await this.refreshRecent();
      return R(true, resumed ? `Erfassung Nr. ${erf.id} fortgesetzt.` : `Neue Erfassung Nr. ${erf.id} gestartet.`);
    } catch (e) { return R(false, e.message === "ALREADY_ACTIVE" ? "Es läuft bereits eine aktive Erfassung." : "Speicherfehler: " + e.message); }
  }
  async pause() {
    if (!this.active) return R(false, this.inactiveMsg());
    const verworfen = this.qty;
    try { this.erf = await this.db.setStatus(this.erf.id, "unterbrochen"); } catch (e) { return R(false, "Speicherfehler: " + e.message); }
    this.reset(); this.confirmed = false; await this.savePending();
    return R(true, "Erfassung unterbrochen." + (verworfen ? ` Offene Menge (${verworfen}) verworfen.` : ""), "cancel");
  }
  async requestFinish() {
    if (!this.erf || this.erf.status === "abgeschlossen") return R(false, "Keine Erfassung zum Abschließen.");
    if (this.qty > 0) return R(false, `Abschließen nicht möglich: offene Menge (${this.qty}) – zuerst bestätigen oder abbrechen.`);
    return R(true, "Erfassung abschließen?", "scan", { ask: "finish" });
  }
  async finish() {
    if (!this.erf || this.erf.status === "abgeschlossen") return R(false, "Keine Erfassung zum Abschließen.");
    if (this.qty > 0) return R(false, `Abschließen nicht möglich: offene Menge (${this.qty}).`);
    try { this.erf = await this.db.setStatus(this.erf.id, "abgeschlossen"); } catch (e) { return R(false, "Speicherfehler: " + e.message); }
    this.reset(); this.confirmed = false; await this.savePending();
    return R(true, `Erfassung Nr. ${this.erf.id} abgeschlossen und archiviert.`, "confirm", { finished: this.erf });
  }
}
