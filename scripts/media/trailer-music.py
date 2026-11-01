"""Synthesizes the trailer score, scored to the cuts in scripts/media/trailer.mjs.

Procedural stand-in (no music model available): 132 BPM trucker rock in E. Plucked
strings are Karplus-Strong, drums are synthesized, the brass is filtered saws.

  0.0  title          big chord + twang riff
  2.5  hopper bins    train-beat groove, boom-chicka bass, lead riff
 12.5  dusk run       minor tension: palm-muted chug, ticking hats, riser
 17.2  IMPACT         crash, music cuts
 18.0  replay        low drone, timpani rolls; sad trombone on the replayed hit (20.3)
 22.05 chopper cam    drone continues, second hit (23.2)
 24.2  bill card      honky-tonk piano tag
 28.25 title          riff and the ending chord

Run: python3 -I scripts/media/trailer-music.py out.wav [duration]
"""
import sys
import wave
import numpy as np

SR = 44100
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 30.77
BPM = 132
BEAT = 60 / BPM
rng = np.random.default_rng(1905)
L = np.zeros(int(SR * (DUR + 2)))
R = np.zeros_like(L)

IMPACT, REPLAY, REPLAY_HIT, CHOPPER, CHOPPER_HIT, CARD, TITLE2 = 17.2, 18.0, 20.3, 22.05, 23.2, 24.2, 28.25


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= len(L):
        return
    sig = sig[: len(L) - i]
    L[i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 + pan))


def env(n, a=0.005, d=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)


def pluck(f, secs, bright=0.5, decay=0.996):
    """Karplus-Strong, computed a period at a time at 4x the sample rate (so the
    integer period keeps high notes in tune), then averaged back down."""
    OS = 4
    n = int(secs * SR) * OS
    # the loop filter averages samples OS apart (the same damping as at 1x) and adds
    # OS/2 samples of delay, so take that off the period
    p = max(OS + 2, int(round(SR * OS / f - OS / 2)))
    buf = rng.uniform(-1, 1, p)
    # soften the excitation for less brightness
    for _ in range(int((1 - bright) * 4)):
        buf = 0.5 * (buf + np.roll(buf, 1))
    out = np.empty(n + p)
    out[:p] = buf
    k = p
    while k < n + p:
        prev = out[k - p:k]
        nxt = decay * 0.5 * (prev + np.concatenate((out[k - p - OS:k - p], prev[:-OS])) if k - p - OS >= 0 else prev + np.roll(prev, OS))
        m = min(p, n + p - k)
        out[k:k + m] = nxt[:m]
        k += m
    y = out[p:].reshape(-1, OS).mean(axis=1)
    return y * env(len(y), 0.001, secs * 0.6)


def slap(sig, delay=0.11, g=0.35):
    out = np.zeros(len(sig) + int(delay * SR))
    out[:len(sig)] += sig
    out[int(delay * SR):] += sig * g
    return out


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 80 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def snare(gain=1.0):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    noise = noise - np.concatenate(([0], noise[:-1])) * 0.85  # brighten
    return gain * (0.7 * noise * np.exp(-t * 18) + 0.4 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25))


def brush():
    # a soft swish: lowpassed noise, slow attack
    n = int(0.1 * SR)
    t = np.arange(n) / SR
    x = rng.uniform(-1, 1, n)
    x = 0.5 * (x + np.concatenate(([0], x[:-1])))
    return x * np.minimum(1, t / 0.01) * np.exp(-t * 30)


