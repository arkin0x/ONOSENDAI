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

- [03 — What is the spatial model?](issues/03-spatial-model.md)
  — **Perspective, orbiting a 49³ volume, with bloom and the room nest.** Variant
  C won on the strength of the 3D boxes; A's bloom and B's rooms came with it.
  Click-to-cursor is replaced by free orbit around the cursor. The volume is
  affordable only because of the block cache: 117,649 cells resolve from 343
  samples at scaleExp 0. Created four follow-ups, notably that the boundary grid
  is still plane-shaped and streaks across the volume, and that the 6.9s fill is
  CPU scanning rather than hashing.

- [07 — Is the black sun a point or a direction?](issues/07-black-sun-geometry.md)
  — **Neither: conceptually at `+Z` infinity, rendered as a scale-relative
  proxy.** A recommended guidepost beyond the `+Z` end, visible iff the frustum
  contains the `+Z` direction, at any scale. Drawn as a polygon big enough to
  always read, placed at the `+Z` face of whatever volume is primary at the
  current scale (the sector, or the containing room) and repositioned as that
  changes. It therefore has no coordinate — §11.2's u85 triple is a category
  error — and imposes no projection requirement. §11.2 and §11.3 never
  contradicted. Ticket 04 inherits the question of which volume is primary.
  **Superseded in build, 2026-08-22:** the sun is a fixed-size ring pinned to the
  camera along +Z_cs, so there is no volume and the inherited question dissolved.
  Being at infinity means no parallax and constant apparent size, and pinning
  gives both without a coordinate; a proxy on a volume's face would have needed
  repositioning and would have blinked out wherever no such volume is drawn.

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

- **Ideaspace still measures itself in metres.** The rest of this patch
  graduated: `ScaleLadder` answers hierarchy with landmarks from the gibson up to
  the axis, and the cursor carries a physical-size label. The defect did not
  graduate, it MOVED. `ScaleBar` is gone, and `formatCellSize` now prints metres
  unconditionally in three places (ladder, ladder landmarks, cursor label),
  including in ideaspace, which §9.1 says has no physical mapping at all.
- **Prefetch for volumes.** The random-walk prefetch was removed when terrain
  became a volume: it speculated a plane ahead, and speculating whole volumes
  costs more than it saves. Needs a redesign around what is actually cheap to
  speculate now, probably blocks rather than volumes.
- **Path and history.** Where have you been, across scales and rotations, and how
  does the trail stay meaningful when a single step can cross a wall?
- **Dataspace vs ideaspace.** Two planes sharing XYZ; currently a toggle with no
  perceptual difference at all.
- **The HUD's role.** A policy has emerged in the diffs without ever being
  written down: *if the world can carry it, the panel loses it*. The XOR readout
  is the counter-case that sharpens it, since it left the panel column for the
  scene while staying DOM text: the world cannot draw arithmetic, so the readout
  is neither panel nor geometry but an instrument laid over the space. Open
  question is now narrower than "how much HUD should exist": what belongs to
  that third category, and does anything remain that is genuinely a panel?
- **Terrain visual language.** Ticket 02 measured the real hill structure: K is
  constant across every aligned 2^3 cube, and within an aligned 2^7 cube K spans
  a 4-wide band against a global range of 2..15 — so the 128-cube sets base
  elevation and the 8-cube adds roughness. Isolated dots cannot show a plateau,
  which is why the field reads as noise above scaleExp 3. Rendering the base
  elevation is the open question — but scoped *down*, per 02's priority
  inversion finding.
- **GPS / §9 dataspace bridge.** Partly graduated. §9.7's mapping is implemented
  and Earth is drawn at true protocol scale, so "where am I actually" has an
  answer in the world. What did not graduate is the consensus-critical half:
  golden vectors, and any mapping of arbitrary real places rather than the one
  planet. See also the reachability patch below, which is the reason the answer
  currently cannot be walked to.
- **Region primitives are sitting unused.** `deriveRegionN`,
  `deriveRegionKeyMaterial` and `deriveRegionKeyMaterialScan` are exported by
  `cyberspace-core` and never called from `src/`. Whatever containment ends up
  looking like, the maths for it already exists.
