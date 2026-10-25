// Procedural sound. M3 only has the strike hit; engine and music arrive in M4.
// The AudioContext is created on the first user gesture (browsers require one).

let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

function noiseBuffer(c: AudioContext, secs: number) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = 0.6 * last + 0.4 * (Math.random() * 2 - 1); // a little brown: crunchier than white
    d[i] = last;
  }
  return b;
}

/** Crunch and thump; a rail bridge adds a steel clang. `speed` is km/h. */
export function playStrike(kind: 'concrete' | 'rail', speed: number) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const c = ctx, t = c.currentTime, k = Math.min(1, 0.35 + speed / 90);
    const out = c.createGain();
    out.gain.value = 0.9 * k;
    out.connect(c.destination);

    // crunch: filtered noise, fast attack, long rubble tail
    const n = c.createBufferSource();
    n.buffer = noiseBuffer(c, 2.2);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 1.6);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(1.0, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.25, t + 0.25);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    n.connect(lp).connect(ng).connect(out);
    n.start(t);

    // thump: a falling sine
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(1.2, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.8);

    if (kind === 'rail') {
      // clang: inharmonic partials of a struck girder
      for (const [f, a, d] of [[212, 0.35, 2.4], [497, 0.22, 1.8], [883, 0.14, 1.2], [1361, 0.08, 0.8]]) {
        const p = c.createOscillator();
        p.type = 'triangle';
        p.frequency.value = f;
        const pg = c.createGain();
        pg.gain.setValueAtTime(a, t);
        pg.gain.exponentialRampToValueAtTime(0.0001, t + d);
        p.connect(pg).connect(out);
        p.start(t);
        p.stop(t + d + 0.05);
      }
    }
  } catch { /* ignore */ }
}