def hat(open_=False):
    n = int((0.25 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    x = rng.uniform(-1, 1, n)
    x = x - np.concatenate(([0], x[:-1]))
    return x * np.exp(-t * (10 if open_ else 70)) * 0.35


def crash_cym(secs=2.5):
    n = int(secs * SR)
    t = np.arange(n) / SR
    x = rng.uniform(-1, 1, n)
    x = x - np.concatenate(([0], x[:-1])) * 0.9
    return x * np.exp(-t * 1.6) * 0.5


def saw(f, secs, cutoff=0.15, vib=0.0):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ff = f * (1 + vib * np.sin(2 * np.pi * 5.5 * t)) if np.isscalar(f) else f
    ph = np.cumsum(np.broadcast_to(ff, t.shape)) / SR
    x = 2 * (ph % 1) - 1
    # one-pole lowpass
    y = np.empty_like(x)
    acc = 0.0
    a = cutoff
    for i in range(0, n, 256):
        seg = x[i:i + 256]
        out = np.empty_like(seg)
        for j, v in enumerate(seg):
            acc += a * (v - acc)
            out[j] = acc
        y[i:i + 256] = out
    return y


def piano(f, secs):
    n = int(secs * SR)
    t = np.arange(n) / SR
    tone = sum((0.6 / k) * np.sin(2 * np.pi * f * k * t) for k in (1, 2, 3, 4))
    tone2 = sum((0.6 / k) * np.sin(2 * np.pi * f * 1.004 * k * t) for k in (1, 2, 3))  # honky-tonk detune
    return (tone + tone2) * env(n, 0.002, 0.45)


def impact(secs=2.2):
    n = int(secs * SR)
    t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    lp = np.empty(n)
    acc = 0.0
    cut = 0.25 * np.exp(-t * 2) + 0.02
    for i in range(n):
        acc += cut[i] * (noise[i] - acc)
        lp[i] = acc
    boom = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-t * 4) + 28) / SR) * np.exp(-t * 3)
    return 1.6 * lp * np.exp(-t * 1.8) + 1.2 * boom


def riser(secs):
    n = int(secs * SR)
    t = np.arange(n) / SR
    x = rng.uniform(-1, 1, n)
    y = np.empty(n)
    acc = 0.0
    cut = 0.01 + 0.3 * (t / secs) ** 2
    for i in range(n):
        acc += cut[i] * (x[i] - acc)
        y[i] = acc
    return y * (t / secs) ** 2 * 0.6


E, A, B = 40, 45, 47  # E2, A2, B2 roots
MAJ = (0, 4, 7, 12)
MIN = (0, 3, 7, 12)


def chord_strum(root, quality, t, secs, gain=0.12, muted=False):
    for k, iv in enumerate(quality):
        f = midi(root + 12 + iv)
        add(pluck(f, 0.12 if muted else secs, 0.4 if muted else 0.6, 0.99 if muted else 0.997), t + k * 0.012, gain, 0.3 - 0.15 * k)


def groove(t0, t1, prog, minor=False, drums=True, lead=None):
    """Train-beat bar loop from t0 to t1 over a 4-bar chord progression."""
    t = t0
    bar = 0
    while t < t1 - 0.01:
        root = prog[bar % len(prog)]
        q = MIN if minor else MAJ
        for b in range(4):
            tb = t + b * BEAT
            if tb >= t1:
                break
            # boom-chicka: bass on beats, muted strum on the offbeats
            bass_n = root if b % 2 == 0 else root + 7
            add(pluck(midi(bass_n), BEAT * 0.9, 0.3, 0.99), tb, 0.6, -0.1)
            chord_strum(root, q, tb + BEAT / 2, BEAT / 2, 0.09, muted=True)
            if drums:
                if b % 2 == 0:
                    add(kick(), tb, 0.55)
                else:
                    add(snare(0.45), tb, 1.0, 0.1)
                for s in range(4):  # train beat: sixteenth brushes
                    add(brush(), tb + s * BEAT / 4, 0.05 if s % 2 else 0.09, 0.2)
                add(hat(), tb + BEAT / 2, 0.45, 0.4)
        t += 4 * BEAT
        bar += 1


# --- 0.0 title: big E chord, cymbal, twang riff ---------------------------------
add(crash_cym(), 0.0, 0.8)
add(kick(), 0.0, 1.0)
chord_strum(E, MAJ, 0.0, 2.2, 0.22)
riff = [(64, 0), (67, 1), (68, 1.5), (71, 2), (68, 3), (64, 3.5)]  # E G G# B G# E (in beats)
for n, b in riff:
    add(slap(pluck(midi(n), 0.5, 0.8, 0.998)), 0.25 + b * BEAT, 0.3, -0.25)

