# BRIDGE STRIKE! — build plan (draft for approval)

Status: plan approved Oct 25. Decisions: dedicated new repo; load 5 = twin hopper-bottom bins (5.35 m / 5.05 m lowered); clearances and heights approved as below; waiting for the Krea and fal hosts to be allowlisted before M0.

---

## 1. What the research found

Sources: CBC, CTV, Global News, CKOM, SaskToday, CJWW, Saskatoon Police releases (Mar–Sep 2026). Real place names only. No real companies, drivers, officials or outlets go in the game.

| # | Date | Load (reported) | Structure | What I confirmed |
|---|------|-----------------|-----------|------------------|
| 1 | Thu Mar 5 | Semi hauling a **Caterpillar track hoe** | Circle Drive / Highway 11 cloverleaf (Hwy 11 & 16 run together here) | Hwy 16 EB dropped to one lane. The **Hwy 16 overpass at Circle Drive is posted 4.7 m, the lowest in the city.** That matches overpass #1 on the route. |
| 2 | Wed Mar 11 | **Excavator**, "left in pieces along the highway" | **108th Street** over Circle Drive | **Posted 5.2 m.** Repair estimate **$350,000**. Debris on the Circle Dr NB lanes around 5 p.m. |
| 3 | Sun Mar 22 | **Heavy equipment** | **CPKC rail overpass** over Circle Drive, plus **McKercher Drive** | **Two different drivers.** The CPKC driver fled and was found in Martensville. **McKercher is still an unsolved hit-and-run.** One rail overpass above Circle Drive is posted about 5.4 m (it isn't clear which). |
| 4 | Fri Jul 24 | **Grain bin**, southbound | **51st Street** overpass | The bin came off the trailer and **wedged under the bridge**, blocking the merge lane for about 8 h. Called the city's "fifth strike this year". |
| 5 | Wed Sep 2 | **Not an air seeder.** CTV: **hopper-bottom grain bins**. A witness saw **two hoppers, one behind the other**: one hit, the other came off the back. Global: "agricultural equipment". | **CN rail bridge on Highway 16 near the Borden Bridge**, about 50 km NW of Saskatoon | Hwy 16 down to one lane. The height sign was right above the point of contact. Five charges. |

Other findings:
- **No real load heights were published**, so I'm using your gameplay heights (4.75 / 4.90 / 5.05 / 5.20 / 5.35 m).
- No posted clearance was published for 51st St or Idylwyld. Those values are gameplay values.
- Saskatoon requires a permit above 4.15 m. The province is moving to a 5.3 m standard bridge height. Both are useful for the How to Drive screen and the briefings.
- A 6th strike (Borden) and a 7th (Lorne Ave / Ruth St, mid-October) also happened. Per your brief, only the five above go in the game.
- The six overpasses don't sit on one real road: 108th, CPKC and McKercher are on Circle Drive East, and 51st and the CN rail bridge are on Idylwyld. The drive is a **composite "Highway 11 into the city" route** with real names. I'll say so in the credits.

## 2. Repo

`surge868-sys/webdev` is **not empty**. It is the Northern Digital agency site: 62 marketing screens, the client portal, Postgres, client reports, and a live Vercel project. Putting the game at `/` would replace that site. **This needs your call (question 1).** Everything below works the same whatever you choose.

## 3. Stack and layout

- Next.js 16.3 App Router, TypeScript, Tailwind v4, on Vercel. I'll read `node_modules/next/dist/docs/` before writing any Next code. The game page is a single client component that dynamically imports the sim, with no SSR for the canvas.
- `three` + `@dimforge/rapier3d-compat` (its wasm is already base64-inlined) + `meshoptimizer` decoder.
- Anton + Oswald as woff2 from `@fontsource/*` (OFL), self-hosted. The npm registry is reachable.
- `src/sim/`
  - `sim.ts`: loop (fixed 1/120 s with substeps and accumulator), cameras, HUD, input, test hooks
  - `physics.ts`: Rapier world, collision groups, raycast vehicle controllers, anti-roll, joint, strike events
  - `world.ts`: heightfield, road, shoulders, ditches, median, instancing, sky, lights, post stack
  - `rig.ts`: tractor and trailer bodies, wheel visuals, hydraulic lowering, load swap
  - `bridges.ts`: overpass builder, per-lane soffit heights, plates, deck and pier colliders
  - `audio.ts`: music bus with ducking, SFX, later synthesized engine
  - `loads.ts` / `ui/*`: dispatch data, cards, signs, chyron
- `scripts/assets/import-glb.mjs`, built on `@gltf-transform/*` + `meshoptimizer`: scale to metres, origin at ground, forward −z, re-pivot wheels on hubs, name parts, decimate, meshopt compress, write `bounds-report.json`
- `scripts/build-sim.mjs`: esbuild produces `dist/sim.html` with wasm, fonts, GLBs and audio inlined as base64. They're decoded with `atob` → `Uint8Array` → `GLTFLoader.parse` / `decodeAudioData`, with no `fetch(data:)` anywhere. Target size is under 12 MB (artifact limit 16 MB).

## 4. Gameplay numbers (proposed, please check)

Loads (top / lowered = −0.30 m):

| Load | Top | Lowered |
|------|-----|---------|
| 1 Track hoe | 4.75 | 4.45 |
| 2 Over-height excavator | 4.90 | 4.60 |
| 3 Heavy equipment | 5.05 | 4.75 |
| 4 Grain bin | 5.20 | 4.90 |
| 5 Twin hopper-bottom bins | 5.35 | 5.05 |

Posted clearance per lane, northbound (left / right lane). The deck has superelevation and sag, so lanes differ visibly:

| Overpass | Left | Right | Notes |
|----------|------|-------|-------|
| 1 Hwy 16 at Circle Dr | **4.70** | 5.10 | real 4.7 m posting on the low lane |
| 2 108th St | **5.20** | 4.95 | real 5.2 m on the high lane |
| 3 CPKC rail | **5.40** | 5.00 | steel through-girder variant |
| 4 McKercher Dr | 4.85 | 5.25 | |
| 5 51st St | 5.05 | 5.45 | |
| 6 CN rail at Idylwyld | 5.15 | 4.80 | steel variant |

This gives a difficulty curve. Load 1 only needs good lane choice, and lowering bails you out if you're stuck in a low lane. Load 5 needs the right lane *and* a hold at overpasses 1, 2, 4 and 6. Every load can be delivered, and every load can be struck. Chips: **FITS** (green) clears at full height, **LOWER IT** (amber) clears only lowered, **NO** (red) won't clear either way.

## 5. Physics

All per your spec, which is the source of truth. Implementation notes:
- Collision groups: ROAD, BRIDGE_DECK, BRIDGE_PIER, RIG_BODY, LOAD_ENVELOPE, BALLAST(none). Rig parts never collide with each other. The load envelope collides only with deck and pier, with COLLISION_EVENTS on.
- Ground raycasts use a filter predicate that excludes dynamic bodies and the BRIDGE_DECK group.
- Lowering is a ram animation of about 1.2 s. The envelope and load mesh move with `setTranslationWrtParent`, the ballast stays put, and the trailer body is unchanged.
- Calibration: after settle (around 1.5 s at rest), measure the envelope top versus the road raycast and offset it so the top equals the posted load height ±1 cm. It's logged in `__simDebug`.
- Steering lock: `maxLock(v) = min(lock0, atan(L·0.45g / v²))` with L = 6.4 m.
- Strike → slow-mo ×0.2 for 2 s → BRIDGE STRIKE! card with an itemised city repair bill. Roll is detected as trailer or tractor up-vector dot < 0.3 for more than 0.5 s → ROLLED IT!.

## 6. Assets

**Blocked right now:** `app-uploads.krea.ai`, `api.krea.ai`, `fal.media` and `v3.fal.media` all get a 403 from the environment proxy, and so does `cdn.jsdelivr.net`. Both connected accounts are ready (fal: ready; Krea: Pro, about 15.6k compute units). So I can *generate*, but I can't *download* results into the repo until those hosts are allowlisted (environment → Network access → Allowed domains, https://code.claude.com/docs/en/cloud-environments#network-access). Until then I can show you concept images as links and keep building with procedural stand-ins.

Pipeline:
1. **Concept sheets (text-to-image).** Each sheet is a clean orthographic side, front and 3/4 view on neutral grey, plus one golden-hour "hero" shot per asset. Model chosen with fal `recommend_model`, comparing a Krea image model on the tractor sheet first. I'll show you every sheet before any 3D spend.
2. **Image-to-3D, per job.** I'll trial **Hunyuan3D 3.1 Pro** (PBR, multi-view input, face-count control) against **Rodin 2.5** on the tractor and keep the winner for vehicles. Static props (bins, poles, piers) go on the cheaper tier, Tripo H3.1 or Hunyuan Rapid. I'll show a cost estimate before submitting.
3. **Wheels.** Generated meshes fuse the wheels into the body. The importer deletes triangles inside each wheel's hub cylinder at known axle positions and puts back one generated, instanced tire/rim model, pivoted on the hub. Steering and suspension then work properly.
4. **Overpass kit and roadside** are partly generated. Decks, girders and piers stay **procedural geometry with generated PBR textures**, because per-lane soffit heights have to match the physics exactly. Hazard boards and plates are canvas-drawn so the numbers are always correct.
5. **Tileable PBR textures** (asphalt, gravel, prairie grass, wheat stubble, concrete) come from text-to-image with a seamless prompt, with normal and roughness maps derived in-script.
6. **Turntable screenshots** of every imported model, plus a bounds report checked against real dimensions (6.4 m wheelbase, about 4.1 m tractor height, lowboy deck around 0.6 m).

## 7. UI, controls, audio

As specified: road-sign HUD with the green guide sign, white speed sign, yellow load sign and per-lane chips. Anton/Oswald fonts. Your logo on the title screen. How to Drive screen. Touch controls: steering wheel bottom-left, pedals bottom-right, a big LOWER LOAD hold button, plus CAM and JAKE. The FB/IG in-app browser gets edge-swipe blocking and an "open in browser" strip. Music starts on first tap, and audio is decoded from base64 bytes.

## 8. Verification (every milestone)

Playwright with Chromium at `/opt/pw-browsers/chromium` (swiftshader flags). Hooks: `__sim`, `__simInput`, `__simStep`, `__simPause`, `__simFrame`, `__simDebug`.
- Plate-reading bot delivers all five loads through all six overpasses.
- Negative bot: stays in the low lane without lowering, and must strike.
- Rollover test: a hard swerve at speed, and the rig must survive.
- Screenshots of every camera at desktop size and at phone size (390 CSS px, DPR 2.77), which I look at before reporting.

## 9. Milestones

As in your brief: M0 assets → M1 drivable → M2 loop → M3 look → M4 feel and comedy → M5 social. I stop after each one, commit and push, and publish `dist/sim.html` as an artifact.

Because downloads are blocked, M0 can only do the concept sheets until the hosts are allowlisted. If you want, I can start M1 with procedural stand-in models while you look at concepts. That changes the milestone order, so I'm asking rather than assuming.

## M0 outcome (Oct 25)

- Generator: concept sheets and 3D views on fal `nano-banana-pro`; 3D on Hunyuan3D 3.1 Pro (beat Rodin 2.5).
- Models in `public/models/` (6.3 MB total, all dimension checks pass, see `assets/models/bounds-report.json`):
  tractor 60k tris (wheelbase 6.40 m), trailer gooseneck + deck 40k, wheel 6.8k (instanced),
  loads 30–40k each, scaled so each load's top lands on its gameplay height on a 0.71 m deck.
- Changes from the plan: the trailer's rear bogie, fenders, tail and hydraulic rams are procedural
  (the generated running gear was asymmetric, and the rams must animate). Excavator (load 2) and
  loader (load 3) were re-posed lower because the first versions stood 6.3–6.5 m at real scale.
- Overpass kit: procedural geometry with generated concrete and rail-steel tile textures.

## M2 outcome (Oct 25)

- Route: six overpasses ~230 m apart (Hwy 16 at Circle Dr, 108th St, CPKC rail, McKercher Dr, 51st St, CN rail at Idylwyld) with the approved per-lane clearances, then delivery at the Saskatoon city limits. Rail crossings are steel through-girder spans.
- Dispatch sheet (date, heights, briefing, unlocked loads), LOAD DELIVERED card with run stats, strike card naming the bridge (rail bridges get their own bill), ROLLED IT! card. Unlocks persist per viewer in localStorage.
- Changes found in testing: anti-roll bars now scale with body mass and are damped (a lightly loaded trailer rocked itself into strikes); the grain bin is slimmed to 3.2 m so every load stays inside one 3.7 m lane.

## M3 outcome (Oct 25)

- **Ground**: one seamless terrain mesh out to ±3.2 km (dense by the road, geometric
  spacing toward the horizon). A field shader tiles quarter-mile cells into stubble,
  pasture and dark worked fallow, each with its own tint and row direction, grassy
  headlands and ditches, two-scale sampling against tiling, and Sobel-derived normal
  maps. Asphalt, gravel and median use the generated tiles; lane paint is a worn canvas
  overlay. Physics is unchanged (2 km heightfield; the route lives inside it).
- **Scenery**: about a thousand instanced shelterbelt cards along field lines and the
  right-of-way, single trees as crossed cards, 18 farmyards (camera-facing billboards
  with north and west shelterbelts and rows of procedural grain bins), lone bin sites on
  the horizon, solid grassed embankments at every overpass, and the Saskatoon skyline
  painted past the fog with a per-preset haze tint. Alpha-tested foliage casts shadows
  through `customDepthMaterial`.
- **Post**: MSAA half-float target → UnrealBloom → grade (lift, gain, saturation,
  vignette in linear HDR) → OutputPass (ACES, sRGB). Falls back to a direct render
  without WebGL2.
- **Time of day**: golden hour (default), midday and dusk. T cycles them, the dispatch
  sheet has a picker, and the choice is remembered. Each preset sets sun, sky, fog,
  hemisphere light and exposure, and rebuilds the PMREM environment. Dusk turns on the
  headlights (a following spot and emissive lenses that bloom).
- **Cockpit camera**: C cycles chase → cockpit → drone. The generated cab glass is opaque,
  so the "cockpit" view sits just ahead of the windscreen, 0.45 m above the hood on the
  driver's side, locked to the cab so it pitches and rolls with the tractor.
- **Budget**: about 0.95 MB of new textures; single-file build 14.7 MB (limit 16 MB).
- **Not done / known**: there's no cab interior (opaque generated glass). Farmyards are
  billboards, so they turn to face you. On phones the pixel ratio is capped at 1.75 to
  pay for the post stack, and frame rate on real phones hasn't been measured (CI runs
  swiftshader).
