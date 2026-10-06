// Tiny 8-bit sound effects with WebAudio (no audio files needed).
let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }
export function soundOn() { return enabled; }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'square', vol = 0.06) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(vol, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start); o.stop(a.currentTime + start + dur + 0.02);
}

export const sfx = {
  select() { if (enabled) tone(660, 0, 0.06); },
  start() { if (enabled) [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.12)); },
  coin() { if (enabled) { tone(988, 0, 0.07); tone(1319, 0.07, 0.18); } },
  hurt() { if (enabled) { tone(220, 0, 0.12, 'sawtooth'); tone(150, 0.1, 0.18, 'sawtooth'); } },
  roll() { if (enabled) for (let i = 0; i < 6; i++) tone(300 + Math.random() * 500, i * 0.05, 0.04); },
  win() { if (enabled) [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.16, 'triangle', 0.09)); },
  lose() { if (enabled) [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.2, 'triangle', 0.08)); },
};
