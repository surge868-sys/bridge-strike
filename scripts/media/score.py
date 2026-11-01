"""BRIDGE STRIKE! score: one arrangement, played by sampled instruments.

Writes MIDI and renders it with fluidsynth and the FluidR3 General MIDI soundfont
(MIT licence; `apt-get install fluidsynth fluid-soundfont-gm`). 132 BPM trucker rock in E:
clean twang lead, muted and steel-string rhythm guitars, finger bass, a train beat,
honky-tonk piano, brass stabs, tremolo strings and timpani for the drama, and a trombone
for the replay.

  python3 -I scripts/media/score.py trailer OUT.wav [seconds]   # scored to the trailer cuts
  python3 -I scripts/media/score.py loops OUTDIR                # theme / cruise / tension loops

Loops are rendered twice through and the second pass is kept, so each one is seamless
(the first pass's ringing tails are already in it). cruise and tension share a length
and bar grid so the game can crossfade them in sync.
"""
import os
import random
import struct
import subprocess
import sys
import tempfile
import wave

SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
BPM = 132
BEAT = 60 / BPM
BAR = 4 * BEAT
PPQ = 480
TPS = PPQ / BEAT  # ticks per second
random.seed(1905)

# channels and General MIDI programs (0-based)
LEAD, MUTED, STEEL, BASS, PIANO, BRASS, STRINGS, TIMP, TBONE, HIT, DRUMS, CHUG = 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 9, 11
PROGRAMS = {LEAD: 27, MUTED: 28, STEEL: 25, BASS: 33, PIANO: 3, BRASS: 61, STRINGS: 44, TIMP: 47, TBONE: 57, HIT: 55, CHUG: 29}
KICK, SNARE, SIDE, HAT, OHAT, CRASH, RIDE, TOM_L, TOM_H, REV = 36, 38, 37, 42, 46, 49, 51, 45, 50, 0
E, A, B, C, G, D = 40, 45, 47, 48, 43, 50
MAJ, MIN = (0, 4, 7), (0, 3, 7)


class Score:
    def __init__(self):
        self.ev = []  # (seconds, order, bytes)

    def note(self, ch, n, t, dur, vel=90, human=True):
        if human:
            t += random.uniform(-0.006, 0.006)
            vel = max(1, min(127, vel + random.randint(-7, 7)))
        t = max(0.0, t)
        self.ev.append((t, 1, bytes([0x90 | ch, n, vel])))
        self.ev.append((t + dur, 0, bytes([0x80 | ch, n, 0])))

    def bend(self, ch, t, semis):  # default bend range is +/-2 semitones
        v = int(max(0, min(16383, 8192 + semis / 2 * 8191)))
        self.ev.append((t, 0, bytes([0xE0 | ch, v & 0x7F, v >> 7])))

    def cc(self, ch, t, num, val):
        self.ev.append((t, 0, bytes([0xB0 | ch, num, val])))

    def write(self, path):
        head = [(0.0, -1, bytes([0xFF, 0x51, 0x03]) + int(BEAT * 1e6).to_bytes(3, 'big'))]
        for ch, prog in PROGRAMS.items():
            head.append((0.0, -1, bytes([0xC0 | ch, prog])))
            head.append((0.0, -1, bytes([0xB0 | ch, 91, 50])))  # reverb send
        head.append((0.0, -1, bytes([0xB0 | CHUG, 7, 80])))
        data = b''
        last = 0
        for t, _, msg in sorted(head + self.ev, key=lambda e: (e[0], e[1])):
            tick = int(round(t * TPS))
            data += vlq(tick - last) + msg
            last = tick
        data += b'\x00\xFF\x2F\x00'
        with open(path, 'wb') as f:
            f.write(b'MThd' + struct.pack('>IHHH', 6, 0, 1, PPQ))
            f.write(b'MTrk' + struct.pack('>I', len(data)) + data)


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


# --- parts -------------------------------------------------------------------------

def strum(s, ch, root, q, t, dur, vel, up=False, octave=12):
    notes = [root + octave + q[0], root + octave + q[1], root + octave + q[2], root + octave + 12]
    if up:
        notes = notes[::-1]
    for k, n in enumerate(notes):
        s.note(ch, n, t + k * 0.012, dur, vel - k * 4)


