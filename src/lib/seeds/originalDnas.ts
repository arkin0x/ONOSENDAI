/**
 * originalDnas.ts - the original DNAs (the glossary's name for them): the six
 * DNAs of the Seed Garden prototype (DECK-0008 §11), exactly as the spec's
 * vectors carry them (decks/seeds-vectors.json `growth.dnas`, as sno-core
 * v0.1.27 vendors it).
 *
 * The owner will publish them under their own npub (ruling of 2026-11-10), and
 * every new seed of one then names that event: one DNA id, one author credited
 * wherever its seeds grow. ORIGINAL_DNA_IDS holds those ids; until one is set,
 * SEED signs a DNA of its own for the planter, as it always has.
 * Each is planted at the prototype's caps, 8,000 vertices, 6,000 symbols and
 * 40 generations: a price of 21 bits a seed (§7), seconds of mining on a phone.
 * A test holds every text equal to the vectors' and valid SEEDO.
 */

import type { Caps } from 'sno-core/seeds'

export interface OriginalDna {
  /** Its `dna` line. */
  name: string
  text: string
  caps: Caps
}

/** The prototype's caps (§14): 21 bits a seed. */
export const ORIGINAL_CAPS: Caps = { vertices: 8000, symbols: 6000, generations: 40 }

export const ORIGINAL_DNAS: readonly OriginalDna[] = [
  {
    name: "fiddlehead",
    text: "dna     fiddlehead\nspecies fern\nmutate  4\n\n# genome: two alleles each, ! marks dominant\n# standard genes (every DNA has them; the turtle applies them)\ngene size    180  170  in 50..200  # giant, recessive\ngene hue     0!   0!   in 0..23    # keeps the green\n# species genes\ngene curl    22   20   in 2..30    # how tightly a new node coils (recessive)\ngene span    7!   5    in 3..12    # how long a pinna gets\ngene leaf    3    3    in 1..6     # leaflet size\ngene gap     4    3!   in 2..7     # space between nodes\n\n# growth rules\nangle 8\n# terroir: K is the terrain (0..16), n0..n3 its nibbles, finest to coarsest\nlet lean  = curl + n0 % 7          # fine texture adds a little coil\nlet reach = span + K / 4 - 2       # richer terrain, longer pinnae\nlet fan   = 55 + n1 * 2            # pinna angle\naxiom '(203) O(2) !(2) A(0)\n\n# the tip adds one node a day, with a pair of pinnae\nA(k) if k < 27 -> '(171) F(gap) [ +(fan) P(reach - k/3) ] [ -(fan) P(reach - k/3) ] ^(lean) A(k+1)\n# every coil relaxes a little each day, so the frond unfurls behind its tip\n^(a) if a > 0 -> ^(a - 2)\n# each pinna adds a leaflet pair a day; weather sometimes stops it early\nP(n) if n > 0 chance 92 -> '(173) F(2) [ +(55) '(174) L(leaf) ] [ -(55) '(174) L(leaf) ] &(3) P(n-1)\nP(n) -> '(175) L(leaf+1)",
    caps: ORIGINAL_CAPS,
  },
  {
    name: "sword fern",
    text: "dna     sword fern\nspecies fern\nmutate  4\n\n# genome: two alleles each, ! marks dominant\n# standard genes (every DNA has them; the turtle applies them)\ngene size    70!  75!  in 50..200  # small, dominant\ngene hue     6    6    in 0..23    # green turned blue, recessive\n# species genes\ngene curl    6!   5!   in 2..30    # how tightly a new node coils (loose is dominant)\ngene span    10   9!   in 3..12    # how long a pinna gets\ngene leaf    2!   4    in 1..6     # leaflet size\ngene gap     5!   5    in 2..7     # space between nodes\n\n# growth rules\nangle 8\n# terroir: K is the terrain (0..16), n0..n3 its nibbles, finest to coarsest\nlet lean  = curl + n0 % 7          # fine texture adds a little coil\nlet reach = span + K / 4 - 2       # richer terrain, longer pinnae\nlet fan   = 55 + n1 * 2            # pinna angle\naxiom '(203) O(2) !(2) A(0)\n\n# the tip adds one node a day, with a pair of pinnae\nA(k) if k < 27 -> '(171) F(gap) [ +(fan) P(reach - k/3) ] [ -(fan) P(reach - k/3) ] ^(lean) A(k+1)\n# every coil relaxes a little each day, so the frond unfurls behind its tip\n^(a) if a > 0 -> ^(a - 2)\n# each pinna adds a leaflet pair a day; weather sometimes stops it early\nP(n) if n > 0 chance 92 -> '(173) F(2) [ +(55) '(174) L(leaf) ] [ -(55) '(174) L(leaf) ] &(3) P(n-1)\nP(n) -> '(175) L(leaf+1)",
    caps: ORIGINAL_CAPS,
  },
  {
    name: "oak",
    text: "dna     oak\nspecies tree\nmutate  3\n\n# genome: two alleles each, ! marks dominant\n# standard genes (every DNA has them; the turtle applies them)\ngene tone    1!   1    in -4..4    # a shade lighter\ngene hue     0!   0!   in 0..23    # leaves stay green\n# species genes\ngene spread  38!  30   in 10..60   # branch angle\ngene droop   -4!  -4!  in -8..8    # bend down (+) or reach up (-)\ngene fork    22   30!  in 5..50    # chance a tip forks today\ngene leaf    5!   3    in 2..8     # leaf size\ngene trunk   4!   3    in 1..9     # days of bare trunk before the crown\n\n# growth rules\nangle 25\n# terroir: K is the terrain (0..16), n0..n3 its nibbles, finest to coarsest\nlet forks = fork + K - 8           # richer terrain, more forks\nlet open  = spread + n2 - 7        # middle-scale soil opens or closes the crown\naxiom '(203) O(3) !(2, 10) S(trunk)\n\n# the trunk rises first, then becomes a crown\nS(n) if n > 0 -> '(122) F(6) /(137) S(n-1)\nS(n) -> A(4)\n# a tip grows one internode a day; some days it forks in two\nA(v) if v > 0 chance forks -> '(122) F(4) [ &(open) !(1, v*2) A(v-1) ] /(137) [ &(open) !(1, v*2) A(v-1) ]\nA(v) -> '(122) F(3) T(droop) [ ^(40) '(173) L(leaf) ] /(137) A(v)\n# wood thickens a little each day, up to its limit\n!(t, m) if t < m -> !(t+1, m)",
    caps: ORIGINAL_CAPS,
  },
  {
    name: "willow",
    text: "dna     willow\nspecies tree\nmutate  3\n\n# genome: two alleles each, ! marks dominant\n# standard genes (every DNA has them; the turtle applies them)\ngene tone    -2   -3   in -4..4    # darker\ngene hue     23   23   in 0..23    # one family toward yellow, recessive\n# species genes\ngene spread  32   28   in 10..60   # branch angle\ngene droop   8    7    in -8..8    # bend down (+) or reach up (-)\ngene fork    26   24   in 5..50    # chance a tip forks today\ngene leaf    4    4    in 2..8     # leaf size\ngene trunk   7    6    in 1..9     # days of bare trunk before the crown\n\n# growth rules\nangle 25\n# terroir: K is the terrain (0..16), n0..n3 its nibbles, finest to coarsest\nlet forks = fork + K - 8           # richer terrain, more forks\nlet open  = spread + n2 - 7        # middle-scale soil opens or closes the crown\naxiom '(203) O(3) !(2, 10) S(trunk)\n\n# the trunk rises first, then becomes a crown\nS(n) if n > 0 -> '(122) F(6) /(137) S(n-1)\nS(n) -> A(4)\n# a tip grows one internode a day; some days it forks in two\nA(v) if v > 0 chance forks -> '(122) F(4) [ &(open) !(1, v*2) A(v-1) ] /(137) [ &(open) !(1, v*2) A(v-1) ]\nA(v) -> '(122) F(3) T(droop) [ ^(40) '(173) L(leaf) ] /(137) A(v)\n# wood thickens a little each day, up to its limit\n!(t, m) if t < m -> !(t+1, m)",
    caps: ORIGINAL_CAPS,
  },
  {
    name: "coral",
    text: "dna     coral\nspecies coral\nmutate  5\n\n# standard genes (every DNA has them; the turtle applies them)\ngene hue     0!   12   in 0..23    # magenta, hiding a green; mix coral with coral to find it\n# species genes\ngene split   22!  15   in 5..50    # chance a tip splits today\ngene twist   40   70!  in 0..120   # roll between segments\ngene life    18!  14   in 8..26    # growing days before a tip closes\n\nangle 30\nlet lean = n1 * 3                  # terroir: the current leans with the soil\nlet rest = 20 + K + n0             # poor terrain, more resting days\naxiom '(250) O(4) !(3) C(0)\n\n# a polyp tip grows on most days, sometimes splits, sometimes rests; old tips close with a bead\nC(k) if k < life chance split -> '(75+k/5) F(2) [ +(20+w/3) &(lean/3) C(k+1) ] /(twist) [ -(20+w/4) C(k+1) ]\nC(k) if k < life chance 100 - rest -> '(75+k/5) F(2) /(twist) ^(w/8) C(k+1)\nC(k) if k >= life -> '(79) O(2)",
    caps: ORIGINAL_CAPS,
  },
  {
    name: "crystal",
    text: "dna     crystal\nspecies crystal\nmutate  2\n\n# standard genes (every DNA has them; the turtle applies them)\ngene hue     0!   5    in 0..23    # cyan, hiding a violet\n# species genes\ngene arm     5!   4    in 3..8     # cell size\ngene bud     35   50!  in 0..90    # chance, per day, that every arm buds\n\nangle 90\nlet step  = arm + n0 % 3           # terroir: fine texture sets the cell size\nlet calm  = 45 + K * 2 + n3        # days are calm enough to grow when W < calm\nlet reach = 2 + n2 % 3             # side arm length\naxiom '(15) O(3) !(4) X\n\n# six arms on a cubic lattice. W is one roll per day for the whole crystal, so it stays symmetric\nX -> [ Y(0) ] [ +(90) Y(0) ] [ -(90) Y(0) ] [ ^(90) Y(0) ] [ &(90) Y(0) ] [ |(0) Y(0) ]\nY(k) if k < 16 and W < bud * calm / 100 -> '(12) F(step) O(1) [ +(90) Z(reach) ] [ -(90) Z(reach) ] [ ^(90) Z(reach-1) ] Y(k+1)\nY(k) if k < 16 and W < calm -> '(12) F(step) O(1) Y(k+1)\nZ(n) if n > 0 and W < calm -> '(14) F(step/2) O(1) Z(n-1)",
    caps: ORIGINAL_CAPS,
  },
]

/**
 * The owner's published event for each original DNA, by name, or empty while
 * it is unpublished (owner ruling 2026-11-10). A set id is what every new seed
 * of that DNA names; its own `caps` tag is the size limit it is planted at.
 */
export const ORIGINAL_DNA_IDS: Readonly<Record<string, string>> = {
  'fiddlehead': '',
  'sword fern': '',
  'oak': '',
  'willow': '',
  'coral': '',
  'crystal': '',
}

/** The owner's event id for an original DNA, or null while none is set. */
export function originalDnaId(name: string, ids: Readonly<Record<string, string>> = ORIGINAL_DNA_IDS): string | null {
  const id = ids[name]
  return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null
}
