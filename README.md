# ONOSENDAI V2

A spatial explorer for the [Cyberspace Protocol v2](https://github.com/arkin0x/cyberspace).

Move through the 85-bit axis space one step at a time and watch what each step
actually costs. The protocol's central and least intuitive property is that
movement cost is set by *which power-of-two boundary you cross*, not by how far
you travel. This makes that visible: bright gridlines are expensive crossings,
and the terrain underneath shows where the temporal work is concentrated.

> Status: MVP. The rendering has not yet been verified in a browser by an
> automated test; the protocol maths and view geometry are covered by unit tests.

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
| `W` `A` `S` `D` | move one step in a screen direction |
| `Shift` + `W` `A` `S` `D` | rotate the view 90 degrees |
| `Tab` | return to the previous view |
| `Space` | reset to top-down |
| `Q` / `E` | scale the step down / up, logarithmically |
| `R` / `F` | move along the axis into / out of the screen |
| `P` | toggle dataspace and ideaspace |

Movement is expressed in screen directions and resolved to world axes through
the current view, so `W` is always "away from you" in any of the 24 reachable
axis-aligned orientations.

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

## Architecture

```
src/
  lib/space.ts        coordinate <-> render-space maths, view orientation
  lib/palette.ts      the two visual encodings (terrain fill, boundary lines)
  lib/workers.ts      worker singletons
  store/              zustand store: position, scale, view, proof telemetry
  workers/            proof and terrain sampling, off the main thread
  scene/              R3F: camera rig, terrain field, boundary grid, avatar
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

When a hop's LCA height exceeds the Cantor compute ceiling the HUD reports
`SIDESTEP REQUIRED` rather than failing. That is not an error state: it is the
protocol saying this boundary should be crossed with a Merkle sidestep instead.
Sidesteps are not implemented in this MVP.

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
