# ONOSENDAI V2

A spatial explorer for the [Cyberspace Protocol v2](https://github.com/arkin0x/cyberspace).

Move through the 85-bit axis space one step at a time and watch what each step
actually costs. The protocol's central and least intuitive property is that
movement cost is set by *which power-of-two boundary you cross*, not by how far
you travel. This makes that visible: bright gridlines are expensive crossings,
and the terrain underneath shows where the temporal work is concentrated.

> Status: MVP. Rendering verified manually in a real browser; the protocol
> maths and view geometry are covered by unit tests.

## Running it

```sh
npm install
npm run dev     # http://localhost:5173
```

`cyberspace-core` is a `file:` dependency pointing at `../cyberspace-cli-js`.
Clone both repos as siblings, and build the core once:

```sh
cd ../cyberspace-cli-js && npm install && npm run build
```

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | move the cursor one step in a screen direction |
| `Space` | commit the cursor's hop and compute its proof |
| `X` | cancel an in-flight proof, or recall the cursor |
| `Shift` + `W` `A` `S` `D` | rotate the view 90 degrees |
| `Tab` | return to the previous view |
| `Esc` | reset to top-down |
| `Q` / `E` | scale the step up / down, logarithmically |
| `R` / `F` | cursor along the axis into / out of the screen |
| `C` | canonical view ("facing the black sun") |
| `P` | toggle dataspace and ideaspace |

Movement is expressed in screen directions and resolved to world axes through
the current view, so `W` is always "away from you" in any of the 24 reachable
axis-aligned orientations.

**Movement is two-phase.** WASD noodles a free cursor; nothing is computed
until `Space` commits the hop. While the cursor is away from the avatar the
proof panel live-previews what committing would cost (the estimate is
closed-form, so it never blocks), the dashed tether shows the hop being lined
up, and both turn red when the hop is beyond the compute ceiling. Position
only advances when a committed proof completes, so the movement chain shown in
the HUD is contiguous by construction.

**You spawn at your pubkey.** The first visit generates a keypair and keeps it
in localStorage, and per spec section 8.3 the spawn coordinate IS the pubkey:
the 256-bit key decodes directly to x / y / z / plane.

**The chain is real.** Spawning signs a `kind:3333` spawn event, and every
committed hop or sidestep is signed into its own event the moment the proof
lands, naming the spawn as `genesis` and the previous event as `previous`
(spec section 8). The next proof's temporal work is bound to that event's id,
exactly as a verifier recomputes it. The chain persists as those events, so a
reload reads position, plane and history back out of them.

**The spawn marker.** v1's spawn model (`public/spawn.glb`: three hexagonal
rings, a hollow cube, six radiating bars) stands at the pubkey coordinate,
sized in cells like the avatar so it marks the spawn cell at any scale.

**Derezz.** The last panel in the HUD abandons the chain: a new spawn event is
signed (and published, when Live), which per spec section 3.2 retires every
action before it, and the avatar is back at its pubkey with nothing behind it.
It arms a warning first, in v1's words, because it cannot be undone.

**Local / Live.** The switch under RECALL and COMMIT decides whether events
leave the device. Live (the default) publishes each one to
`wss://cyberspace.nostr1.com` as it is signed, in chain order, and the proof
chain panel shows how many the relay has acknowledged. Local keeps them here;
switching to Live later publishes the whole backlog, oldest first, so every
prefix the relay holds is itself a valid chain.

## What you are looking at

**Cell fill is terrain K.** `K` in `[0, 16]` is the terrain-derived temporal
height for a destination, setting the non-cacheable temporal work every hop into
that cell costs. It is `Binomial(16, 0.5)`, so it clusters around 8; the palette
is tuned to spread the common 5..11 band rather than the unused extremes.

**Line brightness is LCA height.** For each gridline the app computes the real
`findLcaHeight` of crossing it at the current scale, and lights it in proportion
to how far above the cheapest possible crossing that is. Stepping `7 -> 8` costs
height 4 while `8 -> 9` costs height 1, for the same single gibson. That
asymmetry is the whole point, and it is drawn.

