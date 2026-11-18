// Lokale Datenhaltung: IndexedDB (App) und eine identische In-Memory-Variante (Tests).
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const now = () => new Date().toISOString();

export class IdbDb {
  async open() {
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open("lagererfassung", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("produkte", { keyPath: "barcode" });
        d.createObjectStore("erfassungen", { keyPath: "id", autoIncrement: true });
        d.createObjectStore("bestand", { keyPath: ["erfId", "barcode"] }).createIndex("erfId", "erfId");
        d.createObjectStore("buchungen", { keyPath: "id", autoIncrement: true }).createIndex("erfId", "erfId");
        d.createObjectStore("settings", { keyPath: "key" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this;
  }
  /** Eine Transaktion: alles oder nichts. */
  run(stores, mode, fn) {
    return new Promise((res, rej) => {
      let out, err; const t = this.db.transaction(stores, mode);
      t.oncomplete = () => (err ? rej(err) : res(out));
      t.onabort = () => rej(err || t.error || new Error("Speichern abgebrochen"));
      Promise.resolve(fn(t)).then((v) => { out = v; }, (e) => { err = e; try { t.abort(); } catch {} });
    });
  }
  getProduct(bc) { return this.run("produkte", "readonly", (t) => rq(t.objectStore("produkte").get(bc))); }
  getAllProducts() { return this.run("produkte", "readonly", (t) => rq(t.objectStore("produkte").getAll())); }
  putProduct(p) { return this.run("produkte", "readwrite", (t) => rq(t.objectStore("produkte").put(p))); }
  importProducts(list) { return this.run("produkte", "readwrite", (t) => { const s = t.objectStore("produkte"); list.forEach((p) => s.put({ barcode: p.barcode, name: p.name, kategorie: p.kategorie, variante: p.variante })); }); }

  getAllErfassungen() { return this.run("erfassungen", "readonly", (t) => rq(t.objectStore("erfassungen").getAll())); }
  async getOpenErfassung() { return (await this.getAllErfassungen()).find((e) => e.status !== "abgeschlossen") || null; }
  startOrResume() {
    return this.run("erfassungen", "readwrite", async (t) => {
      const s = t.objectStore("erfassungen"), open = (await rq(s.getAll())).find((e) => e.status !== "abgeschlossen");
      if (open) { if (open.status === "aktiv") throw new Error("ALREADY_ACTIVE"); open.status = "aktiv"; await rq(s.put(open)); return { erf: open, resumed: true }; }
      const e = { start: now(), end: null, status: "aktiv" }; e.id = await rq(s.add(e)); return { erf: e, resumed: false };
    });
  }
  setStatus(id, status) {
    return this.run("erfassungen", "readwrite", async (t) => {
      const s = t.objectStore("erfassungen"), e = await rq(s.get(id));
      if (!e) throw new Error("Erfassung nicht gefunden"); if (e.status === "abgeschlossen") throw new Error("CLOSED");
      e.status = status; if (status === "abgeschlossen") e.end = now(); await rq(s.put(e)); return e;
    });
  }
  /** Bestätigte Buchung: Protokoll + Gesamtmenge in EINER Transaktion. */
  book(erfId, barcode, menge) {
    return this.run(["erfassungen", "bestand", "buchungen"], "readwrite", async (t) => {
      const e = await rq(t.objectStore("erfassungen").get(erfId));
      if (!e || e.status !== "aktiv") throw new Error("NOT_ACTIVE");
      const bs = t.objectStore("bestand"), b = await rq(bs.get([erfId, barcode])), gesamt = (b ? b.gesamt : 0) + menge;
      await rq(bs.put({ erfId, barcode, gesamt }));
      await rq(t.objectStore("buchungen").add({ erfId, barcode, menge, zeit: now() }));
      return gesamt;
    });
  }
  getBestand(erfId) { return this.run("bestand", "readonly", (t) => rq(t.objectStore("bestand").index("erfId").getAll(erfId))); }
  async getRecent(erfId, n) {
    const all = await this.run("buchungen", "readonly", (t) => rq(t.objectStore("buchungen").index("erfId").getAll(erfId)));
    return all.sort((a, b) => b.id - a.id).slice(0, n);
  }
  async getSetting(k) { const r = await this.run("settings", "readonly", (t) => rq(t.objectStore("settings").get(k))); return r ? r.value : null; }
  setSetting(k, v) { return this.run("settings", "readwrite", (t) => rq(t.objectStore("settings").put({ key: k, value: v }))); }

  exportAll() {
    return this.run(["produkte", "erfassungen", "bestand", "buchungen"], "readonly", async (t) => ({
      format: "lager-backup", version: 1, exportiert: now(),
      produkte: await rq(t.objectStore("produkte").getAll()), erfassungen: await rq(t.objectStore("erfassungen").getAll()),
      bestand: await rq(t.objectStore("bestand").getAll()), buchungen: await rq(t.objectStore("buchungen").getAll()),
    }));
  }
  /** Ersetzt alle Daten atomar (bei Fehler bleibt der alte Stand unverändert). */
  restoreAll(d) {
    return this.run(["produkte", "erfassungen", "bestand", "buchungen"], "readwrite", (t) => {
      for (const [name, rows] of [["produkte", d.produkte], ["erfassungen", d.erfassungen], ["bestand", d.bestand], ["buchungen", d.buchungen]]) {
        const s = t.objectStore(name); s.clear(); rows.forEach((r) => s.put(r));
      }
    });
  }
}

export class MemDb {
  constructor() { this.p = new Map(); this.e = []; this.b = new Map(); this.bu = []; this.s = {}; this.fail = false; }
  async getProduct(bc) { return this.p.get(bc) || null; }
  async getAllProducts() { return [...this.p.values()]; }
  async putProduct(p) { this.p.set(p.barcode, { ...p }); }
  async importProducts(l) { l.forEach((p) => this.p.set(p.barcode, { barcode: p.barcode, name: p.name, kategorie: p.kategorie, variante: p.variante })); }
  async getAllErfassungen() { return this.e.map((e) => ({ ...e })); }
  async getOpenErfassung() { const e = this.e.find((x) => x.status !== "abgeschlossen"); return e ? { ...e } : null; }
  async startOrResume() {
    const open = this.e.find((x) => x.status !== "abgeschlossen");
    if (open) { if (open.status === "aktiv") throw new Error("ALREADY_ACTIVE"); open.status = "aktiv"; return { erf: { ...open }, resumed: true }; }
    const e = { id: this.e.length + 1, start: now(), end: null, status: "aktiv" }; this.e.push(e); return { erf: { ...e }, resumed: false };
  }
  async setStatus(id, status) {
    const e = this.e.find((x) => x.id === id); if (!e) throw new Error("Erfassung nicht gefunden"); if (e.status === "abgeschlossen") throw new Error("CLOSED");
    e.status = status; if (status === "abgeschlossen") e.end = now(); return { ...e };
  }
  async book(erfId, barcode, menge) {
    if (this.fail) throw new Error("Speicher voll (Test)");
    const e = this.e.find((x) => x.id === erfId); if (!e || e.status !== "aktiv") throw new Error("NOT_ACTIVE");
    const k = erfId + "|" + barcode, g = (this.b.get(k) || 0) + menge; this.b.set(k, g);
    this.bu.push({ id: this.bu.length + 1, erfId, barcode, menge, zeit: now() }); return g;
  }
  async getBestand(erfId) { return [...this.b].filter(([k]) => k.startsWith(erfId + "|")).map(([k, g]) => ({ erfId, barcode: k.slice(k.indexOf("|") + 1), gesamt: g })); }
  async getRecent(erfId, n) { return this.bu.filter((x) => x.erfId === erfId).sort((a, b) => b.id - a.id).slice(0, n); }
  async getSetting(k) { return this.s[k] ?? null; }
  async setSetting(k, v) { this.s[k] = v; }
}
