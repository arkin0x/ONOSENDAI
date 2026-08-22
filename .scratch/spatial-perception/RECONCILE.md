# RECONCILE: the map against what shipped

DRAFT. Nothing here has been applied. No ticket and no `map.md` was touched.

Range examined: `4e85ed2..v2`, which is 35 commits between 2026-08-11 and
2026-08-16. `4e85ed2` (*docs(map): resolve ticket 03*) is the last commit that
touched anything under `.scratch/spatial-perception/`.

## Bottom line

1. **Ticket 06 is finished and undecided.** Every question it poses except one
   has been answered in code. It is a `grilling` ticket, so the answer can only
   be written down with you in the room. The one genuinely open question left in
   it is its own headline: is there a traversal mode, or is cursor-plus-commit
   the final answer?
2. **The black sun still does not exist.** It is ticket 04's first bullet, it is
   the entire output of closed ticket 07, and there is no geometry for it
   anywhere in `src/`. Everything else in 04 shipped around it.
3. **Ticket 05's opening instruction is moot**, and its most important bullet
   (expensive versus impossible on this machine) is untouched. Those are not the
   same thing: one is bookkeeping, the other is real remaining work.
4. **Earth renders in a window nothing can reach.** Confirmed by arithmetic
   below. This is not a bug in `Earth.tsx`; it is the reason the "snap to Earth"
   observer mode exists as a conversation decision.
5. All three open tickets are HITL by the type taxonomy, so **none of them can
   be closed by an agent working alone**, and Wayfinder also caps a session at
   one non-research resolution. The realistic move is one session per ticket,
   06 first because it is closest to written-down.

The map's own Notes already sanction building before deciding ("Execution rides
in the map"). What went wrong is not that execution ran ahead. It is that
nothing was recorded behind it.

---

## 1. Per open ticket

### 04: How does the interface tell you where you are?

`Type: prototype` (HITL). Blocked by 03, which is closed, so it is on the
frontier.

**What shipped against it, unrecorded:**

| Ticket bullet | Shipped | Where |
| --- | --- | --- |
| The black sun | **No** | nothing |
| Sectors as visible structure | Yes | `src/scene/SectorBox.tsx` (`c961e98`) |
| Region structure (aligned subtrees) | Yes | `src/scene/Rooms.tsx` (`7efc4c8`, `24209be`, `88498fb`) |
| Origin and axis structure | No | Compass only, `src/scene/Compass3D.tsx` |
| What else deserves to be absolute | Partly | sector cage is absolute; origin and axis extents are not drawn |
| Distinctiveness / recognisable on return | Partly | sector id on the cage wall; terrain unchanged |
| Destination: what tells you about the place you are aiming at | Partly | cost, not place: `src/scene/CoveringBox.tsx`, `src/scene/Cursor.tsx` |

Plus three things the ticket did not ask for and got anyway: Earth at true
protocol scale (`src/scene/Earth.tsx`, `ec2fc9e`), the target system
(`src/lib/targets.ts`, `src/hooks/useTargets.ts`, `src/scene/TargetProjector.tsx`,
`src/hud/Targets.tsx`, `c3d3521` and `6c910b2`), and the scale ladder
(`src/hud/ScaleLadder.tsx`, `c3d3521`).

**The sector cage.** `SectorBox.tsx:40-47` draws it at true size and culls it
outside roughly scaleExp 23 to 30, with the id on the wall at `:81-89` as
`SECTOR h30 / <tag>`. This is ticket 01's "sector name on the sector wall at
world scale" technique, taken **half**: it is on the wall, but it prints
`sectorTag(...)` (the numeric `sx-sy-sz` triple) rather than v1's pronounceable
`generateSectorName`, which lives at `origin/master:src/components/Cyberspace/SectorManager.tsx`
and is not exported by `cyberspace-core`. That matters for the "recognisable on
return" bullet, which is still open: a numeric triple is not a name you
remember.

