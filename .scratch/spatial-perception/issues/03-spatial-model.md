# 03 — What is the spatial model?

Type: prototype
Status: open
Blocked by: 01, 02

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
- Judge on comprehension *and* style, per the map's Notes.

Deliverable: a decision recorded in the Answer, the winning treatment merged and
browser-verified, and the rejected treatments described with why they lost.
