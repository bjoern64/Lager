// Kamera-Scanner (ZXing, läuft lokal) im Einzel-Scan-Modus mit festem Scanfenster (ROI).
// Erkennt Code 128, EAN/UPC, Code 39, ITF und QR – aber nur NACH Druck auf „SCAN“ und nur im Scanfenster.

/** Scanfenster als Anteil des sichtbaren Kamerarahmens (mittig). Die Oberfläche zeichnet genau diesen Bereich. */
export const ROI = { x: 0.05, y: 0.19, w: 0.9, h: 0.62 };
export const SCAN_TIMEOUT_MS = 8000;

/** Rechnet das Scanfenster (Anteile des sichtbaren Rahmens, object-fit: cover) in Pixel des Videobildes um. */
export function roiToVideoRect(bw, bh, vw, vh, roi = ROI) {
  const scale = Math.max(bw / vw, bh / vh), visW = bw / scale, visH = bh / scale;
  const offX = (vw - visW) / 2, offY = (vh - visH) / 2;
  return { sx: offX + roi.x * visW, sy: offY + roi.y * visH, sw: roi.w * visW, sh: roi.h * visH };
}

export class Scanner {
  constructor(video, onCode, onTimeout, onState) {
    Object.assign(this, { video, onCode, onTimeout: onTimeout || (() => {}), onState: onState || (() => {}), running: false, armed: false });
  }
  async start() {
    const Z = window.ZXing;
    if (!Z) throw Object.assign(new Error("LIB_MISSING"), { name: "LIB_MISSING" });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("Kein Kamerazugriff"), { name: "NotFoundError" });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    try { await this.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch {}
    this.video.srcObject = this.stream; this.video.setAttribute("playsinline", ""); this.video.muted = true;
    await this.video.play();
    const F = Z.BarcodeFormat, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.CODE_128, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_39, F.ITF, F.QR_CODE]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    this.reader = new Z.MultiFormatReader(); this.reader.setHints(hints); this.Z = Z;
    this.canvas = document.createElement("canvas"); this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.running = true; this.armed = false; this.loop();
  }
  stop() {
    this.running = false; this.disarm(); clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null; this.video.srcObject = null;
  }
  /** „SCAN“ gedrückt: genau EIN Scanvorgang wird freigegeben. */
  arm() {
    if (!this.running) return false;
    clearTimeout(this.armTimer); this.armed = true; this.onState(true);
    this.armTimer = setTimeout(() => { if (this.armed) { this.disarm(); this.onTimeout(); } }, SCAN_TIMEOUT_MS);
    return true;
  }
  disarm() { clearTimeout(this.armTimer); if (this.armed) { this.armed = false; this.onState(false); } }
  /** Einziger Weg, einen Code zu übernehmen: nur wenn freigegeben, danach sofort gesperrt. */
  tryAccept(code) {
    if (!this.armed) return false;
    this.disarm(); this.onCode(code); return true;
  }
  loop() {
    if (!this.running) return;
    const v = this.video;
    // Ohne Freigabe wird das Kamerabild gar nicht erst analysiert.
    if (this.armed && v.readyState >= 2 && v.videoWidth) {
      const r = roiToVideoRect(v.clientWidth || v.videoWidth, v.clientHeight || v.videoHeight, v.videoWidth, v.videoHeight);
      const k = Math.min(1, 1280 / r.sw);
      this.canvas.width = Math.max(1, Math.round(r.sw * k)); this.canvas.height = Math.max(1, Math.round(r.sh * k));
      // Nur der Ausschnitt des Scanfensters wird auf die Zeichenfläche kopiert und analysiert.
      this.ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, this.canvas.width, this.canvas.height);
      try {
        const bmp = new this.Z.BinaryBitmap(new this.Z.HybridBinarizer(new this.Z.HTMLCanvasElementLuminanceSource(this.canvas)));
        this.tryAccept(this.reader.decode(bmp).getText());
      } catch { /* kein Code im Scanfenster */ }
    }
    this.timer = setTimeout(() => this.loop(), 90);
  }
}