# --- 2.5 hopper bins: the groove, with the lead riff on top ---------------------
add(crash_cym(1.5), 2.5, 0.5)
groove(2.5, 12.5, [E, E, A, B])
lead = [(76, 0), (74, 0.5), (71, 1), (69, 1.5), (71, 2), (64, 3), (67, 4), (68, 4.5), (71, 5), (74, 6), (76, 6.5), (71, 7)]
for rep in range(4):
    base = 2.5 + rep * 8 * BEAT
    for n, b in lead:
        tt = base + b * BEAT
        if tt < 12.3:
            add(slap(pluck(midi(n), 0.4, 0.85, 0.998)), tt, 0.22, -0.3)

# --- 12.5 dusk run: minor, chugging, a riser into the hit -----------------------
groove(12.5, IMPACT, [E, E, 48, 47], minor=True)  # Em Em C B
add(riser(IMPACT - 13.0), 13.0, 0.9)
for k in range(int((IMPACT - 12.5) / (BEAT / 2))):
    add(hat(), 12.5 + k * BEAT / 2, 0.5, -0.4)  # ticking clock

# --- 17.2 IMPACT ------------------------------------------------------------------
add(impact(), IMPACT, 1.0)
add(crash_cym(3.0), IMPACT, 0.9)

# --- 18.0 replay: drone + timpani; sad trombone on the replayed hit ---------------
drone_secs = CARD - REPLAY
n = int(drone_secs * SR)
t = np.arange(n) / SR
drone = (np.sin(2 * np.pi * midi(28) * t) + 0.5 * np.sin(2 * np.pi * midi(35) * t + 0.3)) * np.minimum(1, t / 0.8) * np.minimum(1, (drone_secs - t) / 0.5)
add(drone, REPLAY, 0.32)
for k in range(10):
    add(kick(), REPLAY_HIT - 1.2 + k * 0.12, 0.25 + 0.05 * k)  # timpani roll into the hit
add(impact(1.5), REPLAY_HIT, 0.5)
# wah, wah, wah, waaaaah
for k, (note, secs) in enumerate([(58, 0.45), (57, 0.45), (56, 0.45), (55, 1.4)]):
    f0 = midi(note)
    nn = int(secs * SR)
    tt = np.arange(nn) / SR
    f = f0 * (1 - (0.03 * tt / secs if k == 3 else 0)) * (1 + (0.012 * np.sin(2 * np.pi * 6 * tt) if k == 3 else 0))
    tone = saw(f, secs, 0.08) * env(nn, 0.04, secs * (2 if k == 3 else 0.7))
    add(tone, REPLAY_HIT + 0.3 + k * 0.5, 0.5, 0.2)
add(impact(1.2), CHOPPER_HIT, 0.4)
add(crash_cym(2.0), CHOPPER_HIT, 0.5)

# --- 24.2 bill card: honky-tonk piano tag -----------------------------------------
tag = [(E, MAJ), (A, MAJ), (E, MAJ), (B, MAJ)]
for k, (root, q) in enumerate(tag):
    tb = CARD + k * 2 * BEAT
    for b in range(2):
        add(piano(midi(root + 12), BEAT), tb + b * BEAT, 0.18, -0.2)
        for iv in q[1:]:
            add(piano(midi(root + 24 + iv), BEAT / 2), tb + b * BEAT + BEAT / 2, 0.08, 0.2)
    add(kick(), tb, 0.4)
    add(snare(0.4), tb + BEAT, 0.6)
lick = [76, 74, 71, 69, 68, 66, 64]
for k, n in enumerate(lick):
    add(piano(midi(n), 0.3), CARD + 8 * BEAT + k * BEAT / 2, 0.16, 0.1)

# --- 28.25 title: riff and the ending chord ----------------------------------------
for n, b in riff:
    add(slap(pluck(midi(n), 0.5, 0.8, 0.998)), TITLE2 + b * BEAT * 0.75, 0.3, -0.25)
END = TITLE2 + 2.0
add(kick(), END, 1.0)
add(crash_cym(2.5), END, 0.8)
chord_strum(E, MAJ, END, 2.5, 0.25)
add(piano(midi(52), 2.0), END, 0.2)

# --- master: soft clip, fade, write ------------------------------------------------
mix = np.stack([L, R], axis=1)[: int(DUR * SR)]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.6) / np.tanh(1.6)
fade = int(0.4 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
pcm = (mix * 0.9 * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(sys.argv[1], f'{DUR:.2f} s')
