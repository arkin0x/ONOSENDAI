# 05 — How do you *see* what a move costs?

Type: prototype
Status: open
Blocked by: 03

## Question

Goal two of the map: **communicating the protocol intuitively.** This is the
sharpest instance of it.

The spec calls it the protocol's "central and least intuitive property": cost is
set by which power-of-two boundary you cross, not by how far you travel. Moving
7→8 costs 16× moving 4→5, for the same single gibson. At the extreme, one step
across 2^34 requires a tree of 17 billion leaves. And by decomposition
invariance (§4.8) you cannot dodge it by taking small steps — the wall is real
and there is no way around it.

**Start by fixing the baseline, or you will evaluate against a broken one.**
Ticket 02 found `BoundaryGrid.tsx:65,71` passes the *absolute* height to
`boundaryColor`, whose parameter is documented as *excess over the floor*
(`palette.ts:96`). At scaleExp `s` the cheapest possible crossing is already
height `s+1`, so above roughly scaleExp 5 every ordinary gridline saturates and
the colour ramp carries no information at all. The helper written for exactly
this, `boundaryIntensity(height, floor)` (`palette.ts:69`), exists and is never
called. Confirm the degeneracy in a browser before and after.

Today `BoundaryGrid` colours gridlines by crossing height, which is a start, and
`estimateHopCost` / `estimateSidestepCost` exist in `cyberspace-core` and are
never called. So you commit a move *before* learning what it costs.

Make the cost structure perceivable **in the space**:

- Can you see the wall standing in front of you before you walk into it? A
  height-34 boundary should read as impassable, not as a slightly brighter line.
- Can you tell a cheap corridor from an expensive one at a glance, and route
  around walls the way you would route around a building?
- Before committing, do you know what this specific crossing costs — and is it a
  hop or a sidestep (§6.13: whole continents are hop-impossible and only
  sidestep-crossable, and above ~h60 neither works)?
- Does terrain K read as the temporal landscape it is — hills you climb — rather
  than as decorative dots?
- Does the interface distinguish *expensive* from *impossible on this machine*?
  Note `MAX_COMPUTE_HEIGHT = 20` is a single hard-coded ceiling, and the client
  will currently offer an h60 sidestep with a bare seconds figure (§6.13-6.14
  say h60+ is a ~731-year computation).

Ticket 02 also found a **priority inversion** worth correcting here: terrain K is
capped at 16, so ~65,536 pairings or about 100ms, yet it occupies the entire
visual field, while LCA — the dominant cost by many orders of magnitude — gets
thin lines. Terrain is over-served relative to its weight.

Ticket 01 notes v1's one good answer here: it showed distance to the nearest
hyperjump in gibsons **and** a d/h/m/s ETA at current speed. Cost expressed as
*time* was the only place v1 answered "what does crossing to it cost", and time
is a unit people already have intuition for.

Resist solving this with a number in a panel; that is the CLI's job and it
already does it. The test is whether someone who has never read §4.4 can look at
the screen and correctly predict which of two single-gibson steps costs more.

Deliverable: merged and browser-verified, with the answer recording the encoding
chosen and what it rejected.
