# 06 — What are the controls?

Type: grilling
Status: open
Blocked by: 03

## Question

The gap this map exists to close, stated as an input problem: v1 let you fly but
not land; v2 lets you land but not fly.

v2 today: `WASD` nudges a cursor one cell, `Space` commits and computes the
proof, `Shift+WASD` rotates the view 90°, `Q`/`E` change scale, `R`/`F` push the
cursor along the invisible out-axis, `C` snaps to canonical, `Tab`/`Esc` for view
history. On mobile: tap-to-cursor plus a hamburger for panels. It is precise and
entirely modal — nothing about it feels like moving through a place.

**Ticket 01 found the root cause, and it reframes this ticket.** v1's precision
did not fail for want of tuning: **there was never a position command at all.**
The entire input surface was a *direction* (a quaternion) plus a *throttle* (a
proof-of-work difficulty exponent on the mouse wheel). Nothing in v1 accepted a
destination coordinate. Velocity was quantized to powers of two while position
was continuous, so no throttle value and no combination of them could mean "move
exactly one gibson", and there was no brake — `freeze()` and `hop()` shipped as
`console.log` stubs, and the snap-to-rest constant `ZERO_VELOCITY` was only ever
applied to the increment, never to accumulated velocity.

The sharpest detail: **v1 already had a working raycast-cursor-with-snap**, in
`Build/ShardEditor.tsx:57-76`, raycasting an invisible plane and snapping to the
nearest 0.1. It was never connected to navigation. The map's own raycaster exists
with its `intersectObject` call commented out (`Map/SectorGrid.tsx:93-99`), which
is why you could see everything on the map and act on none of it.

Decide the control model, given whatever spatial model ticket 03 chose:

- **Is there a traversal mode at all?** Continuous movement is what made v1 feel
  embodied and what destroyed its precision. Can both exist — a fluid mode for
  covering distance and a precise mode for landing — and what switches between
  them? (v1's Cyberspace/Map split is the precedent; ticket 01 says how it fared.)
- **Cursor or avatar?** Do you drive the avatar and commit where it lands, or aim
  a cursor and commit a target? The current model separates them; is that the
  right separation or the reason it feels like a coordinate editor?
- **Scale as navigation.** `Q`/`E` currently swap the lattice instantly. Is
  changing scale a *movement* — zooming out to travel far, in to land precisely —
  and should it feel like one?
- **The out-axis.** `R`/`F` currently move into space you cannot see. Whatever 03
  chose should make this an actual direction.
- **Rotation.** 90° snaps are precise and disorienting. Does the winning spatial
  model still want discrete rotation?
- **Mobile.** What survives without a keyboard, and is a phone a first-class
  target or a viewer?
- **Mode switching.** v1 had five modes, three of them spatial: LOCAL at 1 unit
  per gibson, SECTOR at ~2^30, GLOBAL at ~3.9e23. You switched by clicking a
  word, which **unmounted the entire Canvas** — no transition, no shared camera,
  and 10^9x scale jumps with nothing showing the relationship. If the answer here
  is multi-modal, the transition is the design problem, not the modes.

Deliverable: decided control scheme, merged and browser-verified. Nothing about
the existing bindings is sacred; the map's Notes make the whole current interface
open to replacement.
