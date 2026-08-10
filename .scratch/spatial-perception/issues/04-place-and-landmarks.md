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

- **The black sun.** §11.2 defines a purple marker at the `+Z_cs` boundary
  (`x=0, y=0, z=2^84`) as the directional guidepost, and §11.3's canonical view
  faces it. The app implements the view (`canonicalQuaternion`, the `C` key) and
  renders no marker. It MUST sit on the `+Z_cs` boundary and be visible in both
  planes.
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

Whatever ticket 03 chose constrains the form of all of this — landmarks in a
flat slice work differently from landmarks in a perspective volume.

Deliverable: decided landmark set, merged and browser-verified, with the answer
recording what was rejected and why.
