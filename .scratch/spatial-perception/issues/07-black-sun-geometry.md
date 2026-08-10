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

§11.2 states two coordinates for the black sun, and they are **different points**:

| | x | y | z |
|---|---|---|---|
| Stated u85 triple `(0, 0, 2^84)` | axis minimum | axis minimum | centre |
| Stated km triple `(0, 0, +2.25e12 km)` via §9.7 | 2^84 (centre) | 2^84 (centre) | 38670165945834066795298816 (≈ the +Z max) |

Only the km-derived point marks the `+Z_cs` boundary, which is what §11.2 says
the marker does. The u85 triple appears to be centred-frame values — `0, 0,
half-axis-length` — mislabelled as u85. §9.7's mapping is `u = km * 1000 * 2^33 +
2^84`, so km `0` is u85 `2^84`, not `0`.

Fixing the arithmetic does not rescue §11.3. Measured over 12 real
pubkey-derived spawns, the angle between `+Z_cs` and the bearing to the marker:

- stated u85 triple: **82.7°** off `+Z` (essentially perpendicular)
- corrected km-derived point: **35.0°** off `+Z`

The black sun is at most ~0.24 light-years away (§9.2) and a random spawn is off
axis by a comparable distance, so it is nowhere near effective infinity. No
literal point can serve as a `+Z` bearing from an arbitrary coordinate.

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