**The lattice.** `Rooms.tsx:67-71` draws three consecutive heights (`scaleExp+3`,
`+4`, `+5`), each with `span: 0`, so what is on screen is exactly the nest: the
cell you are in, the cell that cell is in, and the one outside that. Each is
labelled with its height and the floor cost to leave it (`:179`). `:150` stops
the levels once `scaleExp + d` passes `AXIS_BITS`.

**Correction to the brief.** The brief lists "the nest highlight" as a separate
shipped item. It is not currently a separate thing. The nest highlight from
`7efc4c8` (the avatar's cell lit, the cursor's cell lit differently) was
**removed** in `673e9dc` and replaced by the covering box, whose commit message
says so explicitly. What remains is the nest *as* the lattice: three concentric
labelled boxes, no per-cell highlight.

**What genuinely remains on 04:**

- The black sun. `grep -rni "black.sun" src/` returns five hits and not one is
  geometry: `src/hooks/useKeyboard.ts:68-73` (the `C` key), `src/hud/Hud.tsx:166`
  (a control-list row), `src/hud/ViewMenu.tsx:61` (a `SUN` button that calls
  `canonicalView()`), `src/lib/space.ts:188-205` (`canonicalQuaternion`), and
  `src/lib/targets.ts:5`, which describes a target as "Earth today, the black
  sun once it exists". The code admits it in its own docstring. So the app
  currently ships a keyboard shortcut and an on-screen button that orient you
  toward a landmark that is not drawn.
- The open question ticket 07 handed down, which volume is primary, is the exact
  thing 04 was told to decide, and it is now decided in conversation but not on
  the map. See section 4.
- Origin and axis extents as visible structure. Not attempted.
- Place identity beyond the sector tag.

**Verdict:** not close enough to resolve. The one bullet that arrived
fully pre-specified is the one that was not built, and it is the headline. My
recommendation is to build the black sun to decision (a) in section 4, then
resolve 04 in a single session that records the whole landmark set at once,
including what was rejected: no origin marker, no axis extents, sector chosen
over subtree as the absolute lattice.

### 05: How do you *see* what a move costs?

`Type: prototype` (HITL). Blocked by 03, closed. On the frontier.

**The baseline instruction is moot, three times over.**

The ticket says to start by fixing `BoundaryGrid.tsx:65,71`, which pass the
absolute height to `boundaryColor`. Those lines are still exactly as described
and still unfixed. But:

1. **The component is orphaned.** `grep -rn "BoundaryGrid" src/` returns only
   its own file plus two stale docstring references. `Scene.tsx` does not import
   it. It was unmounted in `1ad01f5` ("hide the LCA grid"), and the comment left
   behind at `Scene.tsx:71-77` says it is "Kept in the tree for ticket 05",
   which is not true: there is no element and no import, only the comment where
   the element used to be.
2. **The code path was replaced.** Crossing cost is now carried by
   `src/scene/Rooms.tsx` (lattice walls on the ramp), `src/scene/CoveringBox.tsx`
   (the box you would pay for) and `src/scene/CrossingFlash.tsx` (the box you
   did pay for). None of them goes through `BoundaryGrid`.
