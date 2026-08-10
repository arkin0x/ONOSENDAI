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

**The black sun is a bearing, not a place.** Render it at a fixed `+Z_cs` bearing
from wherever the avatar stands, like a sun on the horizon. §11.3 then holds
exactly, everywhere.

### Evidence

**The km figure was correct all along; the u85 triple is the error.** §9.7 maps
`u = km * 1000 * 2^33 + 2^84`, so `km = 0` sits at u85 `2^84`. The km frame is
therefore **cube-centred** while u85 is **corner-relative**. Centre plus one
half-axis (§9.2's ~2.25e12 km) is exactly the `+Z` boundary, so the stated km
triple already denoted the centre of the `+Z` face — which is what §11.2 says the
marker marks.

The stated u85 triple `(0, 0, 2^84)` does not: the axis maximum is `2^85 - 1`, so
`2^84` is the middle of the z axis and `x = y = 0` is the axis minimum. Spec
commit `088a7cc` introduced it with the words "the maximum u85 value", which is
where the error entered. That commit also added a guard saying not to convert the
km figure — but the guard's own premise was the bug, and following it propagates
the error. The guard has since been dropped from the spec while the km figure
remains, which is the trap that makes this worth fixing.

**Measured, over 2000 pubkey-derived spawns** (12-spawn samples agree within a
few degrees):

| marker | mean angle off `+Z` | worst | behind the viewer |
|---|---|---|---|
| stated `(0, 0, 2^84)` | 90.9° | 175.9° | **51.1%** |
| km-derived / corrected | 42.1° | 89.9° | 0% |

The 51.1% is decisive: the current coordinate puts the `+Z` guidepost *behind
half of all spawns*. Correcting it removes that and halves the mean error.

**But correcting it does not rescue §11.3.** A 42.1° mean remains, because the
marker is ~0.24 light-years away (§9.2) while a random spawn is off-axis by a
comparable distance, so it is nowhere near effective infinity. No literal point
can serve as a `+Z` bearing from an arbitrary coordinate. Hence: a bearing.

**Upstream:** the coordinate fix is
[arkin0x/cyberspace#17](https://github.com/arkin0x/cyberspace/pull/17), which
sets `black_sun_u85 = (2^84, 2^84, 2^85 - 1)` and states that the two forms are
the same point. It deliberately leaves §11.3 untouched and raises point-versus-
bearing as an open decision for the maintainer.

### Consequences

- **Ticket 04** builds it as a bearing indicator, not a reachable landmark. It is
  never approached, never parallaxes, and has no distance. Per ticket 02 it is the
  only absolute reference the protocol defines; everything else is relative.
- **§11.2's "purple circle marking the +Z_cs boundary"** becomes figurative: the
  marker indicates the boundary's direction rather than sitting on it.
- **Upstream:** two corrections to raise against `arkin0x/cyberspace` — the u85
  triple is arithmetically inconsistent with its own km triple, and point-versus-
  direction needs stating explicitly, since §11's whole purpose is that different
  viewers agree on orientation.
- **Secondary question** (what else deserves to be an absolute reference: origin,
  axis extents, sector lattice) folds into ticket 04 rather than becoming its own
  ticket — it is the same landmark-set decision.
