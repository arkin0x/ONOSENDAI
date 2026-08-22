# 02 — What must a spatial client make perceivable?

Type: research
Status: resolved
Blocked by: —

## Question

Before choosing how the space looks, establish what it must *communicate*. The
protocol has a small number of properties that are genuinely counterintuitive,
and the spec is explicit that one of them is central: movement cost is set by
*which power-of-two boundary you cross*, not by how far you travel.

Derive, from `/data/repos/cyberspace/CYBERSPACE_V2.md` (and `decks/`), the
inventory of things a spatial client must let a person perceive, and rank them by
how badly they fail to be intuitive without visualization.

Cover at least:

- **Place** — where you are in an 85-bit axis space, and what makes one location
  distinguishable from another (§2, §3: identity *is* location).
- **Direction and destination** — which way is which, and where you are headed.
  Note §11.1–11.3: the canonical view and the black sun at `+Z_cs`, which this
  app implements as an orientation but renders no marker for.
- **Cost and reachability** — LCA height (§4.4), why a 1-gibson step can cost
  15× (see 05: the figure was stated as 16× here and there, which is 2^h, the
  leaf count, not a ratio of pairings), decomposition invariance (§4.8: there are no shortcuts), the hop/sidestep
  split (§6.13–6.14: continents you cannot cross at all).
- **Terrain** — K as the temporal cost landscape (§5.2), constant across 2^3
  blocks, hills and valleys.
- **Scale** — the height hierarchy and its physical meanings (§7.3, §9.2).
- **Regions** — aligned subtrees, why two people in one region agree without
  communicating (§4.5), and discovery radius (§7.3).
- **Planes** — dataspace and ideaspace sharing XYZ (§2.4).

For each: state what it is, why it is unintuitive, what a person must be able to
*see* to grasp it, and whether v2 currently shows it at all.

Then answer the framing question: **which two or three of these, if made
perceivable, would do the most to make Cyberspace feel like a place?**

Deliverable: the ranked inventory in the ticket's Answer, with spec section
references. This is the brief that tickets 03–05 design against.

## Answer

Full spec read (1383 lines) plus DECK-0001 and the whole v2 client. Ranked by
(unintuitiveness x centrality), with a CLI verdict on each.

**1. Cost as walls (§4.4, §4.8).** Cost is `2^h` where `h = (v1^v2).bit_length()`;
7→8 costs h4 while 8→9 costs h1, and decomposition invariance proves no route
avoids the wall. Must be seen as a barrier *between you and the cursor*, with
magnitude — h34 must look categorically unlike h4, not 30 shades along a ramp.
v2: partially, and degenerately (see Defect 1). Lines only, one slice, two axes;
boundaries perpendicular to depth are not drawn at all. **Ours.**

**2. Place (§2, §3).** An 85-bit space has no landmarks by construction; nothing
distinguishes `x=2^84` from `x=2^84+1`. Two points 10^20 gibsons apart render as
an identical lattice. v2: numerically yes (HUD), spatially no. **Ours** —
distinguishability is exactly what a CLI cannot do.

**3. Regions / aligned subtrees (§4.5, §7.3).** Space comes pre-partitioned into
a nest of boxes nobody chose, and "how far this can be heard" is a tree height,
not a distance. v2: no — implicit in gridlines, but no containment, nesting or
radius. `deriveRegionN`, `deriveRegionKeyMaterial`, `deriveRegionKeyMaterialScan`
are exported by core and never called from src/. **Ours.**

**4. Scale (§7.3, §9.2).** 85 binary decades; h33 = 1m, h34 = 2m, full axis ≈
0.48 light-years. Levels are categorically different, not merely bigger. v2:
`ScaleBar` is the best comprehension element in the client and covers physical
size well; the *hierarchy* is absent — `adjustScale` increments an integer, zoom
is constant, so scaling is an instant lattice swap with no motion or nesting.
**Mixed.**

**5. Direction / black sun (§11.1–11.3).** The most *intuitive* item; ranks high
on centrality and cheapness. v2: canonical view fully implemented and tested
(`canonicalQuaternion`, `C` key, `flipHandedness` doing §11.4 properly) with **no
marker rendered anywhere**. Only orientation aid is `Compass3D`, which gives
relative orientation and no absolute bearing. **Ours, unambiguously.**

**6. Terrain K (§5.2).** A cost multiplier on *arriving*, not a surface. Measured:
K is exactly constant across every aligned 2^3 cube (200 cubes x 512 offsets),
and within an aligned 2^7 cube K spans exactly a 4-wide band against a global
range of 2..15 — so the 128-cube sets base elevation and the 8-cube adds +0..4 of
roughness. That is the real hill structure. v2: rendered, but at `scaleExp >= 3`
adjacent cells land in different 8-blocks so the field reads as noise, and the
base-elevation signal is invisible because isolated dots cannot show a plateau.
**Priority inversion:** K ≤ 16 means ≤65,536 pairings (~100ms) yet it occupies the
entire visual field, while LCA — the dominant cost — gets thin lines. Needs
re-scoping *down*.

**7. Reachability / continents (§6.13–6.14).** Some destinations are permanently
unreachable by any means you own, and the boundary is a property of your machine.
v2: the mechanic is well served (`Cursor` splits the tether into sidestep leg and
remainder, `ProofPanel` previews wall height and cost) but the *geography* is
absent — one hard-coded `MAX_COMPUTE_HEIGHT = 20`, and the client will offer an
h60 sidestep with a bare seconds figure. **Half CLI** — numbers are CLI work;
reachability as visible territory is ours.

**8. Planes (§2.4).** Two universes on one address space, one bit apart. v2: label
and styling; the only real perceptual difference is accidental (terrainK takes the
plane bit, so the field resamples on `P`). **Ours, low value.**

### The pick

**Aligned-subtree containment, walls with magnitude, and the black sun.** They
compose into one picture rather than three features: *you are inside a nest of
rooms, whose walls are thick in proportion to what they cost, all oriented by one
fixed landmark.* That single sentence covers place, cost, scale, region and
direction — the entire top half of the inventory. Containment is highest-leverage
because it pays out four times over (edges are walls, nesting is scale, heights
are discovery radii, and the boxes being not-yours is the visible form of
automatic spatial consensus). The black sun is included on cost-effectiveness: it
is the only absolute reference the protocol defines.

### Defects found

1. `BoundaryGrid.tsx:65,71` passes **absolute** height to `boundaryColor`, whose
   parameter is documented as *excess* (`palette.ts:96`). At scaleExp `s` the
   cheapest crossing is already height `s+1`, so above ~scaleExp 5 every ordinary
   gridline saturates and the ramp carries zero information. The helper written
   for exactly this, `boundaryIntensity(height, floor)` (`palette.ts:69`), is dead
   code, never called.
2. `ScaleBar` reports physical meters in ideaspace, contradicting §9.1.

### Uncertainty

- **§11.2 and §11.3 contradict each other.** §11.2 gives the black sun a *point*
  `(0,0,2^84)`; §11.3 calls facing it "looking toward +Z_cs". From a pubkey-derived
  spawn (x,y random near 2^84) the bearing to that point is ≈`(-x,-y,·)`, not +Z.
  These only reconcile if it is a direction at effective infinity. Needs a ruling;
  it changes what 04 builds. Raised as ticket 07.
- Client claims are from source, not from a running browser. The two worth
  confirming before designing against them are the LCA ramp degeneracy and the
  terrain-reads-as-noise claim.