3. **Absolute height was subsequently chosen on purpose.** `88498fb` ("the
   lattice climbs the cost ramp again") deliberately feeds absolute heights to
   the ramp so hue encodes total cost rather than excess. `src/hud/Legend.tsx:9`
   samples it at `[5, 20, 40, 60, 80]`, `src/lib/palette.ts:78` (`latticeShade`)
   passes absolute height, `src/scene/CrossingFlash.tsx:63` passes `c.peak`.

So the "confirm the degeneracy in a browser before and after" step has nothing
to run against. `boundaryIntensity(height, floor)` (`src/lib/palette.ts:135`) is
still exported and still never called; the only reference is a comment at
`src/scene/Rooms.tsx:24` claiming it is what the lattice's floor-relative
heights were written for, which describes an approach the lattice does not
actually take.

**What shipped against it, unrecorded:**

- **The covering box.** `src/scene/CoveringBox.tsx` (`673e9dc`). The smallest
  aligned box containing avatar and cursor, drawn before you commit, labelled
  `h X/Y/Z` and total Cantor ops at `:90`, filled in proportion to size at
  `:72-74`, cyan normally and `DANGER` red when `estimateHopCost().exceedsLimit`
  at `:80`. `3647357` fixed it wandering off screen by bracketing the endpoints
  when the true region is too large (`src/lib/covering.ts:83-89`), with the
  reported cost never clamped.
- **Lattice cost-to-leave labels.** `src/scene/Rooms.tsx:179`, reading
  `h{height}  {ops}+ ops to leave`. `5401bb3` corrected the quantity from
  `subtreeCantorOps(height)` (the priciest move that stays inside) to
  `subtreeCantorOps(height + 1)` (the floor to get out), which is the right
  reading.
- **SI-scaled ops formatting.** `src/lib/space.ts:337-356` (`58cbd37`), now
  running to yotta, because the lattice quotes `2^(h+1) - 1` and h runs to 85.
- **`estimateHopCost`, sidestep and `MAX_COMPUTE_HEIGHT` genuinely wired.**
  `src/store/useCyberspace.ts:44` defines the ceiling; `:278-285` routes hop
  versus sidestep on `exceedsLimit`; `:493-501` (`sidestepTarget`) computes the
  landing per axis. `estimateSidestepCost` is live in two places:
  `src/hud/ProofPanel.tsx:49` (live pre-commit preview) and
  `src/workers/proof.worker.ts:69`.
- **The crossing flash** (`src/scene/CrossingFlash.tsx`, `7efc4c8`): the paid
  region strikes white and settles into its cost hue at `:116`.
- **The cursor tether splits** at a sidestep landing, purple leg then remainder
  leg, red if the remainder is still blocked (`src/scene/Cursor.tsx:93-111`,
  `:142-156`).

All four of the brief's claims for 05 are confirmed.

**What genuinely remains on 05:**

1. **"Does the interface distinguish *expensive* from *impossible on this
   machine*?"** No, and this is the important one. `MAX_COMPUTE_HEIGHT = 20`
   is still one hard-coded constant (`src/store/useCyberspace.ts:44`). There is
   no ceiling on sidesteps at all: the store routes to sidestep for anything
   over h20 (`:284`), `estimateSidestepCost` deliberately has no feasibility
   flag, and the worker computes whatever it is handed
   (`src/workers/proof.worker.ts:68-92`). The only signal is
   `src/hud/ProofPanel.tsx:94-96`, a "Rough time" figure divided by a
   hard-coded 1.5M hashes per second and passed to `formatMs`
   (`src/lib/space.ts:328-332`), which above one second prints bare seconds to
   two decimals. An h60 sidestep is about 6.9e18 hashes and renders as roughly
   `~4611686018427.39 s`. §6.13-6.14's 731 years appears nowhere in the code.
   The ticket's bullet is still live verbatim.
2. **"Can you see the wall standing in front of you before you walk into it?"**
   No. Every level of the lattice has `span: 0` (`Rooms.tsx:67-71`), so the only
   walls drawn are the three around you. There is nothing on screen to compare
   against, and no route reading: you cannot see that the corridor to the left
   is cheap and the one ahead is a wall. The covering box only appears once you
   have already aimed at the crossing, which answers "what does *this* cost",
   not "where are the walls".
3. **Terrain as hills you climb.** Untouched. Still points sized and coloured by
   K in `src/scene/ShaderPointField.tsx`. 02's priority inversion is now
   half-corrected by attrition rather than by design: the field fades to nothing
   at its rim (`4cf6c71`) and the floating terrain legend was deleted
   (`6296d77`), so terrain is quieter, but the base-elevation reading 02 asked
   for is not drawn.
4. **Cost as time.** v1's d/h/m/s ETA was the one thing 01 flagged as worth
   stealing here, and only `formatMs` (ms and s) was taken.

**Verdict:** further along than 04, and still not resolvable. Items 1 and 2 are
both real design questions, not polish. Item 1 in particular is a
money-where-your-mouth-is case: the client will currently accept a commit it
cannot finish this century.

### 06: What are the controls?

`Type: grilling` (HITL). Blocked by 03, closed. On the frontier.

Confirmed: this is a grilling ticket with no recorded decision, and the controls
were rebuilt anyway. The rebuild is substantial.

**What shipped:**

- **On-screen pad, desktop and mobile.** `src/hud/TouchControls.tsx` (`145565a`),
  then ungated from the breakpoint in `810e4f2` so it renders everywhere
  (`src/App.tsx:55`). Nine cells: six directions, scale readout in the hub, two
  scale steps. Press-and-repeat at `TouchControls.tsx:45-79`. Directions resolve
  through the same `moveDirection` helper the keyboard uses
  (`src/lib/moves.ts`), so the two input paths cannot disagree.
- **The out-axis given real glyphs.** `TouchControls.tsx:108,110`: the physics
  convention for a vector through the page, plus the words FAR and NEAR added in
  `6296d77` because the glyphs alone do not survive 12px.
- **Avatar travel.** `src/scene/Travel.tsx` and `src/lib/travel.ts` (`331d9af`).
  Note the invariant it protects: `position` still moves in one step, and the
  *drawing* trails. `travel.ts:8-13` says explicitly that animating `position`
  would put coordinates in the store that no proof covers.
- **Camera glide.** `src/scene/Scene.tsx:226-286` (`77b4a9f`), `FOLLOW_TAU` at
  `:58`. The commit separates three cases that look identical in the numbers: a
  change of render frame (applied whole), cursor motion (eased), and a zoom
  (snapped, since rescaling leaves no path to ease along).
- **Free orbit, with the 90-degree snaps kept as recovery.** `Scene.tsx:198-299`.
  `Shift+WASD` re-locks the camera to the cursor; orbiting breaks the lock.
- **Screen-relative controls under free orbit.** `Scene.tsx:110-153`
  (`ScreenAxes`), with the claim-one-at-a-time fix at `:130-141` so that near 45
  degrees two basis vectors cannot round onto the same cyberspace axis and
  strand R/F.
- **View menu on the compass.** `src/hud/ViewMenu.tsx` (`145565a`): rotate, back,
  top, sun, plane.
- **Tap semantics.** `src/App.tsx:37-46` plus `src/hooks/useCanvasTap.ts`: a tap
  on empty scene now toggles the pad (and dismisses the view menu first). This
  replaced tap-to-cursor as the primary tap meaning.
- **Zoom buttons matched to Q/E** (`58cbd37`) and disabled at the ends
  (`TouchControls.tsx:120,122`).

**Against the ticket's own questions:**

| Question | Answered in code? |
| --- | --- |
| Is there a traversal mode at all? | **No.** Still cursor-then-commit. The travel animation is drawn motion by construction, not a mode. |
| Cursor or avatar? | Unchanged (cursor), now dressed with tether, covering box and travel, but not revisited. |
| Scale as navigation | **No.** `adjustScale` (`useCyberspace.ts:319-323`) still swaps the exponent instantly. Variant D was not taken: `Rooms.tsx` draws three levels *relative to* the scale floor, so zoom does not select which room you are in. The ladder made the position legible without making the act a movement. |
| The out-axis | Yes. Live screen axes plus glyphs and words. |
| Rotation | Decided by addition: discrete snaps kept, free orbit added, snaps demoted to a way out of an orbit. |
| Mobile | Yes, first-class. Breakpoint moved to 1100 (`src/hooks/useIsMobile.ts:15`) and the pad ships on desktop too. |
| Mode switching | Moot. There are no modes, so v1's Canvas-unmount problem cannot recur. |

**Verdict:** the closest to done and the least legitimate to close silently. Five
of seven questions are answered by construction and one is moot; the ticket
needs one session to write them down, plus a real answer to the one that is
still open. My reading is that the honest answer to "is there a traversal mode"
is currently "no, and the glide plus the travel animation are what we bought
instead", but that is a decision, not a finding, and it is yours.

---

## 2. Fog graduation

### Graduated, should come out of *Not yet specified*

- **Scale legibility.** Answered by the scale ladder
  (`src/hud/ScaleLadder.tsx`), the always-on cell-size label riding the cursor
  (`src/scene/Cursor.tsx:188-200`, `4694f3c`), and the lattice's per-level "ops
  to leave" labels (`Rooms.tsx:179`), which is the hierarchy half: a step at
  2^60 visibly costs more than a step at 2^0 because the label says so and
  changes with zoom while the box does not. Belongs under 04 or a short
  follow-up when 04 resolves.

  **The sub-defect did not graduate, it migrated.** `ScaleBar` no longer exists.
  `formatCellSize` (`src/lib/scale.ts:44`) reports metres unconditionally, with
  no `plane` parameter anywhere in `src/lib/scale.ts` or
  `src/hud/ScaleLadder.tsx`, and it is printed in both planes at
  `ScaleLadder.tsx:54` and `Cursor.tsx:189`. The ladder's `human`, `kilometre`
  and `Earth` landmarks (`ScaleLadder.tsx:28-35`) are likewise shown in
  ideaspace, where §9.1 says there is no physical mapping. This is now three
  places rather than one.

- **Mobile.** Answered. Pad, view menu, tap-to-dismiss, breakpoint agreement
  between React and the stylesheet. Record under 06 rather than leaving it as
  fog.

### Half graduated, the entry should be rewritten to the residue

- **Dataspace vs ideaspace.** The fog says "a toggle with no perceptual
  difference at all". That is no longer true: Earth draws only in plane 0
  (`src/scene/Earth.tsx:63`) and the target list is empty in ideaspace
  (`src/hooks/useTargets.ts:25`). One real difference, and it is the right one,
  since it follows from the physical mapping rather than from decoration.
  Everything else about the two planes is still identical, including the scale
  readouts, which is the defect above. Rewrite the entry to that residue.

- **The HUD's role.** No decision was recorded, but a de facto policy is now
  visible in the diffs: *if the world can carry it, the panel loses it.* The
  floating terrain legend was deleted as duplicated by the world (`6296d77`),
  the sector id moved onto the cage (`SectorBox.tsx:81-89`), the cost moved onto
  the covering box (`CoveringBox.tsx:90`), and the panels became dismissible on
  desktop (`App.tsx:65-76`). The panel set itself is otherwise unchanged
  (`Hud.tsx:191-208`: Identity, Position, Scale, Proof, Chain, Legend,
  Controls). Keep as fog, but write the emerging rule into it so the next pass
  starts from it.

- **GPS / §9 dataspace bridge.** Thinner than it was. `Earth.tsx:29-44` is the
  first thing in the client to consume §9.7 exactly (`units_per_km = 1000 * 2^33`,
  centre at 2^84), and every landmark on the ladder derives from the §9.2
  anchor. Still fog, still large and consensus-critical, but the entry should
  note the foothold.

### Still genuinely fog, untouched

- **Prefetch for volumes.** `grep -rni "prefetch|random walk" src/` returns
  nothing. Unchanged.
- **Path and history.** `src/scene/PathTrail.tsx` was fixed to be genuinely 3D
  (`:30-36`, `bedeab9`) and to ride the travel offset (`331d9af`), but the fog's
  actual question is untouched: the trail is one flat red polyline with no cost
  encoding, it re-projects wholesale on every zoom, and nothing about it says a
  step crossed a wall.
- **Terrain visual language.** Untouched.
- **Region primitives sitting unused.** Still true verbatim:
  `grep -rn "deriveRegionN|deriveRegionKeyMaterial" src/` returns nothing.
- **Cyberspace as a platformer.** Untouched, still ruled opportunistic.
- **The DECKs as navigation.** Untouched.

### New fog, not yet written down

1. **Reaching a target you can see.** The target system can point at anything
   from anywhere and there is nothing you can do about it. There is no goto, no
   "aim the cursor at that target", no way to turn a chevron into a move.
   `moveCursor` steps one cell (`useCyberspace.ts:236-246`) and
   `setCursorAtCell` (`:248-266`) is bounded to the drawn grid. Decision (b)
   below half-fills this for Earth; it generalises the moment other avatars
   become targets, and "point at it but never go there" is a tease.
2. **A landmark you can never reach is a landmark that lies.** The ladder marks
   Earth at h56.6 and the chevron reports its distance honestly, but the globe
   never renders from a spawn (arithmetic in section 5). Worth its own patch,
   because the fix is a navigation mode rather than a rendering change.
3. **The ramp has no headroom at high scaleExp.** Absolute heights on the ramp
   are deliberate (`88498fb`), which means at scaleExp *s* the reachable band
   starts at *s+1*, and by the 50s the whole scene is orange through red. The
   ramp stops discriminating exactly where crossings get interesting. This is
   the honest residue of the question ticket 05's baseline instruction was
   groping at, and it should replace that instruction rather than be dropped
   with it.
4. **Nothing refuses a computation it cannot finish.** See 05 item 1. Arguably
   05's, arguably its own patch.
5. **Two orientation frames now coexist and the HUD reads the wrong one.**
   `view` is the snapped quaternion; `screenAxes` is the live orbit
   (`useCyberspace.ts:421-432`). The keys use `screenAxes ?? axes()`
   (`useKeyboard.ts:40`) and so does the pad (`TouchControls.tsx:93`), but
   `src/hud/Hud.tsx:96` reads `s.axes()`, so "Screen right", "Screen up" and
   "Looking along ..." (`:111-117`, `:138`) all report the snapped frame and go
   stale the moment you orbit. `Compass3D` gets this right (it composes the
   snapped permutation with the live `cameraPose` at `:67-79`), which is why the
   compass and the panel disagree. Small bug, real design question underneath:
   which frame is canonical for readouts?

---

## 3. Dead or stale entries

**In the code:**

- `src/scene/BoundaryGrid.tsx` is orphaned. No import anywhere. It still renders
  a flat `z = 0` lattice, which cannot work in a perspective volume, and it is
  the file ticket 05 opens by instructing you to fix. Three docstrings still
  point at it as an authority on the render frame: `src/lib/space.ts:137`,
  `src/scene/ShaderPointField.tsx:8`, and `src/hooks/useViewWindow.ts:6-7`. The
  comment at `src/scene/Scene.tsx:71-77` claims it is "Kept in the tree", which
  is false: there is no element there, only the comment.
- `boundaryHeight` and `boundaryCoord` (`src/lib/space.ts:73-94`) are used only
  by `BoundaryGrid`, so they are dead in the app. Both are still covered by
  `src/lib/space.test.ts:59-60`, as are `subCellFraction` and `trailingZeros`,
  which have no app callers at all. Live tests over dead code.
- `boundaryIntensity` (`src/lib/palette.ts:135`) is exported and never called.
- `boundaryColor(excess)` (`src/lib/palette.ts:163`, docstring at `:141-149`)
  names and documents its parameter as excess over the floor. Every caller
  passes absolute height, on purpose. The docstring is now actively misleading,
  and it is the docstring ticket 02 cited as evidence.
- `src/lib/targets.ts:5` says "the black sun once it exists".

**In the map:**

- *Not yet specified* → **Scale legibility**: "`ScaleBar` reports meters in
  ideaspace". The component is gone; the defect lives on in `formatCellSize` and
  is now printed in three places.
- *Not yet specified* → **Dataspace vs ideaspace**: "no perceptual difference at
  all" is no longer true.
- *Decisions so far* → **03**: the follow-up it recorded, "the boundary grid is
  still plane-shaped and streaks across the volume", was resolved by *deletion*
  (`1ad01f5` unmounted it) rather than by fixing. The other follow-up it
  recorded, "the 6.9s fill is CPU scanning rather than hashing", was also
  addressed: `VOLUME_RADIUS` is now 9 (`src/hooks/useTerrainVolume.ts:36`) and
  rebuilds are throttled at `:41`. Neither outcome is on the map.
- *Notes* → **Verify by looking**: `scripts/verify-browser.mjs` still exists, so
  this one is fine.

**In the tickets:**

- **05**'s entire "Start by fixing the baseline" paragraph, for the three
  reasons in section 1. Also its citation `palette.ts:96` / `palette.ts:69`: the
  functions are now at `:163` and `:135`.
- **04**'s "The app implements the view (`canonicalQuaternion`, the `C` key) and
  renders no marker" is still exactly true, and has got slightly worse: there is
  now also a `SUN` button (`ViewMenu.tsx:61`) pointing at nothing.
- **06**'s "v2 today" inventory is stale in four places. The key list is still
  right, but: mobile is no longer "tap-to-cursor plus a hamburger for panels"
  (tap toggles the pad, `App.tsx:37-46`); the pad is not mobile-only; free orbit
  exists; and there is a compass-summoned view menu. Its framing sentence, "it
  is precise and entirely modal, nothing about it feels like moving through a
  place", has been partly falsified by the camera glide and the avatar travel,
  which is worth saying in the answer rather than quietly deleting.
- **02**'s "`estimateHopCost` / `estimateSidestepCost` exist and are never
  called", quoted inside 05, is now false in both directions. Both are called,
  in the store, the worker, the proof panel, the cursor and the covering box.

---

## 4. Decisions taken in conversation, not yet on the map

Both are pending map updates. Neither is recorded anywhere in
`.scratch/spatial-perception/`.

**(a) The black sun is a fixed-size cube face centred on the camera, painted on
`+Z_cs`, with no parallax.** This dissolves ticket 04's inherited open question
rather than answering it: if the proxy is camera-centred there is no "primary
volume" to attach it to, and the sector-versus-subtree choice ticket 07 handed
down stops existing. Worth recording as a dissolution, since 07's answer text
explicitly poses the question and a future reader will look for where it went.
It is also consistent with 07's ruling (visible iff the frustum contains `+Z`,
no coordinate, no projection constraint) and cheaper than every option 07
imagined.

