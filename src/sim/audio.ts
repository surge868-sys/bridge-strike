// Procedural sound plus the music player. The AudioContext is created on the
// first user gesture (browsers require one). Everything goes through a master
// gain that M mutes.
import { loadBytes } from './assets';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfx: GainNode | null = null;
let musicBus: GainNode | null = null;
let muted = false;
const listeners: (() => void)[] = [];

export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.55;
      musicBus.connect(master);
      for (const f of listeners.splice(0)) f();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

/** Run `f` once audio exists (now, or after the first gesture). */
function whenReady(f: () => void) {
  if (ctx) f(); else listeners.push(f);
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;
export const audioState = () => ctx?.state ?? 'none';

function noiseBuffer(c: AudioContext, secs: number, brown = 0.6) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = brown * last + (1 - brown) * (Math.random() * 2 - 1);
    d[i] = last * (1 + brown);
  }
  return b;
}

function loopNoise(c: AudioContext, brown: number) {
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 2, brown);
  n.loop = true;
  n.start();
  return n;
}

// --- engine ----------------------------------------------------------------

// Ten-speed box: the top of each gear in km/h. RPM climbs 1100 -> 1800 through
// each gear, then the next gear drops it back.
const GEAR_TOPS = [7, 13, 19, 26, 34, 43, 53, 64, 77, 101];

export interface EngineInput { speedKmh: number; throttle: number; brake: number; jake: boolean; running: boolean }

export class Engine {
  rpm = 650;
  gear = 0;
  private nodes: null | {
    f0: OscillatorNode; f1: OscillatorNode; lp: BiquadFilterNode; eng: GainNode;
    rumble: GainNode; tire: GainNode; tireBp: BiquadFilterNode;
    jake: GainNode; jakeOsc: OscillatorNode; jakeAm: GainNode;
  } = null;
  private lastBrake = 0;
  private brakeHeld = 0;

  constructor() {
    whenReady(() => this.build());
  }

  private build() {
    const c = ctx!;
    const out = c.createGain();
    out.gain.value = 0.8;
    out.connect(sfx!);
    // Diesel tone: firing-frequency saw + a square an octave up, through a lowpass
    // that opens with throttle, then a soft clipper for grit.
    const f0 = c.createOscillator(); f0.type = 'sawtooth';
    const f1 = c.createOscillator(); f1.type = 'square';
    const g1 = c.createGain(); g1.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    const eng = c.createGain(); eng.gain.value = 0;
    f0.connect(lp); f1.connect(g1).connect(lp);
    lp.connect(shaper).connect(eng).connect(out);
    // Low rumble under it
    const rn = loopNoise(c, 0.97);
    const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 140;
    const rumble = c.createGain(); rumble.gain.value = 0;
    rn.connect(rlp).connect(rumble).connect(out);
    // Tires on asphalt
    const tn = loopNoise(c, 0.3);
    const tireBp = c.createBiquadFilter(); tireBp.type = 'bandpass'; tireBp.Q.value = 0.8; tireBp.frequency.value = 500;
    const tire = c.createGain(); tire.gain.value = 0;
    tn.connect(tireBp).connect(tire).connect(out);
    // Jake brake: the famous staccato. A saw at firing frequency, chopped by an
    // amplitude LFO and pushed through a bright bandpass.
    const jakeOsc = c.createOscillator(); jakeOsc.type = 'sawtooth';
    const jakeBp = c.createBiquadFilter(); jakeBp.type = 'bandpass'; jakeBp.frequency.value = 700; jakeBp.Q.value = 1.2;
    const jakeAm = c.createGain(); jakeAm.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(jakeAm.gain);
    const jake = c.createGain(); jake.gain.value = 0;
    jakeOsc.connect(jakeBp).connect(jakeAm).connect(jake).connect(out);
    for (const o of [f0, f1, jakeOsc, lfo]) o.start();
    this.nodes = { f0, f1, lp, eng, rumble, tire, tireBp, jake, jakeOsc, jakeAm };
  }