- **Cyberspace as a platformer.** A room you have paid for is a region of
  spatially-free movement: §4.7 says many coordinate pairs inside one aligned
  subtree share a root, and `compute_subtree_cantor` builds bottom-up, so paying
  for height `h` yields every subtree inside it. Terrain K is the only remaining
  per-hop cost. That makes the room a *level*: move freely inside, pay to leave.
  Gravity is spec-native, since §11.1 makes `+Y_cs` up. Leaving a room becomes a
  deliberate mechanic that happens to be a protocol-valid subtree transition, and
  the cost structure becomes diegetic rather than annotated.
  The tension to resolve: hops are discrete signed events costing up to ~100ms of
  temporal work (§5.2), so continuous motion cannot be 1:1 with protocol
  movement. v2's existing cursor/commit split already answers this — free motion
  is the uncommitted layer, commits are the chain — and a platformer where moving
  is free but *keeping* a position costs work is honest to the mechanic.
  Note shards are **not** in the v2 spec or any DECK; they were a v1 concept.
  Platforms and obstacles would be app-level content or need a DECK, with
  `kind:33330` region-keyed content (§8.6) the nearest protocol hook.
  **Ruled: opportunistic, not a destination redraw.** The destination stays
  spatial perception. The platformer is a target to take if the work passes near
  it, not one to steer toward. No ticket redraws itself for it; if a variant or a
  control scheme happens to land close, take the shot.
- **The DECKs as navigation.** Hyperjumps (DECK-0001) are a navigation primitive,
  and virtual spawn (PR #15) would allow cheap synthetic avatars for local
  iteration. Both may become navigation/visualization questions later.
- **Reaching a target you can see.** The target system points at anything from
  anywhere and there is nothing you can do about it. There is no goto and no way
  to turn a chevron into a move: `moveCursor` steps one cell and
  `setCursorAtCell` is bounded to the drawn grid. Pointing at something you can
  never travel to is a tease, and it generalises the moment other avatars become
  targets.
- **A landmark you can never reach is a landmark that lies.** Earth is drawn at
  true scale and the chevron reports its distance honestly, but the globe only
  renders between roughly scaleExp 50 and 56, and at those scales it is still
  ~1e8 to 2e10 cells from a pubkey-derived spawn, so it also fails the reach
  cull. There is no scale at which Earth both renders and is near you. Its own
  patch, because the fix is a navigation mode rather than a rendering change.
- **The ramp has no headroom at high scaleExp.** Absolute heights on the LCA ramp
  are deliberate (`88498fb`), so at scaleExp `s` the reachable band starts at
  `s+1` and by the 50s the whole scene is orange through red. The ramp stops
  discriminating exactly where crossings get interesting. This is the honest
  residue of the dead baseline instruction that used to open ticket 05.
- **Nothing refuses a computation it cannot finish.** No sidestep ceiling exists
  in the store, the worker, or core. An h60 sidestep is offered with a plain
  seconds figure against what §6.13-6.14 put at roughly 731 years. Arguably 05's,
  arguably its own patch. A defect either way, not a design question.
- **Two orientation frames coexist and the readouts use the stale one.** `view` is
  the snapped quaternion; `screenAxes` is the live orbit. Keys and pad both read
  `screenAxes ?? axes()`, but `Hud.tsx` reads `s.axes()`, so its screen-right and
  screen-up go stale the moment you orbit. `Compass3D` composes both correctly,
  which is why the compass and the panel disagree. Small bug, real question
  underneath: which frame is canonical for a readout?

## Decided in conversation, not yet on a ticket

<!-- The gap that let execution run ten days ahead of this map. Anything here is
     sharp enough to ticket and should become one at the next session. -->

- **Snap-to-Earth and spectating, as named anchors.** Rather than reworking the
  floating origin so distant things stay precise, the render origin stops being
  hardwired to the avatar and becomes a choice from a small set: your avatar,
  Earth, another pubkey. Inside any anchor everything works as it does now,
  because you are near what you are looking at, so the precision problem
  evaporates without touching the maths. Read-only while anchored away from your
  avatar, since at 2^52 a cell is 524,000 km and any commit from out there is a
  proof that will never finish. Snap scale 2^52, where Earth is 24.3 cells
  across, about half the view. This is the largest designed-but-unbuilt piece and
  it half-answers two of the fog patches above.

## Out of scope

- **On-wire protocol participation** — signing and publishing `kind:3333`
  spawn/hop/sidestep, reading other pubkeys' chains, rendering other avatars.
  Deliberately deferred: the goal is to iterate on cheap local data first.
- **HOSAKA integration** — cloud offload of Cantor work via the Modal-hosted
  REST API (NIP-98 auth, Lightning-funded msat balance, LCA-based routing). Its
  own map, with its own destination.