def train_beat(s, t, bars, intensity=1.0, fill=True):
    for bar in range(bars):
        tb = t + bar * BAR
        for b in range(4):
            x = tb + b * BEAT
            s.note(DRUMS, KICK, x, 0.1, int(100 * intensity) if b % 2 == 0 else int(70 * intensity))
            for e in range(4):  # sixteenth snare shuffle, accent on 2 and 4
                accent = (b % 2 == 1 and e == 0)
                s.note(DRUMS, SNARE, x + e * BEAT / 4, 0.05, int((105 if accent else (52 if e % 2 else 66)) * intensity))
            s.note(DRUMS, HAT, x + BEAT / 2, 0.05, int(60 * intensity))
        if fill and bar % 4 == 3:  # tom fill into the next phrase
            for k, n in enumerate([TOM_H, TOM_H, TOM_L, TOM_L]):
                s.note(DRUMS, n, tb + 3 * BEAT + k * BEAT / 4, 0.1, int(95 * intensity))


def boom_chicka(s, t, prog, minor=False, steel=True):
    """Bass on 1 and 3 (root, fifth), a walk-up into each change, muted chicka on 2 and 4."""
    q = MIN if minor else MAJ
    for bar, root in enumerate(prog):
        tb = t + bar * BAR
        nxt = prog[(bar + 1) % len(prog)]
        s.note(BASS, root, tb, BEAT * 0.9, 100)
        s.note(BASS, root + 7, tb + 2 * BEAT, BEAT * 0.9, 92)
        if nxt != root:  # walk up into the next chord
            s.note(BASS, nxt - 2, tb + 3 * BEAT, BEAT * 0.45, 84)
            s.note(BASS, nxt - 1, tb + 3.5 * BEAT, BEAT * 0.45, 88)
        else:
            s.note(BASS, root + 12, tb + 3 * BEAT, BEAT * 0.9, 80)
        for b in (1, 3):
            strum(s, MUTED, root, q, tb + b * BEAT, 0.14, 78, octave=12)
        if steel:  # D . D U . U D U
            for b, up, v in [(0, False, 70), (1, False, 58), (1.5, True, 50), (2.5, True, 52), (3, False, 60), (3.5, True, 50)]:
                strum(s, STEEL, root, q, tb + b * BEAT, BEAT * 0.9, v, up=up, octave=24)


def lead_line(s, t, phrase, vel=96):
    """Twang lead: (midi, beat, length-in-beats, grace) with hammer-on grace notes."""
    for n, b, ln, grace in phrase:
        x = t + b * BEAT
        if grace:
            s.note(LEAD, n - 2, x - 0.05, 0.05, vel - 15)
        s.note(LEAD, n, x, ln * BEAT, vel)


RIFF = [(64, 0, 0.5, False), (67, 0.5, 0.5, True), (68, 1, 0.5, False), (71, 1.5, 1, False), (68, 2.5, 0.5, False), (64, 3, 1, False)]
LEAD_A = [(76, 0, 0.5, True), (74, 0.5, 0.5, False), (71, 1, 0.5, False), (69, 1.5, 0.5, False), (71, 2, 1, True), (64, 3, 1, False),
          (67, 4, 0.5, False), (68, 4.5, 0.5, True), (71, 5, 1, False), (74, 6, 0.5, False), (76, 6.5, 0.5, True), (71, 7, 1, False)]
LEAD_B = [(81, 0, 1, True), (80, 1, 0.5, False), (78, 1.5, 0.5, False), (76, 2, 1, False), (73, 3, 1, True),
          (71, 4, 0.5, False), (73, 4.5, 0.5, False), (76, 5, 1, True), (75, 6, 0.5, False), (71, 6.5, 1.5, False)]


def brass_stab(s, root, t, vel=100):
    for iv in (12, 16, 19, 24):
        s.note(BRASS, root + iv, t, 0.25, vel)


