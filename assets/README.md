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