**(b) Rather than reworking the floating origin, a "snap to Earth" observer mode
under a menu, which also handles spectating other pubkeys, read-only while
anchored away from the avatar.** This is the answer to section 5's arithmetic
and to new-fog item 1. Note it also touches 06 (it is a mode, and 06's answer
should say whether it counts as one) and the map's *Out of scope* section, which
currently defers "reading other pubkeys' chains, rendering other avatars"; a
spectate mode is the client half of that, so the scope line may need a
qualifier.

---

## 5. Findings checked

| Claim | Verdict |
| --- | --- |
| All three open tickets are HITL: 04 and 05 `prototype`, 06 `grilling` | **Confirmed.** Ticket headers say so; Wayfinder `SKILL.md:78-79` marks both types HITL, and `:75` says a HITL ticket resolves only through the live exchange. `:105` also caps a session at one non-research resolution. |
| The black sun has never been rendered; only a shortcut and comments | **Confirmed**, and slightly understated: there is also a `SUN` button in the view menu (`ViewMenu.tsx:61`) and a docstring admitting the sun does not exist (`targets.ts:5`). |
| Ticket 05's baseline bug is moot because `BoundaryGrid.tsx` is no longer imported; `boundaryIntensity` is exported and never called | **Confirmed**, with two extra reasons the brief did not have: the code path was replaced, and absolute-height colouring was later chosen deliberately in `88498fb`. |
| Shipped against 04: sector cage with wall label, three-level lattice with cost labels, nest highlight, Earth at true scale, target system, scale ladder | **Confirmed except "nest highlight".** That was removed in `673e9dc` and replaced by the covering box. What ships now is the nest *as* the lattice, with no per-cell highlight. |
| Shipped against 05: covering box with heights and total Cantor ops, lattice cost-to-leave labels, SI ops formatting, `estimateHopCost` / sidestep / `MAX_COMPUTE_HEIGHT` wired into the store | **Confirmed**, all four. |
| Ticket 06 is a grilling ticket with no recorded decision, yet the controls were rebuilt: pad on desktop and mobile, out-axis glyphs, avatar travel, camera glide | **Confirmed**, and there is more than the brief lists: free orbit with snap-back, live screen axes, the compass view menu, and tap semantics changed from tap-to-cursor to tap-toggles-pad. |
| Earth only draws between diameter 1 and 192 cells (roughly scaleExp 50 to 56), and is still ~10^9 cells from a typical spawn, so it also fails the reach cull. No scale renders it near a spawn. | **Confirmed.** Measured below. The one number to adjust: the distance is not a single 10^9, it runs from ~1.7e10 cells at scaleExp 50 to ~2.7e8 at 56, against a reach of 240.6 and 192.8 respectively. Three to eight orders of magnitude over, at every drawable scale. |
| Two conversation decisions are not on the map | **Confirmed.** Nothing under `.scratch/spatial-perception/` mentions either. |

