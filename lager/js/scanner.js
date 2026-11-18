// Kamera-Scanner (ZXing, läuft lokal). Erkennt Code 128, EAN/UPC, Code 39, ITF und QR.
export class Scanner {
  constructor(video, onCode) { this.video = video; this.onCode = onCode; this.running = false; this.last = { code: "", accepted: 0, seen: 0 }; }
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
    this.running = true; this.last = { code: "", accepted: 0, seen: 0 }; this.loop();
  }
  stop() {
    this.running = false; clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null; this.video.srcObject = null;
  }
  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const s = Math.min(1, 1280 / v.videoWidth); this.canvas.width = Math.round(v.videoWidth * s); this.canvas.height = Math.round(v.videoHeight * s);
      this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      try {
        const bmp = new this.Z.BinaryBitmap(new this.Z.HybridBinarizer(new this.Z.HTMLCanvasElementLuminanceSource(this.canvas)));
        this.accept(this.reader.decode(bmp).getText(), Date.now());
      } catch { /* kein Code im Bild */ }
    }
    this.timer = setTimeout(() => this.loop(), 90);
  }
  /** Scan-Sperre: derselbe Code zählt erst wieder, wenn er ≥0,7 s aus dem Bild war und ≥1,2 s seit der letzten Annahme vergangen sind. */
  accept(code, now) {
    const l = this.last, same = code === l.code;
    const ok = !same ? now - l.accepted > 350 : now - l.seen > 700 && now - l.accepted > 1200;
    l.seen = now;
    if (!ok) return;
    l.code = code; l.accepted = now; this.onCode(code);
  }
}
