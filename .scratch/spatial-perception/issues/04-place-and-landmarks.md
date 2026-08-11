# 04 — How does the interface tell you where you are?

Type: prototype
Status: open
Blocked by: 03

## Question

Goal one of the map: **visually communicating destination and place.**

An 85-bit coordinate is currently a 26-digit number in a HUD panel. Every
location looks identical to every other, so there is no sense of arriving
anywhere, no sense of return, and nothing to navigate *by*. Fix that in the
world, not in a panel — printing coordinates is the CLI's job.

Decide what furniture the world needs, and build it:

- **The black sun.** §11.2 defines a purple marker at the `+Z_cs` boundary as
  the directional guidepost, and §11.3's canonical view faces it. The app
  implements the view (`canonicalQuaternion`, the `C` key) and renders no marker.
  **Ticket 07: it has no coordinate.** Per the protocol author it sits at `+Z`
  infinity, beyond the coordinate space, visible iff the frustum contains the
  `+Z` direction — at any scale, since direction to infinity does not depend on
  where you stand. Purple, shape free, both planes, no distance and no parallax.
  It is a real absolute reference, as ticket 02 said. But 07 also found it needs
  a projection with a vanishing point: under orthographic it can only be dead
  centre or absent, never sweeping. Whatever ticket 03 chooses must be able to
  render it.
- **What else deserves to be absolute?** Carried over from 07: the origin, the
  axis extents, the sector lattice. Is one sun the whole of it, or does the space
  need more fixed reference than a single bearing?
- **Origin and axis structure.** Is the origin visible? Are the three axes
  perceivable as structure rather than as labels on a compass widget?
- **Sectors.** A sector is 2^30 gibsons per axis (§10) and is already how the
  protocol slices space for querying. Are sector walls the natural "streets" of
  Cyberspace, and should you see them?
- **Region structure.** Aligned subtrees are why two people in one place agree
  without communicating (§4.5). Does that structure deserve to be visible?
- **Distinctiveness.** Terrain K already varies by place. Is that enough to make
  somewhere recognisable on return, or does place need more identity than a
  pattern of dots?
- **Destination.** When you aim the cursor somewhere, what tells you about the
  place you are aiming at, before you commit?

Ticket 01 found four landmark techniques in v1 worth taking directly: the sector
name rendered **on the sector wall at world scale** (`fontSize = 2^24 + 2^23`)
with `generateSectorName` turning an integer triple into something pronounceable;
the current cell drawn unfogged and full-size while neighbours are fogged and
shrunk to 0.9, which reads as "inside" without explanation; non-attenuating point
sprites as beacons visible from anywhere in a billion-unit volume; and a labelled
wireframe volume showing the extent of what you have already looked at.

Whatever ticket 03 chose constrains the form of all of this — landmarks in a
flat slice work differently from landmarks in a perspective volume.

Deliverable: decided landmark set, merged and browser-verified, with the answer
recording what was rejected and why.