### The Earth arithmetic

`RADIUS_GIBSONS = 6371 * 1000 * 2^33 = 54,726,473,285,632,000`, which is 2^55.60
(`src/scene/Earth.tsx:29-41`). `GRID_RADIUS = 24` (`src/lib/space.ts:25`), so the
draw gate at `Earth.tsx:70` is `1 <= diameter_cells <= 192`:

```
scaleExp 49   diameter 194.427   culled (too big)
scaleExp 50   diameter  97.214   DRAWS
scaleExp 53   diameter  12.152   DRAWS
scaleExp 56   diameter   1.519   DRAWS
scaleExp 57   diameter   0.759   culled (sub-cell)
```

The second gate is the reach cull at `Earth.tsx:79-80`,
`|centre| > GRID_RADIUS * 8 + radius`. Over five uniform 85-bit-per-axis spawns:

```
scaleExp 50:  |centre| 6.8e9 .. 1.9e10 cells   reach 240.6   CULLED, every time
scaleExp 53:  |centre| 8.6e8 .. 2.3e9  cells   reach 198.1   CULLED, every time
scaleExp 56:  |centre| 1.1e8 .. 2.9e8  cells   reach 192.8   CULLED, every time
```

The two windows do not intersect, and cannot: making the globe small enough to
pass the first gate is exactly what pushes the centre distance up in cell terms
more slowly than the radius shrinks. `Earth.tsx:16-20` already says this in
prose ("You do not stumble across Earth. You go there, and until you do this
draws nothing"), so it is a known consequence rather than an oversight. What is
missing is any way to *go there*: there is no goto, and driving the cursor with
WASD at a scale coarse enough to matter is millions of keypresses. That is
decision (b)'s job.

---

## 6. Suggested order, for your call

1. **Resolve 06 first.** It is the closest to written-down and the answer is
   mostly transcription plus one genuine question (traversal mode, yes or no).
   Resolving it also unblocks nothing, which makes it cheap.
2. **Build the black sun to decision (a), then resolve 04.** 04 cannot honestly
   close before it, and (a) makes it a small change.
3. **Resolve 05 last**, and only after deciding the expensive-versus-impossible
   question, because that is the one bullet with no code behind it and the one
   with a real failure mode.
4. **Sweep the map in the same pass**, not separately: graduate scale legibility
   and mobile, rewrite the dataspace/ideaspace and HUD-role entries, add the
   five new fog patches, and record decisions (a) and (b).
5. The dead code (`BoundaryGrid` and friends, `boundaryIntensity`, the stale
   docstrings) is a one-commit cleanup that should ride along with 05's
   resolution, since 05 is the ticket that currently points at it.
