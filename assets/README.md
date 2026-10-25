# Asset pipeline

Every visual asset is generated fresh and goes through the same repeatable steps.

1. **Concept sheets** (`assets/concepts/`): fal `fal-ai/nano-banana-pro`, 2K, prompts in
   `scripts/assets/concept-prompts.json`, job ids in `assets/concepts/manifest.json`.
2. **3D input views** (`assets/views/`): one clean 3/4 view per asset, made from the
   approved sheet with `fal-ai/nano-banana-pro/edit` (or a crop of the sheet).
3. **Image-to-3D**: `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, PBR on, ~150k faces.
   It beat Rodin 2.5 on the tractor (`assets/turntables/tractor-hunyuan-vs-rodin.jpg`).
   Raw GLBs live in `assets/raw/models/` (gitignored; re-download from the job ids in
   `assets/models/manifest.json`).
4. **Import**: `npm run assets:import [name ...]` reads `assets/models/manifest.json` and
   writes `public/models/<name>.glb` plus `assets/models/bounds-report.json`:
   transforms baked, forward -z, optional auto-align and per-axis proportion fix,
   scaled to real metres, origin on the ground (or hub for wheels), wheels cut out and
   replaced by `wheel_*` pivot nodes, named parts split out, decimated to budget,
   textures to webp, meshopt-compressed. Dimension checks against real sizes are in the
   report (`checks`).
5. **Turntables**: `npm run assets:turntable -- <glb> <png> [label] [z0,z1,y0,y1]`
   renders a 4-view sheet on a 1 m grid, or an orthographic side window on a 0.5 m grid
   for reading hub positions. `scripts/assets/probe-axles.mjs` finds axles from tire
   ground contacts.

Procedural on purpose: overpass decks, girders and piers (per-lane clearances must match
physics exactly), plates and hazard boards (canvas-drawn numbers), and the trailer's rear
bogie and hydraulic rams (they animate for the lowering gag).

Overpass textures (`public/textures/`, 1024 px webp; 2K originals in `assets/raw/textures/`):
`concrete.webp` (job 01a17149-fbee-7043-b592-dd284498a049) and `rail-steel.webp`
(job 01a17149-fc67-7ea2-a911-f8652c122299), both `fal-ai/nano-banana-pro`, prompted as seamless
tiles. Normal and roughness maps are derived in code in M1.

### M3 scenery and ground (`scripts/assets/m3-prompts.json`)

Eight `fal-ai/nano-banana-pro` 2K images: four seamless ground tiles (asphalt, gravel,
grass, wheat stubble) and four cutouts on white (single tree, shelterbelt row, farmyard,
Saskatoon skyline). `python3 -I scripts/assets/process-m3.py` turns the raw PNGs in
`assets/raw/m3/` into `public/textures/*.webp`:

- tiles resized to 768 px (gravel 512), webp q66;
- cutouts keyed to alpha by distance from the backdrop (per row, interpolated between
  the left and right margins, so a studio gradient keys as cleanly as flat white; the
  skyline uses the flat top-corner colour so its haze fades out softly), white
  un-premultiplied from the edges, trimmed and resized.

Normal maps for every tile are derived at load time from luminance with a wrapping
Sobel filter (`normalFromTexture` in `src/sim/world.ts`), so they cost no bytes.
The grain bins are procedural instanced cylinders; everything else in the countryside
is placed from a fixed seed in `src/sim/scenery.ts`.
