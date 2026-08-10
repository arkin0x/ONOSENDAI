# 01 — What made v1 embodied, and what made it floaty?

Type: research
Status: claimed
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
