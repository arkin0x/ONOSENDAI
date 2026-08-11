# 07 — Is the black sun a point or a direction?

Type: grilling
Status: resolved
Blocked by: —

## Question

Surfaced by ticket 02. The spec contradicts itself, and the answer changes what
ticket 04 builds.

§11.2 gives the black sun a **point**: `(x=0, y=0, z=2^84)`, "rendered as a purple
circle marking the `+Z_cs` boundary".

§11.3 defines the canonical view as **looking toward `+Z_cs`**, and calls that
"facing the black sun".

These only agree at the origin. A pubkey-derived spawn has x and y as effectively
random 85-bit values near 2^84, so the bearing from a real avatar to the point
`(0, 0, 2^84)` is roughly `(-x, -y, ·)` — nowhere near `+Z`. Face `+Z_cs` from a
typical spawn and the marker is not in front of you. So either:

- **It is a direction at effective infinity** — a sun on the horizon, always at
  `+Z_cs` bearing regardless of where you stand. Consistent with §11.3, and it is
  what makes the thing useful: a fixed absolute reference, which per ticket 02 is
  the *only* one the protocol defines. Everything else is relative.
- **It is a literal point** — a landmark at a specific coordinate that you can
  approach, and which is behind you from most of the universe. Then §11.3's
  "facing the black sun" is loose language and the canonical view is really just
  "face `+Z_cs`".

**Recommendation: direction at infinity.** It satisfies §11.3, it gives an
absolute bearing from anywhere, and a guidepost you cannot see from most of the
space is not a guidepost.

Decide, and if the answer is "direction", raise a spec clarification against
`arkin0x/cyberspace` so other implementations agree — this is a visualization
convention whose whole purpose is that different viewers agree on orientation
(§11 preamble).

Secondary, once ruled: does anything else deserve to be an absolute reference —
the origin, the axis extents, the sector lattice — or is one sun the whole of it?

## Answer

**Ruled by the protocol author.**

> The black sun is a recommended visual guidepost for visual implementations of
> the Cyberspace protocol. It exists at the Z+ end, beyond all coordinates. It
> can be seen when the Z+ plane is within the frustum. That's all it is.
>
> At any scale it is visible IFF the frustum includes the Z+ end of the axes.
> This will happen any time the user rotates the camera in that direction.

### What it is

It sits at `+Z_cs` infinity, beyond the coordinate space. From **any** coordinate
the direction to it is therefore exactly `+Z_cs`: position and scale are
irrelevant, and only view direction decides whether you see it. Rotate toward
`+Z` and it is there; rotate away and it is not.

- It has **no coordinate**. §11.2's `black_sun_u85` triple is a category error,
  not an arithmetic one. There is nothing to correct, only to remove.
- **§11.2 and §11.3 never contradicted.** "Facing the black sun" is a view
  orientation toward `+Z_cs`, and since the marker is at `+Z` infinity, facing
  `+Z` *is* facing it. The conflict I reported was an artifact of treating it as
  a point inside the cube.
- It is a genuine absolute reference, so ticket 02's ranking of it stands.

### How it is rendered: a scale-relative proxy

Author's implementation ruling:

> The actual polygon that represents the black sun should be big enough that it
> is always visible. At any scale, the position of the black sun may need to be
> changed. For example if the sector is the primary space, the black sun could be
> painted at the Z+ side of the current sector.

So the marker is a **proxy**, not literal geometry at infinity: a polygon large
enough to always read, placed at the `+Z` face of whatever volume is the primary
reference at the current scale, and repositioned as that volume changes. The
standard skybox-sun technique — the concept is at infinity, the geometry is a
scale-relative stand-in.

**This removes the projection constraint.** An earlier version of this answer
concluded the black sun required a vanishing point and was therefore an argument
for perspective. A proxy at a finite distance projects fine under orthographic:
it simply appears at whichever screen edge `+Z` maps to. Any projection can
render it, and ticket 03 is not constrained by it.

**Open question inherited by ticket 04:** which volume is "the primary space" at
a given scale? The sector (2^30 gibsons, §10) is the author's example. The
containing aligned subtree is another candidate, and would compose with the
rooms treatment in variant B — the black sun painted on the current room's `+Z`
wall, so it moves outward as you zoom out through the nest.

### Upstream

[cyberspace#17](https://github.com/arkin0x/cyberspace/pull/17) corrects the
coordinate rather than removing it, so it addresses the wrong layer.
