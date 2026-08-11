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

**Ruled by the protocol author, and it supersedes everything below.**

> The black sun is a recommended visual guidepost for visual implementations of
> the Cyberspace protocol. It exists at the Z+ end, beyond all coordinates. It
> can be seen when the Z+ plane is within the frustum. That's all it is.

Three consequences:

1. **It has no coordinate.** "Beyond all coordinates" means it is outside the
   coordinate space, so §11.2's `black_sun_u85` triple is a category error rather
   than an arithmetic one. Nothing to correct; it should not be there.
2. **§11.2 and §11.3 do not contradict.** "Facing the black sun" is a view
   *orientation* toward `+Z_cs`, not a line of sight to an object. The
   contradiction I reported only existed because I treated the marker as a point
   inside the cube.
3. **It is not an always-visible bearing either**, which is what this ticket
   originally ruled. It is drawn when the `+Z_cs` boundary plane enters the view
   frustum. At fine scales that boundary is ~2^85 gibsons away and effectively
   never in view, so the black sun appears only when you are zoomed out far
   enough to see the edge of the universe.

### Consequence for the map

**The black sun is not the orientation answer.** Ticket 02 ranked it highly as
"the only absolute reference the protocol defines", and that over-read it: it is
a rare, coarse-scale landmark, not a compass you navigate by day to day. Ticket
04 still needs an answer for "which way am I facing" at working scales, and it
will not come from here.

Rendering rule for ticket 04: draw it beyond the `+Z_cs` boundary plane, visible
only when that plane is inside the frustum, purple, shape implementation-defined,
present in both planes.

### Process note

I got this wrong three times before asking: first that the km figure was
authoritative, then that the u85 triple was, then that it was an always-visible
bearing. Each reading was defensible from the text and each was wrong. The text
could not settle it because the object was never a coordinate; only the author
could. Ask earlier.

### Upstream

[cyberspace#17](https://github.com/arkin0x/cyberspace/pull/17) fixes the
coordinate rather than removing it, so it addresses the wrong layer and should be
reworked or closed.
