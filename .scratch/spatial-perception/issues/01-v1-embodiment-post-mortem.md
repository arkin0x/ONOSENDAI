# 01 — What made v1 embodied, and what made it floaty?

Type: research
Status: resolved
Blocked by: —

## Question

ONOSENDAI v1 achieved a sense of *being somewhere* that v2 has entirely lost.
It also failed at precision: it could not move a single gibson or reach an exact
point, and felt floaty and messy. Both halves are load-bearing for this map —
we need the first without reacquiring the second.

Establish the **mechanisms**, not the impressions. v1 is still readable at
`origin/master` in this repo:

- `src/tmp.FirstPersonControls.js`
- `src/components/Cyberspace/MovementControls.tsx`, `Controls.tsx`
- `src/components/Cyberspace/ThreeAvatar.tsx`, `ThreeAvatarTrail.tsx`
- `src/components/Map/MapControls.tsx`, `ThreeAvatarMarker.tsx`
- `src/store/AvatarStore.ts`, `ControlStore.ts`
- `package.json`: `@react-three/drei`, `@react-three/postprocessing`,
  `@react-spring/three`

Answer specifically:

1. **Camera and motion model.** Perspective or orthographic? FOV? What was the
   avatar's motion model — velocity, damping, inertia, spring? What made it feel
   floaty: the physics, the camera, the input mapping, or the lack of a stopping
   condition?
2. **What produced embodiment.** Which specific things created the sense of
   place: postprocessing effects, the trail, scale cues, the sky/void treatment,
   parallax, motion of the world versus motion of the camera? Name each and how
   it was done.
3. **Where precision died.** What in the design made it impossible to land on an
   exact coordinate? Was the position continuous rather than integral? Was there
   no cursor concept? Did the camera and the avatar share a transform?
4. **The two-mode precedent.** v1 had both a first-person Cyberspace view and a
   `Map` view with its own controls. What was each for, how did you move between
   them, and did that division work?
5. **What is worth stealing verbatim**, and what must not come back.

Deliverable: a written post-mortem in the ticket's Answer, concrete enough that
ticket 03 can build treatments from it. Include file/line references.

## Answer

All references are to `origin/master` (v1). Read with
`git show origin/master:<path>`.

### 1. Camera and motion model

**Camera: LOCAL (first-person Cyberspace) view.** The main `<Canvas>` at
`src/components/Cyberspace/CyberspaceViewer.tsx:42` passes **no** `camera` prop,
so it gets the react-three-fiber v8 default: `new THREE.PerspectiveCamera(75, 0,
0.1, 1000)` at `[0,0,5]` (r3f 8.16.2, `dist/events-*.esm.js`). The only override
is `camera.far = 2**30` at `src/components/Cyberspace/ThreeAvatar.tsx:25`. So:
**perspective, FOV 75, near 0.1, far 1,073,741,824.** `near` was never touched, giving
a near/far ratio of ~1e10 with no `logarithmicDepthBuffer` (the `<Canvas>` has no
`gl` prop anywhere in the repo).

The camera was **not parented to anything**. It was hard-set every frame in
`ThreeAvatar.tsx:38-45`:

```
const radius = 5
const cameraDirection = new THREE.Vector3(0,0,-1).applyQuaternion(rotation)
camera.position.copy(position.clone().add(cameraDirection.multiplyScalar(radius)))
camera.lookAt(position)
```

A rigid third-person chase at 5 units behind the avatar, zero smoothing, zero
lag, `copy()` not `lerp()`. Orientation came from `useRotationStore`
(`src/store/RotationStore.ts`), written by `Controls.tsx:247`.

Other views. SECTOR map: default camera, `far = 1e9`
(`Map/CyberspaceMap.tsx:34-41`), driven by drei `OrbitControls`
(`Map/CyberspaceMap.tsx:21`). GLOBAL: default camera at `[50,90,100]`,
`OrbitControls` targeting the avatar (`Global/CyberspaceGlobal.tsx:41,47`). HUD:
a **second, separate Canvas** with its own camera `{near:0.1, far:1000, fov:70}`
(`CyberspaceViewer.tsx:53`).

