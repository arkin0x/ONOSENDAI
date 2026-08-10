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

**Which coordinate is authoritative: the u85 one.** Spec commit `088a7cc`
("Fix §10.2 black sun position with correct axis extent") established this and
added an explicit guard:

> The GPS→dataspace mapping ... maps GPS coordinates into a GEO-centered region
> spanning ~48,000 km. The black sun is at the full half-axis extent. **Do not
> use the `units_per_km` formula for black sun positioning; use the u85
> coordinate directly.**

**That guard has since been dropped from the spec** (it appears nowhere in the
current text). The km figure `+2.25×10^12 km` survived without it, which is a
live trap: convert it through §9.7 and you get `(2^84, 2^84, ~2^85)`, a different
point from the stated `(0, 0, 2^84)`.

**The real defect.** §11.2 says the marker "MUST" sit on the `+Z_cs` boundary,
then places it at `z = 2^84`. The axis is 85 bits, so its maximum is `2^85 - 1`:
`2^84` is the **middle** of the z axis, not its boundary. `x = 0, y = 0` are the
axis minimum. So the stated point is the centre of the `-X,-Y` edge, not a `+Z`
boundary marker. Commit `088a7cc`'s own message calls `2^84` "the maximum u85
value"; the current text calls it "the half-axis extent", which is correct — but
the coordinate was never updated to match the boundary claim.

**Neither reading works as a bearing.** Measured over 12 real pubkey-derived
spawns, the angle between `+Z_cs` and the bearing to the marker:

- authoritative u85 point `(0, 0, 2^84)`: **82.7°** off `+Z` — essentially
  perpendicular, the sun sits beside you
- km-converted point: **35.0°** off `+Z`

The marker is ~0.24 light-years away (§9.2) while a random spawn is off-axis by a
comparable distance, so it is nowhere near effective infinity. No literal point
can serve as a `+Z` bearing from an arbitrary coordinate, which is what §11.3
requires. Hence: a bearing.

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