  update(i: EngineInput, dt: number) {
    const v = Math.abs(i.speedKmh);
    // gear and rpm
    let g = GEAR_TOPS.findIndex((top) => v < top);
    if (g < 0) g = GEAR_TOPS.length - 1;
    const lo = g === 0 ? 0 : GEAR_TOPS[g - 1], hi = GEAR_TOPS[g];
    let target = v < 1.5 && i.throttle === 0 ? 650 : 1100 + 700 * Math.min(1, (v - lo) / (hi - lo));
    if (i.jake && v > 3) target = Math.max(target, 1700); // the jake holds revs up
    if (!i.running) target = 0;
    this.gear = g;
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target < this.rpm ? 5 : 8));

    // air brakes: a hiss when a held brake is released
    if (i.running && this.lastBrake > 0 && i.brake === 0 && this.brakeHeld > 0.4) airHiss();
    this.brakeHeld = i.brake > 0 ? this.brakeHeld + dt : 0;
    this.lastBrake = i.brake;

    const n = this.nodes;
    if (!n || !ctx) return;
    const t = ctx.currentTime, k = 0.06;
    const fire = Math.max(1, this.rpm / 20); // six cylinders, four-stroke
    n.f0.frequency.setTargetAtTime(fire, t, k);
    n.f1.frequency.setTargetAtTime(fire * 2, t, k);
    n.jakeOsc.frequency.setTargetAtTime(fire, t, k);
    const load = i.running ? i.throttle : 0;
    n.lp.frequency.setTargetAtTime(220 + load * 900 + this.rpm * 0.15, t, k);
    const on = i.running ? 1 : 0;
    const jakeOn = i.running && i.jake && v > 3 ? 1 : 0;
    n.eng.gain.setTargetAtTime(on * (0.1 + load * 0.16) * (1 - jakeOn * 0.6), t, 0.08);
    n.rumble.gain.setTargetAtTime(on * (0.25 + load * 0.3), t, 0.1);
    n.tire.gain.setTargetAtTime(Math.min(0.22, v / 400), t, 0.1);
    n.tireBp.frequency.setTargetAtTime(300 + v * 6, t, 0.2);
    n.jake.gain.setTargetAtTime(jakeOn * 0.32, t, 0.04);
  }
}

function airHiss() {
  if (!ctx || !sfx) return;
  try {
    const c = ctx, t = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = noiseBuffer(c, 1, 0);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(hp).connect(g).connect(sfx);
    n.start(t);
  } catch { /* ignore */ }
}

// --- strike ------------------------------------------------------------------

/** Crunch and thump; a rail bridge adds a steel clang. `speed` is km/h. */
export function playStrike(kind: 'concrete' | 'rail', speed: number) {
  if (!ctx || !sfx || ctx.state !== 'running') return;
  try {
    const c = ctx, t = c.currentTime, k = Math.min(1, 0.35 + speed / 90);
    const out = c.createGain();
    out.gain.value = 0.9 * k;
    out.connect(sfx);

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

// --- music -------------------------------------------------------------------

// Three looping tracks, dropped in as public/music/<id>.mp3 (see docs/MUSIC.md).
// Missing files are fine: that layer just stays silent.
export type TrackId = 'theme' | 'cruise' | 'tension';
export const TRACKS: TrackId[] = ['theme', 'cruise', 'tension'];

export class Music {
  private layers = new Map<TrackId, { gain: GainNode; src: AudioBufferSourceNode }>();
  private want: Record<TrackId, number> = { theme: 0, cruise: 0, tension: 0 };
  loaded: TrackId[] = [];

  constructor() {
    whenReady(() => void this.load());
  }

  private async load() {
    const c = ctx!;
    // tracks.json lists the tracks present: ids, or {id, loop} with the exact loop
    // length in seconds (the game's own loops from scripts/media/score.py).
    let listed: (string | { id: string; loop?: number })[] = [];
    try { listed = JSON.parse(new TextDecoder().decode(await loadBytes('music/tracks.json'))); } catch { return; }
    const decoded: { id: TrackId; buf: AudioBuffer; loop?: number }[] = [];
    for (const entry of listed) {
      const id = (typeof entry === 'string' ? entry : entry.id) as TrackId;
      if (!TRACKS.includes(id)) continue;
      try {
        const buf = await c.decodeAudioData(await loadBytes(`music/${id}.mp3`));
        decoded.push({ id, buf, loop: typeof entry === 'string' ? undefined : entry.loop });
      } catch { /* track not supplied */ }
    }
    // Start every layer on the same clock so cruise and tension stay on the beat.
    const t0 = c.currentTime + 0.1;
    for (const { id, buf, loop } of decoded) {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(musicBus!);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      if (loop && loop < buf.duration) {
        // A decoder that keeps the MP3 encoder's priming adds ~25 ms up front.
        src.loopStart = Math.min(buf.duration - loop, 0.026);
        src.loopEnd = src.loopStart + loop;
      }
      src.connect(gain);
      src.start(t0, src.loopStart);
      this.layers.set(id, { gain, src });
      this.loaded.push(id);
    }
    this.apply();
  }

  /** Target mix, 0..1 per layer; crossfades over about a second. */
  mix(m: Partial<Record<TrackId, number>>) {
    let changed = false;
    for (const id of TRACKS) {
      const v = m[id] ?? 0;
      if (Math.abs(v - this.want[id]) > 1e-3) { this.want[id] = v; changed = true; }
    }
    if (changed) this.apply();
  }

  private apply() {
    if (!ctx) return;
    for (const [id, l] of this.layers) l.gain.gain.setTargetAtTime(this.want[id], ctx.currentTime, 0.4);
  }
}