**Motion model.** There was no client-side physics at all. Position is
*re-derived from the nostr action chain every frame* by
`simulateNextEvent()` (`src/libraries/Cyberspace.ts:736-809`):

```
frames = Math.floor((now.ms_timestamp - actionTimestamp) / FRAME)   // :743, FRAME = 1000/60
if (action is A=drift) updatedVelocity = velocity + (0,0,2^(POW-10)).applyQuaternion(q)  // :762-771
updatedPosition = actionCoordinate + updatedVelocity * frames        // :776-777
```

That is the whole model. **No damping, no drag, no inertia term, no spring, no
mass.** Velocity is only ever *added* to. `DecimalVector3` arithmetic at
`Decimal.set({precision: 100})` (`src/libraries/DecimalVector3.ts:4`). The math
was exact; the model was just ballistic-in-vacuum.

**Input mapping.** `Controls.tsx:41-110`: WASD + Q/E (down/up), Space = freeze
(never wired), Escape = resetView. `Controls.tsx:251-278` builds a unit
`moveVector`, rotates it by the view quaternion, converts it to a quaternion via
`setFromUnitVectors((0,0,-1), moveVector)` and calls
`useEngineStore.drift(quaternion)`. Throttle is the **mouse wheel**, clamped
`0..128`, one click per integer (`Controls.tsx:173-175`). Throttle *is* the
proof-of-work target in bits (`Cyberspace.ts:685` writes it into the `nonce` tag;
`EngineStore.ts:129` reads it back as `targetPOW`), and it is *also* the velocity
exponent (`Cyberspace.ts:763`). Mouse look is drag-only (left button held,
`Controls.tsx:135-170`), sensitivity `0.003` rad/px; pointer lock exists but is
commented out (`Controls.tsx:193`).

**What made it floaty. Five mechanisms, in order of size:**

