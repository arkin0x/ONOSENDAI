# 03 — What is the spatial model?

Type: prototype
Status: claimed
Blocked by: —

## Question

**The keystone.** Choose the spatial model that threads v1's embodiment with
v2's precision. Nearly every other visual and control decision hangs off this.

Today the app renders a single flat plane: the avatar's slice along the out
axis, in orthographic projection, one screen unit per cell. `R`/`F` move the
cursor along an axis you cannot see at all. It is precise and completely
disembodied.

Build **two or three genuinely different treatments** against real terrain and
choose by looking. Candidates, not a closed list:

- **Depth-cued slice** — keep the orthographic slice, but render neighbouring
  layers ghosted/fogged behind it so the out-axis exists perceptually.
- **Tilted / parallax** — a fixed oblique view or slight parallax on movement,
  enough to read depth without surrendering the cell grid.
- **Perspective volume** — an actual 3D field of gibsons with a perspective
  camera, precision recovered through a cursor and grid overlay rather than
  through camera discipline.
- **Dual-mode** — an embodied view and a precise view, with an explicit
  transition. v1 had exactly this split (Cyberspace view plus Map view); ticket
  01 reports whether it worked.

**Correction from ticket 01, read this before choosing.** v1's LOCAL first-person
view was *not* the immersive thing memory says it was: it was black space plus
sector wireframes, with **effectively no parallax**, because the nearest geometry
was ~5e8 units away. The sky-grid, ground-grid and Black Sun treatment lived only
in the GLOBAL map and the intro flight. So v1's embodiment did **not** come from
perspective projection. It came from bloom over black on line geometry, fog to
pure black, the sector rendered as a room you are inside, world-scale labels on
that room's wall, and a visible body. **Perspective is not the variable to test;
scenery and light are.** A perspective camera with nothing near you is just as
empty as an orthographic one.

Constraints and traps:

- **The camera rig is orthographic-only today.** The world group's quaternion and
  the camera's cancel *exactly*, so `view` has no geometric effect and rotation
  is achieved purely by remapping which world axis is screen-right/up. Verified
  numerically. Any perspective treatment breaks this scheme and needs a real rig.
- **Performance has a floor to respect.** Terrain is sampled per cell at ~54µs;
  the current plane is 2,401 cells resolving in ~570ms cold, and the per-block
  cache makes that 49 samples at `scaleExp` 0. A volume treatment multiplies cell
  count and must be costed before it is chosen, not after.
- **Precision is non-negotiable.** Whatever wins must still let you land on an
  exact gibson and see exactly what the crossing costs. That is what v1 lost.
- **Float32 is a hard wall at scale.** v1 put sector wireframe vertices at ±2^29
  in a Float32Array, where the ULP is **32 gibsons** — the only geometry you could
  measure yourself against was quantized to 32-gibson steps. Combined with near
  0.1 / far 2^30 and no `logarithmicDepthBuffer`, one gibson was both sub-pixel
  and sub-depth-quantum. Any treatment that draws distant structure must keep
  vertices near the origin (v1's map did this with `relativeSectorIndex`; v2
  already draws relative to the avatar's aligned cell) and must state its depth
  buffer plan.
- **Do not make the camera a rigid slave to the avatar.** v1 hard-set camera
  position every frame with `copy()` at a fixed 5-unit offset, so there was no
  independent viewpoint and therefore **no way to look at a place without going
  there** — which is precisely the affordance a cursor needs.
- **The black sun does not constrain this choice.** Ticket 07 resolved it as a
  scale-relative proxy polygon at the `+Z` face of the current reference volume,
  not literal geometry at infinity, so any projection renders it. An earlier
  reading made it an argument for perspective; that is withdrawn.
- Judge on comprehension *and* style, per the map's Notes.

Deliverable: a decision recorded in the Answer, the winning treatment merged and
browser-verified, and the rejected treatments described with why they lost.

## Prototype

Branch `prototype/03-spatial-model` — three variants on the existing route via
`?variant=A|B|C`, floating switcher bottom-centre, dev-only. Screenshots at
`/data/Sync/agents/claude/shots/v03-{A,B,C}.png`.

- **A — light only.** Today's flat ortho slice plus v1's bloom (threshold 0.001,
  levels 9) and fog to black. No geometry change.
- **B — rooms.** A plus the aligned-subtree nest as nested wireframe boxes,
  brightness rising with height above the scale floor via `boundaryIntensity`.
- **C — perspective room.** B with a perspective rig at 60 units, fov 60.

All three render 2401/2401 terrain with zero page errors.

**Caveat on C:** the camera sits 60 units back, so C tests *perspective from
outside the structure*, not from within it. v1's was a chase camera close to the
avatar. C as built does not settle whether an inside-the-room perspective works.