**Scale changes what a boundary means.** `Q` and `E` move the step size by
powers of two. At `2^0` you see individual gibsons; at `2^30` each cell is a
sector. Terrain correlates at cell sizes `2^3` to `2^11`, so the field looks
smooth when you zoom below that band and uncorrelated above it.

## Handedness, and why it matters

**Cyberspace is a left-handed coordinate system.** Section 9.4 defines it as
ECEF with two axes swapped (`X_cs = X_ecef`, `Y_cs = Z_ecef`, `Z_cs = Y_ecef`),
and swapping two axes of a right-handed frame inverts handedness. That is why
section 11.1's convention (`+X` screen-right, `+Y` up, `+Z` forward *into* the
screen) cannot be reproduced in three.js, which is right-handed, by camera
placement alone.

Section 11.4 requires resolving this with a render-space transform rather than
by mirroring or re-labelling axes. This app does it in exactly one place:
`flipHandedness` in `lib/space.ts`, applied at the boundary where `viewAxes`
converts camera directions back into cyberspace axis names. Everything upstream
is render space; everything downstream is cyberspace.

Getting this wrong does not produce a visibly broken picture. It produces a
mirrored one, which looks perfectly fine on its own and silently disagrees with
every other viewer about which way is left. It is asserted directly in the test
suite across all 24 reachable views.

Two consequences worth knowing:

- The canonical view comes out as the *identity* quaternion, i.e. three.js's
  default camera. That it lands exactly there is a good sign the transform sits
  in the right place.
- The top-down map view puts `+Z` (forward, the black sun direction) up the
  screen, which is the conventional map orientation. Before the handedness fix
  it pointed down.

## Architecture

```
src/
  lib/space.ts        coordinate <-> render-space maths, view orientation
  lib/palette.ts      the two visual encodings (terrain fill, boundary lines)
  lib/events.ts       kind:3333 builders, parser, chain reassembly (spec 8, 10)
  lib/relay.ts        the one relay, publish / query / subscribe
  lib/publisher.ts    drains unpublished events in chain order while Live
  lib/workers.ts      worker singletons
  store/              zustand store: position, scale, view, proof telemetry
  workers/            proof and terrain sampling, off the main thread
  scene/              R3F: camera rig, terrain field, lattice, avatar, cursor
  hud/                overlay panels
```

Two rules hold the design together:

**No absolute coordinate is ever converted to a float.** Positions are bigint
throughout and are rendered as integer *offsets* from the avatar's aligned cell,
so precision is exact at any depth into the axis. `subCellFraction` uses
fixed-point bigint division for the same reason: past `2^53` a float ratio
collapses to zero.

**Compute never blocks the frame.** A hop is `O(2^h)` Cantor pairings, so at
higher scales a single keypress is real work. Proofs and terrain sampling both
run in workers, and the proof worker streams progress so the HUD shows genuine
elapsed cost rather than a spinner.

When a hop's LCA height exceeds the Cantor compute ceiling, Space commits a
**Merkle sidestep** instead (spec section 6): a Merkle hash tree over the same
LCA subtree, which has no storage wall and costs purely time (2^(h+1) SHA-256
evaluations per crossing axis). A sidestep lands exactly 1 gibson past the
blocking boundary, not at the cursor: crossing the mountain drops you at the
pass, and the rest of the journey is the next commit. The tether shows this as
two legs: purple to the landing, then amber (or red, if another wall stands)
for the remainder. The proof panel previews the hash count and a rough
wall-clock estimate before you pay; X cancels mid-hash.

## Relationship to v1

This branch starts from zero. ONOSENDAI v1 lives on `master` and targets
Cyberspace v1, whose movement model (proof-of-work drift and velocity over
`DecimalVector3`) is precisely what v2 replaced. The two share constants but not
semantics, so v1 code is cherry-picked deliberately rather than carried over.

## Tests

```sh
npm test        # view geometry and coordinate maths
```

The protocol maths itself is tested in `cyberspace-cli-js` against golden
vectors shared with the Python implementation.
