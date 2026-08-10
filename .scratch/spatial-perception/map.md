# Map: Spatial perception of Cyberspace

Label: `wayfinder:map`

## Destination

ONOSENDAI v2 delivers **spatial perception** of Cyberspace — the one thing
`cyberspace-cli` structurally cannot provide, and which a spatial protocol
requires in order to be *realized* rather than merely operable.

It threads the gap between the two extremes already built. v1 was embodied but
floaty: it could not move a single gibson or reach an exact point. v2 is precise
about position and cost but has no spatial feeling whatsoever.

Done when you can perceive **where you are and where you are going**, and read
**the protocol's own logic** off the world — and can still place the cursor on an
exact gibson and know what crossing to it costs. In something you want to be
inside.

## Notes

**Domain:** Cyberspace Protocol v2 (`/data/repos/cyberspace/CYBERSPACE_V2.md`),
its DECK extensions (`decks/`, plus five open PRs on `arkin0x/cyberspace`), and
the ONOSENDAI v2 client in this repo.

**The two goals, in priority order.** Visually communicating destination and
place; and communicating the protocol intuitively. Every ticket should be
traceable to one of them.

**Yardstick: comprehension and style.** A ticket passes only when what it shows
reads correctly *without explanation*, and it is something you want to look at
and be inside. Both halves are required: a legible instrument nobody wants to
inhabit loses to the CLI, and so does a beautiful one you cannot read.

**The CLI test.** `cyberspace-cli` already provides every primitive needed to
use Cyberspace with no visuals at all. If the CLI would do a thing better, it is
not this map's work. ONOSENDAI's advantage is spatial awareness, not capability.
Printing a number is usually the CLI's job; making the thing *perceivable in the
space* is ours.

**Nothing existing is load-bearing.** The current visual and interface patterns
are entirely up for redesign, replacement, or deletion. They were an attempt at
precision, not a foundation to defend. No ticket needs to justify departing from
them.

**Execution rides in the map.** This overrides Wayfinder's plan-don't-do default:
a ticket is not resolved until the change is merged and verified in a browser.

**Verify by looking.** Use `scripts/verify-browser.mjs` (Playwright + Chromium at
`/data/Sync/agents/claude/.playwright-browsers`). Reasoning about the render
without looking at it has produced wrong conclusions repeatedly; measure or
screenshot instead.

**Skills:** `/prototype` for anything visual, `/grilling` and `/domain-modeling`
for decisions, `/research` for AFK fact-finding.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [07 — Is the black sun a point or a direction?](issues/07-black-sun-geometry.md)
  — **A bearing, not a place.** Rendered at a fixed `+Z_cs` bearing so §11.3 holds
  from any coordinate. A literal point cannot: even after correcting the spec it
  averages 42.1° off `+Z` over 2000 spawns, because the marker is ~0.24
  light-years away while a random spawn is off-axis by a comparable distance.
  Found a spec defect worth its own fix — §11.2's u85 triple `(0,0,2^84)` puts the
  marker at the axis *middle* and the `-X,-Y` corner, leaving the "+Z guidepost"
  **behind 51.1% of all spawns**. The km figure was correct throughout; the km
  frame is cube-centred while u85 is corner-relative. Fix upstream in
  [cyberspace#17](https://github.com/arkin0x/cyberspace/pull/17).

- [01 — What made v1 embodied, and what made it floaty?](issues/01-v1-embodiment-post-mortem.md)
  — Two findings reframe the map. **Embodiment did not come from perspective**:
  v1's first-person view was black space plus distant wireframes with effectively
  no parallax, and the sky-grid/Black-Sun imagery lived only in the map and intro.
  What produced the feeling was bloom over black on line geometry, fog, the sector
  drawn as a room you are inside, world-scale labels on its wall, and a visible
  body. **Precision died because there was never a position command**: input was a
  direction quaternion plus a proof-of-work throttle, velocity was quantized to
  powers of two while position was continuous, there was no brake, and the
  working raycast-cursor-with-snap that existed in the shard editor was never
  wired to navigation. Ends with 17 things to steal and 16 that must not return.

- [02 — What must a spatial client make perceivable?](issues/02-protocol-perception-inventory.md)
  — Ranked inventory of the eight things the protocol needs made perceivable.
  The pick: **aligned-subtree containment, walls with magnitude, and the black
  sun**, which compose into one picture — *you are inside a nest of rooms, whose
  walls are thick in proportion to what they cost, all oriented by one fixed
  landmark*. Terrain K is over-served and should be scoped *down*; reachability
  is half CLI work. Also surfaced two client defects and a spec contradiction
  (now ticket 07).

## Not yet specified

- **Scale legibility.** `scaleExp` spans 0..84 and zoom is currently an instant
  lattice swap. How does the interface convey where you are in that hierarchy,
  and that a step at 2^60 is not the same act as a step at 2^0? Ticket 02 rates
  `ScaleBar` the best comprehension element in the client for *physical size*,
  and the *hierarchy* entirely absent. Small defect to sweep up here: ScaleBar
  reports meters in ideaspace, which §9.1 says has no physical mapping.
- **Path and history.** Where have you been, across scales and rotations, and how
  does the trail stay meaningful when a single step can cross a wall?
- **Mobile.** Whether whatever spatial model wins survives a phone, one-handed.
- **Dataspace vs ideaspace.** Two planes sharing XYZ; currently a toggle with no
  perceptual difference at all.
- **The HUD's role.** Once the world itself carries meaning, what is left for
  panels, and how much of the current HUD should exist?
- **Terrain visual language.** Ticket 02 measured the real hill structure: K is
  constant across every aligned 2^3 cube, and within an aligned 2^7 cube K spans
  a 4-wide band against a global range of 2..15 — so the 128-cube sets base
  elevation and the 8-cube adds roughness. Isolated dots cannot show a plateau,
  which is why the field reads as noise above scaleExp 3. Rendering the base
  elevation is the open question — but scoped *down*, per 02's priority
  inversion finding.
- **GPS / §9 dataspace bridge.** Mapping dataspace to real places would answer
  "where am I *actually*", which serves place-comprehension — but it is a large,
  consensus-critical workstream with golden vectors. In scope, not yet sharp.
- **Region primitives are sitting unused.** `deriveRegionN`,
  `deriveRegionKeyMaterial` and `deriveRegionKeyMaterialScan` are exported by
  `cyberspace-core` and never called from `src/`. Whatever containment ends up
  looking like, the maths for it already exists.
- **The DECKs as navigation.** Hyperjumps (DECK-0001) are a navigation primitive,
  and virtual spawn (PR #15) would allow cheap synthetic avatars for local
  iteration. Both may become navigation/visualization questions later.

## Out of scope

- **On-wire protocol participation** — signing and publishing `kind:3333`
  spawn/hop/sidestep, reading other pubkeys' chains, rendering other avatars.
  Deliberately deferred: the goal is to iterate on cheap local data first.
- **HOSAKA integration** — cloud offload of Cantor work via the Modal-hosted
  REST API (NIP-98 auth, Lightning-funded msat balance, LCA-based routing). Its
  own map, with its own destination.