def tension(s, t, bars):
    """Em . C B: palm-muted chug, tremolo strings, ticking hats, kick on the beat."""
    prog = [E, E, C, B] * (bars // 4)
    for bar, root in enumerate(prog):
        tb = t + bar * BAR
        for e in range(8):
            s.note(CHUG, root, tb + e * BEAT / 2, 0.1, 96 if e % 2 == 0 else 80)
            s.note(CHUG, root + 7, tb + e * BEAT / 2, 0.1, 84 if e % 2 == 0 else 70)
            s.note(DRUMS, SIDE, tb + e * BEAT / 2, 0.05, 62)
        for b in range(4):
            s.note(DRUMS, KICK, tb + b * BEAT, 0.1, 92)
        s.note(STRINGS, root + 12, tb, BAR, 72)
        s.note(STRINGS, root + 19, tb, BAR, 64)
        s.note(BASS, root, tb, BAR * 0.95, 96)
        if bar % 4 == 3:
            s.note(DRUMS, SNARE, tb + 3.5 * BEAT, 0.05, 100)
            s.note(DRUMS, SNARE, tb + 3.75 * BEAT, 0.05, 110)


def honky_tonk_tag(s, t):
    for k, root in enumerate([E, A, E, B]):
        tb = t + k * 2 * BEAT
        for b in range(2):
            s.note(PIANO, root + 12, tb + b * BEAT, BEAT * 0.5, 90)
            for iv in MAJ:
                s.note(PIANO, root + 24 + iv, tb + b * BEAT + BEAT / 2, BEAT * 0.4, 72)
        s.note(DRUMS, KICK, tb, 0.1, 80)
        s.note(DRUMS, SNARE, tb + BEAT, 0.05, 90)
    for k, n in enumerate([76, 74, 71, 69, 68, 66, 64]):
        s.note(PIANO, n, t + 8 * BEAT + k * BEAT / 2, BEAT * 0.45, 92)
        s.note(PIANO, n + 12, t + 8 * BEAT + k * BEAT / 2, BEAT * 0.45, 70)


def hit(s, t, big=True):
    s.note(HIT, E + 12, t, 0.6, 120)
    s.note(HIT, E + 24, t, 0.6, 110)
    s.note(DRUMS, CRASH, t, 1.5, 127)
    s.note(DRUMS, KICK, t, 0.2, 127)
    s.note(TIMP, E, t, 1.2, 127)
    if big:
        s.note(DRUMS, 57, t, 1.5, 120)  # second crash


def sad_trombone(s, t):
    for k, (n, ln) in enumerate([(58, 0.42), (57, 0.42), (56, 0.42), (55, 1.5)]):
        x = t + k * 0.5
        s.note(TBONE, n, x, ln, 104, human=False)
        if k == 3:  # the long one wobbles and droops
            steps = 40
            for i in range(steps):
                tt = x + 0.15 + i * (ln - 0.15) / steps
                s.bend(TBONE, tt, 0.25 * __import__('math').sin(i * 0.9) - 0.6 * i / steps)
            s.bend(TBONE, x + ln + 0.05, 0)


def timp_roll(s, t, secs, n=E):
    k = 0
    while k * 0.07 < secs:
        s.note(TIMP, n, t + k * 0.07, 0.08, int(50 + 60 * k * 0.07 / secs), human=False)
        k += 1


# --- arrangements --------------------------------------------------------------------

def trailer(dur):
    IMPACT, REPLAY, REPLAY_HIT, CHOPPER_HIT, CARD, TITLE2 = 17.2, 18.0, 20.3, 23.2, 24.2, 28.25
    s = Score()
    # 0.0 title: brass stab, big chord, the riff
    brass_stab(s, E, 0.0, 112)
    s.note(DRUMS, CRASH, 0.0, 1.5, 120)
    s.note(DRUMS, KICK, 0.0, 0.2, 120)
    strum(s, STEEL, E, MAJ, 0.0, 2.2, 96, octave=24)
    lead_line(s, 0.35, RIFF)
    # 2.5 groove with the lead
    g0 = 2.5
    bars = int((12.5 - g0) / BAR + 0.5)
    s.note(DRUMS, CRASH, g0, 1.2, 105)
    train_beat(s, g0, bars)
    boom_chicka(s, g0, ([E, E, A, B] * 4)[:bars])
    lead_line(s, g0 + 0 * BAR, LEAD_A)
    lead_line(s, g0 + 2 * BAR, LEAD_B)
    lead_line(s, g0 + 4 * BAR, LEAD_A, 100)
    # 12.5 dusk: tension until the impact
    tension(s, 12.5, 4)
    for x in [13.0 + k * BEAT for k in range(int((IMPACT - 13.0) / BEAT))]:
        s.note(DRUMS, OHAT, x + BEAT / 2, 0.1, 50)
    timp_roll(s, IMPACT - 1.6, 1.5)
    s.ev = [e for e in s.ev if e[0] < IMPACT - 0.02 or e[2][0] & 0xF0 == 0x80]
    for ch in list(PROGRAMS) + [DRUMS]:  # everything stops dead
        s.cc(ch, IMPACT - 0.015, 120, 0)
    hit(s, IMPACT)
    # 18.0 replay: low strings and a timpani roll; trombone on the replayed hit
    for n in (E - 12 + 12, E + 7):
        s.note(STRINGS, n, REPLAY, CARD - REPLAY - 0.2, 70)
    timp_roll(s, REPLAY_HIT - 1.3, 1.25)
    hit(s, REPLAY_HIT, big=False)
    sad_trombone(s, REPLAY_HIT + 0.35)
    timp_roll(s, CHOPPER_HIT - 0.8, 0.75, n=B - 12)
    hit(s, CHOPPER_HIT, big=False)
    # 24.2 bill: honky-tonk tag
    honky_tonk_tag(s, CARD)
    # 28.25 title: riff and the ending
    lead_line(s, TITLE2, RIFF, 104)
    end = TITLE2 + 2.0
    brass_stab(s, E, end, 115)
    s.note(DRUMS, CRASH, end, 2.0, 120)
    s.note(DRUMS, KICK, end, 0.2, 120)
    strum(s, STEEL, E, MAJ, end, 2.5, 100, octave=24)
    s.note(BASS, E, end, 2.5, 110)
    s.note(PIANO, E + 24, end, 2.0, 96)
    return s


def loop_score(kind, bars):
    """Two passes of the loop; the render keeps the second."""
    s = Score()
    for p in range(2):
        t0 = p * bars * BAR
        if kind == 'cruise':
            train_beat(s, t0, bars)
            boom_chicka(s, t0, [E, E, A, B] * (bars // 4))
            for k, phrase in enumerate([LEAD_A, LEAD_B, LEAD_A, None]):
                if phrase:
                    lead_line(s, t0 + k * 4 * BAR, phrase, 92)
            s.note(DRUMS, CRASH, t0, 1.2, 96)
        elif kind == 'tension':
            tension(s, t0, bars)
            for k in range(bars * 4):
                s.note(DRUMS, OHAT, t0 + k * BEAT + BEAT / 2, 0.1, 46)
        elif kind == 'theme':
            brass_stab(s, E, t0, 104)
            s.note(DRUMS, CRASH, t0, 1.2, 105)
            lead_line(s, t0 + 0.0, RIFF, 100)
            train_beat(s, t0 + BAR, bars - 1, 0.9)
            boom_chicka(s, t0 + BAR, ([E, A, E, B] * 2)[: bars - 1])
            honky_tonk_tag(s, t0 + 3 * BAR)
    return s


def render(score, wav_out, keep_from=0.0, keep_secs=None):
    with tempfile.TemporaryDirectory() as tmp:
        mid = os.path.join(tmp, 'score.mid')
        raw = os.path.join(tmp, 'raw.wav')
        score.write(mid)
        subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.7', '-r', '44100', '-F', raw, SF2, mid], check=True, stdout=subprocess.DEVNULL)
        with wave.open(raw) as w:
            frames = w.readframes(w.getnframes())
            ch, sw, sr = w.getnchannels(), w.getsampwidth(), w.getframerate()
    bpf = ch * sw
    a = int(keep_from * sr) * bpf
    b = len(frames) if keep_secs is None else a + int(round(keep_secs * sr)) * bpf
    frames = frames[a:b]
    if keep_secs is not None and len(frames) < int(round(keep_secs * sr)) * bpf:
        frames += b'\x00' * (int(round(keep_secs * sr)) * bpf - len(frames))
    with wave.open(wav_out, 'wb') as w:
        w.setnchannels(ch)
        w.setsampwidth(sw)
        w.setframerate(sr)
        w.writeframes(frames)


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'trailer':
        dur = float(sys.argv[3]) if len(sys.argv) > 3 else 30.77
        render(trailer(dur), sys.argv[2], 0.0, dur)
        print(sys.argv[2], f'{dur:.2f} s')
    elif mode == 'loops':
        out = sys.argv[2]
        os.makedirs(out, exist_ok=True)
        for kind, bars in [('theme', 8), ('cruise', 16), ('tension', 16)]:
            secs = bars * BAR
            render(loop_score(kind, bars), os.path.join(out, f'{kind}.wav'), secs, secs)
            print(f'{kind}: {bars} bars, {secs:.3f} s')
