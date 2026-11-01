# BRIDGE STRIKE! music

The game and the trailer share one arrangement, `scripts/media/score.py`: 132 BPM
trucker rock in E written as MIDI and played by sampled instruments (fluidsynth with the
MIT-licensed FluidR3 General MIDI soundfont). Regenerate everything with:

```
apt-get install fluidsynth fluid-soundfont-gm   # once
python3 -I scripts/media/score.py loops /tmp/loops
for k in theme cruise tension; do ffmpeg -y -i /tmp/loops/$k.wav -ac 1 -b:a 56k public/music/$k.mp3; done
```

The loops are rendered twice through with the second pass kept, so they are seamless,
and `public/music/tracks.json` records each loop's exact length, which the player uses
for loop points. To replace them with produced tracks, use the Suno prompts below.

Three looping tracks. The game mixes them live:

| File | When it plays |
|---|---|
| `theme` | dispatch sheet, end cards, under the strike replay (ducked) |
| `cruise` | driving, open road |
| `tension` | crossfades in when the lane you're in won't fit the next overpass (within ~260 m), and out again when you fix it |

`cruise` and `tension` play in sync, so make them the **same tempo and key** and they
will layer. Each needs to loop cleanly at 40 seconds.

## Suno prompts

Paste each into Suno (custom mode, instrumental on). Generate a few takes and keep the
one that loops best.

**1. theme: "Bridge Strike!"**
> Style: high-energy prairie truck-stop country rock instrumental, twangy telecaster lead, honky-tonk piano, driving train-beat drums, slapback echo, big brassy stabs, comic swagger like a 70s trucker movie title theme, 132 BPM, key of E major, catchy 4-bar hook, loopable, no vocals
>
> Title: Bridge Strike!

**2. cruise: "Highway 11 Northbound"**
> Style: laid-back highway cruising country instrumental, steady boom-chicka rhythm guitar, warm pedal steel, walking bass, brushed snare, wide-open prairie feeling at golden hour, relaxed but rolling, 110 BPM, key of A major, even phrasing, no big intro or ending, loopable, no vocals
>
> Title: Highway 11 Northbound

**3. tension: "Low Clearance"**
> Style: tense comic suspense country instrumental, same groove family as a 110 BPM highway cruiser, palm-muted tremolo guitar, ticking hi-hat, low tom pulses, rising pedal steel swells, spaghetti-western whistle stabs, nervous and funny, 110 BPM, key of A minor, steady loop, no vocals
>
> Title: Low Clearance

## Importing

Download the three MP3s, then:

```
scripts/assets/import-music.sh theme.mp3 cruise.mp3 tension.mp3
npm run build:sim
```

The script trims each to 40 s with a short loop fade, makes it mono at 48 kbps (about
240 KB each, so the single-file artifact stays under 16 MB), and writes
`public/music/tracks.json`. Any track you leave out simply stays silent.