1. **No stopping condition, at all.** `stop()` (`EngineStore.ts:98-101`) only
   posts `{command:'stop'}` to the mining workers; it does not touch velocity.
   `freeze()` and `hop()` are `console.log` stubs shipped to production
   (`EngineStore.ts:86-96`), and the `freeze()` call site is commented out
   (`Controls.tsx:285-288`). Releasing W does nothing. You coast at constant
   velocity forever. Stopping required counter-thrusting to exactly cancel a
   power-of-two velocity vector in an arbitrary rotated frame.
   `ZERO_VELOCITY = 2^-10` exists (`Cyberspace.ts:16-17`, comment: "Avatar
   velocity Math.POW(2,-10) and below is rounded to zero") but is applied **only
   to the increment** (`Cyberspace.ts:764-767`), never to the accumulated
   velocity. The snap-to-rest rule the constant was written for was never
   implemented.
2. **Retroactive velocity.** The Δv of a mined drift action is applied from that
   action's *timestamp*, not from when it lands (`Cyberspace.ts:743` × `:776`).
   Mining takes ~2^throttle hashes across 9 workers
   (`src/libraries/WorkerManager.ts:46-51`). The instant the action is pushed to
   the store, position jumps by `Δv × (mining latency in frames)`. Mining latency
   converts directly into a teleport, and it grows with the same knob that
   controls speed.
3. **Nothing to be floaty against.** The only scenery in an empty sector is the
   sector wireframe: a cube of exactly `2^30` units
   (`SectorManager.tsx:112-126`), while the avatar is an icosahedron of radius
   0.5 (`src/data/AvatarModel.ts:3`). At throttle 10 (1 gibson/frame = 60 G/s)
   crossing one sector takes **207 days**. To cross a sector in ~10s you need
   throttle ≈ 31, i.e. 2^31 hashes per action. There is no speed that is both
   visible and controllable. This, not the physics, is the dominant cause of the
   floaty feeling.
4. **Unbounded pitch.** `Controls.tsx:160-163` carries the comment "Clamp pitch
   to avoid flipping" and then does not clamp. The horizon inverts.
   `src/tmp.FirstPersonControls.js:405`, which is dead code imported nowhere, *does*
   clamp to ±85°.
5. **React state as the per-frame transport.** `ThreeAvatar.tsx:33-35` calls
   `setPosition`/`setVelocity`/`setFrameSectorId` every frame; `Hud.tsx:88` calls
   `setForceUpdate({})` every frame. 60 full reconciliations/sec while 9 hashing
   workers saturate the CPU. The frame rate collapses exactly when you move.
   It also introduces a **one-frame camera/body desync**: the `useFrame` closure
   at `ThreeAvatar.tsx:42-44` positions the camera from the *previous* render's
   `position` while `:33` writes the new one that `<group position={position}>`
   (`:69`) will render with.

Bonus: the one in-world speed indicator was dead. `ThreeAvatar.tsx:58` calls
`velocity.normalize()`, which mutates the state `Vector3` in place; `:62` then
reads `velocity.length()`, now always 1, so `coneLength` (`:63`) is pinned at
0.8 and the cone never indicated speed.

### 2. What produced embodiment

**Bloom, and almost nothing else, is the look.** `CyberspaceViewer.tsx:48`:

```
<Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
```

`luminanceThreshold: 0.001` means *every non-black pixel blooms*; `levels: 9` is
a 9-deep mipmap chain, i.e. a glow radius spanning most of the screen. Over a
pure-black background with nothing but `lineSegments` and SDF text, this is what
made lines read as **emitted light** rather than as vector graphics. Reinforced
by `material-toneMapped={false}` on all text (`Hud/CoordinateText.tsx:39`,
`Interface.tsx:146`), which pushes glyphs above 1.0 luminance so they blow out.
This is the single highest style-per-line item in the codebase.

**The HUD is a cockpit, not an overlay.** Two mechanisms:
- It is a **separate `<Canvas>`** with its own camera and its own weaker Bloom
  pass (`CyberspaceViewer.tsx:52-79`, `:77` intensity 5). 3D geometry composited
  over the world, so it reads as instrument glass.
- **Every readout is yaw-rotated toward you.** `Hud.tsx:44-46` computes
  `divisor = max(4, floor(innerWidth/600))`, `r = PI/divisor`; the left column
  renders at `rotation={[0, r, 0]}` and the right at `[0, -r, 0]`
  (`Hud.tsx:142-149`, `:200-211`). The panels wrap around the viewer. Cheap,
  enormous.

**Sector-as-room.** `SectorManager.tsx:107-141`. The current sector is drawn at
full `2^30` scale in ORANGE with **fog disabled**; the 26 neighbours (from
`adjacentLayers={1}`, `CyberspaceViewer.tsx:44`) at 0.9 scale in DARK_PURPLE with
**fog enabled** (`:125`). "This is my cell, those are the neighbours" reads
without explanation.

**The room is labelled inside the room, at the room's scale.**
`SectorManager.tsx:127-138`: a drei `<Text>` at `fontSize={2**24 + 2**23}`
(~25 million units) placed on the sector wall at `[0, 0, halfSize]`, rotated 180°,
reading `SECTOR <name>` where the name comes from `generateSectorName(sectorId)`
(`src/libraries/SectorName.ts`), an integer triple turned into a pronounceable
word. This is the best "read the protocol off the world" move v1 made.

**Fog to pure black.** `ThreeAvatar.tsx:20-24`:
`scene.fog = new THREE.Fog(0x000000, 1, CYBERSPACE_SECTOR*2)`: linear fog from
1 to `2^31`. The only distance cue in an empty sector.

**A body you can see.** Third-person by default (`ThreeAvatar.tsx:39` radius 5),
avatar = wireframe `IcosahedronGeometry(0.5, 1)` edges in RED
(`src/data/AvatarModel.ts:3-5`), plus a wireframe cone oriented to the velocity
vector sitting on the body (`ThreeAvatar.tsx:56-80`). Direction-of-travel drawn
on the body rather than in the HUD. Right idea, broken implementation (see §1).

**Long-range beacons that do not attenuate.** `Cyberspace/Hyperjump.tsx:24-29`:
`new PointsMaterial({color: HYPERJUMP, size: 3, sizeAttenuation: false})` plus a
1-unit box and a constant slow tumble (`:32-37`). A 3-pixel point that never
shrinks is visible from anywhere inside a billion-unit sector. Exactly the right
primitive for "there is something over there, very far away".

**Cost expressed as time.** `Hud.tsx:131-138, 215-221`: distance to the nearest
hyperjump in gibsons *and* a `d/h/m/s` ETA at current speed
(`convertSeconds`, `src/libraries/utils.ts:12-26`). The only place v1 answered
"what does crossing to it cost".

**Trail.** `Cyberspace/ThreeAvatarTrail.tsx` draws a `THREE.Line` in RED through the
local coordinates of every published action, computed off-main-thread
(`src/hooks/useAsyncTrailPoints.ts`, `src/workers/TrailPointsWorker.ts`),
toggled by the `PATH` nav button (`CyberspaceViewer.tsx:66`). **Two limits:** the
worker only emits points whose action sector equals the current sector
(`TrailPointsWorker.ts:20`), so the trail vanishes the moment you cross a
boundary; and it samples *published actions*, not traversed positions, so at high
POW it is a near-straight line with a handful of vertices.

**Landmark at origin.** `Cyberspace/Spawn.tsx` renders `/spawn.glb` (hex boundary
rings + triads, scale 3×) only when you are in your genesis sector
(`Avatar.tsx:37`).

**Palette and type discipline.** `src/data/Colors.ts:16-26` assigns *semantic*
roles (`SKY`, `GROUND`, `GRID_CROSS`, `BLACK_SUN`, `DSPACE`=green,
`ISPACE`=light purple, `HYPERJUMP`=yellow, `GENESIS`=pink, `AVATAR`=red) rather
than raw hex at call sites. One typeface,
`/fonts/MonaspaceKrypton-ExtraLight.otf` via drei `<Text>`, at every scale from
0.07 to 25 million units, in the world and in the HUD.

**Sky/ground/parallax: a correction.** The sky-grid/ground-grid/Black-Sun
treatment people associate with v1 was **never in the first-person view.** It
lived only in `Map/Grid.tsx:24-38` (used by the GLOBAL view) and in the intro
flight (`Intro.tsx:160-177`, two 1000-unit `gridHelper` planes with a camera
translating at `0.0001 × SCALE` per frame, `Intro.tsx:118-124`). LOCAL was black
plus sector wireframes. There was effectively **no parallax in LOCAL**. The
world is static and the camera translates, but the nearest geometry is ~5×10^8
units away.

### 3. Where precision died: the core finding

**There was never a position command.** The entire input surface is a *direction*
(quaternion) and a *throttle* (a PoW difficulty exponent). `Controls.tsx:251-278`
→ `EngineStore.drift(quaternion)`. Nothing anywhere in v1 accepts a destination
coordinate. That is the root cause; everything below compounds it.

1. **Position is continuous and wall-clock-driven, not integral.**
   `Cyberspace.ts:743, 776-777`:
   `pos = lastActionCoord + velocity × floor((Date.now() − actionTime)/16.667)`.
   To land on a chosen coordinate you would have to publish an action at an exact
   millisecond. Position is recomputed from scratch every frame in
   `AvatarStore.getSimulatedState` (`src/store/AvatarStore.ts:121-146`), and the
   250 ms cache at `:105` is effectively dead, because the write is guarded by an
   inverted condition (`:133-142` only writes the cache when a *fresh* cache
   entry already exists).
2. **Velocity is quantized to powers of two; position is not.**
   `Δv = 2^(throttle−10)` gibsons per frame (`Cyberspace.ts:763`). Throttle is an
   integer 0..128. There is no throttle value, and no combination of them, that
   means "move exactly one gibson". The smallest non-zero step is `2^-9` G/frame,
   applied *forever*.
3. **No brake** (§1.1). Even with a perfect target you could not arrive at rest.
4. **Mining latency becomes displacement** (§1.2).
5. **No cursor and no target concept.** There is no raycast into the world
   anywhere in the LOCAL view. The Map sets up a raycaster and then has its
   `intersectObject` call **commented out** (`Map/SectorGrid.tsx:93-99`). The only
   working raycast-cursor-with-snap in the entire codebase is in BUILD mode:
   `Build/ShardEditor.tsx:57-76` raycasts onto an invisible plane and snaps the
   hit to the nearest 0.1 before placing a vertex. v1 already had the pattern,
   in the wrong mode, and never connected to navigation.
6. **Camera and avatar did *not* share a transform, but the camera was a rigid
   slave** (`ThreeAvatar.tsx:38-45`). There was no independent viewpoint,
   therefore no way to *look at* a place without *going* there, which is
   precisely the affordance a cursor needs.
7. **The render frame cannot represent a gibson at sector scale.** Sector
   wireframe vertices sit at ±`2^29` ≈ 5.4e8 in a `Float32Array`
   (`SectorManager.tsx:117-124`); Float32's ULP at that magnitude is **32 units =
   32 gibsons**. The avatar's own transform is float64 on the CPU and the camera
   rides 5 units from it, so the *avatar* is fine, but the only geometry you
   could measure yourself against is quantized to 32-gibson steps. Combined with
   near 0.1 / far 2^30 and no logarithmic depth buffer, one gibson is literally
   sub-pixel and sub-depth-quantum against the scenery.
8. **Rounding is invisible and happens at publish.**
   `cyberspaceEncodePartialToRaw` floors x/y/z to integers for the `C` tag
   (`Cyberspace.ts:136-139`); the fractional remainder is stored separately in the
   `Cd` tag to 8 decimals (`Cyberspace.ts:788-789`,
   `DecimalVector3.ts:62-69`). Nothing in the UI ever showed the integer/fraction
   split; the HUD prints the raw hex (`Hud.tsx:143`) and a `toFixed(2)` local
   position (`Hud.tsx:200-202`).
9. **Sector crossing is a two-frame discontinuity.** `localCoordinate` wraps from
   ~2^30 to ~0 immediately (`ThreeAvatar.tsx:33`), but the lattice re-base is
   deferred through `setFrameSectorId` → `useEffect` →
   `updateUserCurrentSectorId` (`ThreeAvatar.tsx:34, 49-53`). The world pops.

The encouraging half: **v1's coordinate math was already exact.** `DecimalVector3`
at 100 significant digits (`DecimalVector3.ts:4`) over a 2^85 axis. Precision did
not die in the arithmetic. It died because there was no way for a human to
*address* a coordinate, and no frame in which one gibson was perceptible.

### 4. The two-mode precedent: actually five modes

`Interface.tsx:26-41` switches on `useUIStore.uiState`
(`src/store/UIStore.ts`, persisted to localStorage as `ui-storage`), across
`UIState` = cyberspace | map | global | build | info (`src/types/UI.tsx`). Three
of them are spatial:

- **LOCAL** (`Cyberspace/CyberspaceViewer.tsx`): 1 three.js unit = 1 gibson.
  In-sector first/third person, WASD+QE, throttle, real avatar, real physics,
  27 sectors loaded (`adjacentLayers={1}`).
- **SECTOR** (`Map/CyberspaceMap.tsx`): 1 unit ≈ 2^30 gibsons. A lattice of
  1-unit boxes at `MAP_SECTOR_SIZE = 1.1` spacing (`Map/SectorGrid.tsx:23, 53`),
  positioned by `relativeSectorIndex(centerSectorId, sectorId)`
  (`Cyberspace.ts:825-832`) so the map is **always re-centred on you** (`follow`
  is hardcoded `"user"`, `SectorGrid.tsx:31, 40-47`; the `"roam"` branch is
  unreachable). Boxes coloured by contents (`SectorGrid.tsx:261-279`): orange =
  you, pink = genesis, yellow = hyperjump, red = other avatars, light purple =
  your own trail, dark purple = known-and-empty; solid+opaque only when
  meaningful, otherwise `opacity 0.2` (`:177-179`). Plus a labelled wireframe
  **SCAN AREA** box showing how far `SectorScanner` has looked
  (`SectorGrid.tsx:101-142`).
- **GLOBAL** (`Global/CyberspaceGlobal.tsx`): 1 unit ≈ 3.9e23 gibsons
  (`MAP_SIZE = 100` over the `2^85` axis, `:14, :34`). Sky grid + ground grid +
  a "Black Sun" disc, and in d-space an Earth sphere at
  `EARTH_SCALE = 0.13264` of the axis with labelled **EQUATOR** and **PRIME
  MERIDIAN** rings (`Map/Grid.tsx:8, 32-79`). The protocol's meaning drawn as
  scenery.

**How you moved between them: you clicked a word.** A 3D nav bar in its own
10svh `<Canvas>` at the top (`Interface.tsx:47-63`), `NavText` items at fixed x
offsets. No transition, no animation, no shared camera, no continuity. Each mode
is a distinct `<Canvas>` and switching **unmounts the previous one entirely**
(`Interface.tsx:46`), tearing down and rebuilding the GL context.

**Did the division work? Structurally yes, perceptually no.**

- The three modes share exactly one piece of state:
  `useSectorStore.userCurrentSectorId`. No shared camera, no shared orientation,
  no visual through-line.
- **The SECTOR mode's own control scheme was vestigial.**
  `Map/MapControls.tsx` is 123 lines that compute pitch/yaw and write a
  quaternion to `RotationStore` (`:98-119`), and `RotationStore` is read *only*
  by `ThreeAvatar.tsx:14`, which is not mounted in map mode. The map camera is
  actually driven by drei `OrbitControls` (`CyberspaceMap.tsx:21`). Its wheel
  handler writes `ZoomStore` (`MapControls.tsx:73-75`), and `ZoomStore` is read
  by **nothing** (grep: referenced only by `MapControls.tsx` and its own
  definition).
- **The scale jumps are unbridged.** LOCAL → SECTOR is a 10^9× jump;
  SECTOR → GLOBAL another 3.6e14×. Nothing shows the relationship. You clicked a
  word and were somewhere else, at a different scale, with a different control
  scheme.
- **You could not act from the map.** It showed hyperjumps, other avatars,
  shards and your own trail, and offered no click-to-target, no click-to-travel,
  no way to convert "I can see it over there" into "go there". The raycast that
  would have enabled it is present and commented out
  (`Map/SectorGrid.tsx:95-98`).

### 5. Library verdicts

- **`@react-three/drei`: earned its place, for four imports.** `Text` (troika
  SDF) in 14 files is the entire typographic identity; `OrbitControls` is the
  *actual* working camera for SECTOR/GLOBAL/BUILD; `useGLTF` (`Spawn.tsx:1`);
  `Line` (`ShardEditor.tsx:6`). Nothing else from drei was used.
- **`@react-three/postprocessing`: earned its place, for one effect.** `Bloom`,
  and only `Bloom`. No Noise, Glitch, ChromaticAberration, DepthOfField,
  Vignette, Scanline, SMAA. Verified by grep across `origin/master`. Seven
  `EffectComposer` instances, all containing exactly one `<Bloom>`.
- **`@react-spring/three`: did not earn its place, and was actively removed.**
  Its only use was a hover nudge on HUD nav text (`useSpring` + `animated.group`
  in `Interface.tsx`), deleted in commit **`d1ec2c0`**, *"rm react-three/spring
  to fix render loop error"* (2024-09-28). It stayed in `package.json:15` as a
  dead dependency. No motion in v1 was ever spring-driven.
- **Also dead: `src/tmp.FirstPersonControls.js`**, 489 lines, imported nowhere.
  It contains precisely the three things the live controls lack: velocity damping
  (`decel = 0.90`, `:31, :370, :379, :388`), a snap-to-zero dead zone
  (`minx = 0.1`, `:32, :371, :380, :389`), and a pitch clamp (`:405`). v1 wrote
  the good motion model and then did not use it.

---

## Steal verbatim

1. **Bloom over black on pure line geometry.**
   `mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001}
   luminanceSmoothing={0}` (`CyberspaceViewer.tsx:48`) + `material-toneMapped=
   {false}` on text (`CoordinateText.tsx:39`). This *is* the cyberspace look.
2. **The angled HUD.** Yaw-rotate the left column `+PI/divisor` and the right
   `-PI/divisor`, `divisor = max(4, floor(innerWidth/600))`
   (`Hud.tsx:44-46, 142-149, 200-211`). Turns readouts into a cockpit.
3. **HUD as a separate Canvas** with its own camera and its own weaker bloom
   (`CyberspaceViewer.tsx:52-79`).
4. **World-scale in-world labels.** The sector's name on the sector wall at
   `fontSize = 2^24 + 2^23` (`SectorManager.tsx:127-138`) + `generateSectorName`
   for pronounceable IDs.
5. **Current cell unfogged and full-size; neighbours fogged and shrunk to 0.9**
   (`SectorManager.tsx:114-125`).
6. **Non-attenuating point sprites as long-range beacons.**
   `PointsMaterial({size: 3, sizeAttenuation: false})` (`Hyperjump.tsx:24-29`).
7. **Cost in time, not just distance.** Gibsons *and* a d/h/m/s ETA at current
   speed (`Hud.tsx:131-138, 215-221`).
8. **A body you can see**, third person by default at a fixed offset
   (`ThreeAvatar.tsx:39-44`).
9. **Direction of travel drawn on the body, not in the HUD**
   (`ThreeAvatar.tsx:56-80`): the intent, with the mutation bug fixed.
10. **Semantic colour table** (`Colors.ts:16-26`) and **one SDF mono at every
    scale**, world and HUD alike.
11. **Content-derived cell colouring with opacity as significance**
    (`SectorGrid.tsx:261-279` + `:177-179`).
12. **The map is always relative to you.** Positions from
    `relativeSectorIndex(center, target)` (`SectorGrid.tsx:52`,
    `Cyberspace.ts:825-832`), so an integer lattice of 2^55 never leaves float
    range.
13. **Draw the extent of what you have looked at**, as a labelled wireframe
    volume (`SectorGrid.tsx:101-142`, "SCAN AREA").
14. **The protocol as scenery.** GLOBAL's d-space Earth with labelled EQUATOR /
    PRIME MERIDIAN and the Black Sun (`Map/Grid.tsx:32-79`).
15. **Raycast-to-plane + snap-to-grid cursor** (`ShardEditor.tsx:57-76`). The
    pattern already exists in v1; it just never reached navigation.
16. **Exact coordinate math.** `Decimal.set({precision: 100})` + `DecimalVector3`
    (`DecimalVector3.ts:4, 23-137`). The arithmetic was never the problem.
17. **Trail computed in a Web Worker** (`useAsyncTrailPoints.ts`,
    `TrailPointsWorker.ts`).

## Must not come back

1. **Velocity as the only control.** Accumulate-forever velocity with no drag and
   no brake (`Cyberspace.ts:754-777`; `EngineStore.ts:86-101`).
2. **Unimplemented stopping shipped to production.** `freeze()`/`hop()` as
   `console.log` stubs (`EngineStore.ts:86-96`) while `stop()` only kills miners.
3. **Retroactive velocity.** Never apply a Δv from a past timestamp; mining
   latency must never become a position teleport (`Cyberspace.ts:743 × :776`).
4. **An exponent on a mouse wheel with a linear readout.** Throttle 0..128 where
   >~32 is physically unreachable (`Controls.tsx:174`), displayed as
   `'▶'.repeat(throttle)` (`Hud.tsx:148`), which implies linearity and lies.
5. **Window-level input listeners with no target check** (`Controls.tsx:181-205`):
   wheel anywhere changes throttle, drag anywhere rotates the view.
6. **Unbounded pitch with a comment claiming a clamp**
   (`Controls.tsx:160-163`).
7. **React state as the per-frame transport for position/velocity/rotation**
   (`ThreeAvatar.tsx:16-17, 33-35`; `Controls.tsx:24-25, 243-247`;
   `Hud.tsx:88`). 60 reconciliations/sec and a one-frame camera/body desync.
8. **One scale for everything.** 1 unit = 1 gibson inside a 2^30 room, with a
   1-unit body. No speed is simultaneously visible and controllable.
9. **near 0.1 with far 2^30 and no logarithmic depth buffer**
   (`ThreeAvatar.tsx:25`; no `gl` prop on any `<Canvas>`), plus Float32 vertex
   data at magnitude 2^29 (`SectorManager.tsx:117-124`) quantizing the only
   reference geometry to ~32-gibson steps.
10. **Discontinuous re-basing on sector crossing**, with the coordinate wrap and
    the lattice re-base landing on different frames
    (`ThreeAvatar.tsx:33` vs `:34, 49-53`).
11. **A trail that deletes itself at the sector boundary**
    (`TrailPointsWorker.ts:20`) and samples published actions rather than the
    traversed path.
12. **In-place mutation of state vectors during render**
    (`ThreeAvatar.tsx:58, 64`). It silently killed the only in-world speed cue.
13. **Vestigial control layers.** `MapControls` computing a rotation into a store
    nobody reads while drei `OrbitControls` actually drives the camera
    (`MapControls.tsx:98-119` vs `CyberspaceMap.tsx:21`); `ZoomStore` written and
    never read.
14. **Mode switching as a full Canvas unmount** with no transition, no shared
    camera, and a 10^9× scale jump between neighbouring modes
    (`Interface.tsx:26-46`).
15. **A map you cannot act from.** Raycaster present, `intersectObject` commented
    out (`SectorGrid.tsx:95-98`).
16. **Dead dependencies and dead files in the tree** (`@react-spring/three` at
    `package.json:15`; `src/tmp.FirstPersonControls.js`).

## Could not determine

- Whether the "floaty" impression came from master HEAD or an earlier build.
  HEAD's `App.tsx:12-15` routes only to a maintenance `<Intro/>`, so the
  Interface/Cyberspace views were **not reachable in the deployed HEAD**; this is
  a source read, not a behavioural one. No bisect was done.
- Measured frame rates or real mining times: v1 was not run.
- The appearance of `/spawn.glb` (binary asset, not read).
- Whether "no drag" matched the Cyberspace protocol spec of the time or was an
  implementation gap. The presence of `ZERO_VELOCITY` and its comment
  (`Cyberspace.ts:16-17`) suggests a rounding-to-rest rule was intended; it is
  applied only to the increment (`:764-767`), never to accumulated velocity.
