// Töne über Web Audio. iOS erlaubt Ton erst nach einer Berührung → unlock() bei jedem Tippen.
let ctx = null;
const load = () => { try { return { muted: false, volume: 0.6, ...JSON.parse(localStorage.getItem("audio") || "{}") }; } catch { return { muted: false, volume: 0.6 }; } };
export const prefs = load();
export const savePrefs = () => { try { localStorage.setItem("audio", JSON.stringify(prefs)); } catch {} };
export function unlock() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state !== "running") ctx.resume(); } catch {}
}
function tone(freq, at, dur, type = "sine") {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at, v = Math.max(0.0001, prefs.volume);
  o.type = type; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
const PLAN = {
  scan: [[1400, 0, 0.09]], confirm: [[1100, 0, 0.11], [1700, 0.14, 0.14]],
  cancel: [[260, 0, 0.22, "triangle"]], error: [[200, 0, 0.7, "sawtooth"]],
};
/** Gibt false zurück, wenn kein Ton möglich war (visuelle Rückmeldung bleibt immer). */
export function sound(kind) {
  if (prefs.muted || !ctx || ctx.state !== "running") return false;
  try { (PLAN[kind] || []).forEach(([f, a, d, ty]) => tone(f, a, d, ty)); return true; } catch { return false; }
}
