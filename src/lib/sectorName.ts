/**
 * sectorName.ts — a memorable handle for a sector, derived from its index.
 *
 * A sector is 2^30 gibsons per axis and there are 2^55 of them per axis, so
 * 2^165 in total. No short name can be unique across that, and chasing
 * uniqueness is the wrong instinct anyway: what a place name has to do is be
 * stable, distinctive, and different from its NEIGHBOURS. Two sectors 10^30
 * apart sharing a name costs nothing, because nobody will ever stand in both.
 *
 * v1 got that backwards and it is worth recording why, because the failure is
 * subtle. It indexed three 20-word lists by `x % 20`, `y % 20`, `z % 20` and
 * printed the last four decimal digits of each coordinate beside them. Two
 * separate defects:
 *
 * 1. **The words carried no information.** 20 divides 10000, so `x % 20` is a
 *    function of `x % 10000`, which is exactly what the printed code already
 *    showed. The name space was 10^12, not 8000 x 10^12: the adjective was a
 *    decoration on a number that had already said everything.
 * 2. **Modular indexing has no diffusion**, so the name was PERIODIC in the
 *    coordinate. The word triple repeated every 20 sectors along an axis, which
 *    at 12.5cm per sector is every 2.5 metres. Not billions of distant sectors
 *    sharing a name: your immediate neighbours sharing one.
 *
 * Hashing fixes both. Adjacent sectors land on unrelated names, and collisions
 * stop being periodic and spread uniformly across the whole space, where the
 * birthday bound governs them rather than a 20-sector cycle. That means the
 * lexicon can stay small enough to be hand-curated for flavour, which is the
 * only thing it should be sized for.
 */

import type { SectorId } from 'cyberspace-core'

const MASK64 = (1n << 64n) - 1n

/**
 * MurmurHash3's 64-bit finalizer. Chosen for avalanche, not for security:
 * nothing here is adversarial, the only requirement is that flipping the lowest
 * bit of a coordinate changes roughly half the output bits, which is precisely
 * the property v1's modulo lacked.
 */
function mix64(v: bigint): bigint {
  let h = v & MASK64
  h ^= h >> 33n
  h = (h * 0xff51afd7ed558ccdn) & MASK64
  h ^= h >> 33n
  h = (h * 0xc4ceb9fe1a85ec53n) & MASK64
  h ^= h >> 33n
  return h
}

/**
 * Fold one coordinate in, 64 bits at a time.
 *
 * A sector index is below 2^55 at the default sector size, so the loop runs
 * once and the masking never discards anything. It loops anyway because the
 * sector size is a parameter in the protocol, and a narrower sector would push
 * the index past 64 bits and silently truncate. The do/while is deliberate: an
 * index of zero still has to be mixed.
 */
function fold(seed: bigint, v: bigint): bigint {
  let h = seed
  let x = v
  do {
    h = mix64(h ^ (x & MASK64))
    x >>= 64n
  } while (x > 0n)
  return h
}

/** Golden ratio in 64 bits, the conventional arbitrary seed. */
const SEED = 0x9e3779b97f4a7c15n

function hashSector(sid: SectorId): bigint {
  return fold(fold(fold(SEED, sid.sx), sid.sy), sid.sz)
}

/**
 * The lexicon.
 *
 * Sized for flavour, not for uniqueness, per the note at the top. Cyberpunk in
 * the Gibson register rather than the chrome-and-lasers one: industrial decay,
 * salt and weather, navigation instruments, and the vocabulary of places people
 * actually live in. The grammar is adjective / noun / designation because that
 * is what makes a triple read as a PLACE rather than as three words, which is
 * the one thing v1 got right and is worth keeping.
 */
const ADJECTIVES = [
  'Chrome', 'Neon', 'Static', 'Obsidian', 'Halcyon', 'Ferric', 'Cobalt', 'Vagrant',
  'Derelict', 'Gilded', 'Hollow', 'Sable', 'Vitreous', 'Cinder', 'Argent', 'Lucid',
  'Fractal', 'Umbral', 'Tantalum', 'Saline', 'Voltaic', 'Cryptic', 'Onyx', 'Pallid',
  'Rusted', 'Wintered', 'Glassine', 'Errant', 'Latent', 'Nocturne', 'Feral', 'Verdigris',
  'Anodized', 'Brackish', 'Silent', 'Vestal', 'Scarred', 'Opaline', 'Wired', 'Drifting',
  'Blackened', 'Iridine', 'Sunless', 'Molten', 'Numb', 'Godless', 'Hushed', 'Kinetic',
  'Ashen', 'Bleached', 'Riven', 'Tidal', 'Severed', 'Phantom', 'Wandering', 'Ivory',
  'Corroded', 'Weightless', 'Fathomless', 'Wracked', 'Muted', 'Splintered', 'Ozone', 'Bitter',
  'Vanishing', 'Sodium', 'Threadbare', 'Restless', 'Copper', 'Unlit', 'Salted', 'Frayed',
  'Slate', 'Aching', 'Buried', 'Bled', 'Tarnished', 'Hallowed', 'Barbed', 'Glacial',
  'Spent', 'Woven', 'Sunken', 'Wrought', 'Fallow', 'Dusted', 'Stark', 'Sightless',
  'Leaden', 'Tungsten', 'Bismuth', 'Halide', 'Xenon', 'Krypton', 'Radon', 'Caesium',
  'Wolfram', 'Indium', 'Thallium', 'Osmium', 'Iridic', 'Platinal', 'Mercuric', 'Zincate',
  'Lambent', 'Penumbral', 'Crepuscular', 'Vespertine', 'Auroral', 'Boreal', 'Austral', 'Equinoctial',
  'Sepulchral', 'Chthonic', 'Liminal', 'Interstitial', 'Vestigial', 'Residual', 'Terminal', 'Cardinal',
  'Wayward', 'Untethered', 'Unmoored', 'Adrift', 'Becalmed', 'Marooned', 'Stranded', 'Forsaken',
]

const NOUNS = [
  'Sprawl', 'Arcade', 'Conduit', 'Spire', 'Terminus', 'Bazaar', 'Foundry', 'Reliquary',
  'Causeway', 'Anchorage', 'Precinct', 'Quarter', 'Vault', 'Lattice', 'Junction', 'Wharf',
  'Substation', 'Interchange', 'Mezzanine', 'Undercroft', 'Escarpment', 'Concourse', 'Depot', 'Silo',
  'Refinery', 'Stack', 'Verge', 'Threshold', 'Gantry', 'Aqueduct', 'Bulwark', 'Rampart',
  'Catacomb', 'Cistern', 'Reservoir', 'Basin', 'Delta', 'Shallows', 'Narrows', 'Reach',
  'Crossing', 'Landing', 'Approach', 'Divide', 'Warren', 'Rookery', 'Enclave', 'Commons',
  'Exchange', 'Bourse', 'Registry', 'Archive', 'Cache', 'Node', 'Relay', 'Uplink',
  'Array', 'Grid', 'Mesh', 'Circuit', 'Trunk', 'Spur', 'Siding', 'Platform',
  'Berth', 'Dock', 'Quay', 'Pier', 'Lock', 'Weir', 'Sluice', 'Channel',
  'Strait', 'Sound', 'Fjord', 'Inlet', 'Cove', 'Shoal', 'Marsh', 'Moor',
  'Steppe', 'Barrens', 'Expanse', 'Span', 'Arch', 'Buttress', 'Colonnade', 'Peristyle',
  'Atrium', 'Rotunda', 'Cloister', 'Chancel', 'Transept', 'Nave', 'Apse', 'Crypt',
  'Bastion', 'Redoubt', 'Citadel', 'Keep', 'Barbican', 'Curtain', 'Palisade', 'Stockade',
  'Sanatorium', 'Observatory', 'Planetarium', 'Orrery', 'Armillary', 'Astrolabe', 'Sundial', 'Gnomon',
  'Cinderyard', 'Slagheap', 'Tailings', 'Drossworks', 'Smeltery', 'Kiln', 'Forgeworks', 'Boneyard',
  'Aerie', 'Roost', 'Eyrie', 'Perch', 'Overlook', 'Belvedere', 'Prospect', 'Vantage',
]

const DESIGNATIONS = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
  'Prime', 'Null', 'Zero', 'Nadir', 'Zenith', 'Apex', 'Origin', 'Vertex',
  'Locus', 'Datum', 'Azimuth', 'Bearing', 'Ward', 'Line', 'Rise', 'Fall',
  'Gate', 'Watch', 'Bell', 'Hour', 'Ash', 'Rain', 'Frost', 'Dusk',
  'Dawn', 'Noon', 'Wake', 'Rest', 'Drift', 'Turn', 'Bend', 'Fork',
  'Crest', 'Hook', 'Point', 'Head', 'Crown', 'Root', 'Vein', 'Nerve',
  'Pulse', 'Beat', 'Shift', 'Gap', 'Seam', 'Fold', 'Edge', 'Rim',
  'Brink', 'Ledge', 'Shelf', 'Step', 'Tier', 'Deck', 'Level', 'Strata',
  'Band', 'Belt', 'Ring', 'Loop', 'Coil', 'Knot', 'Braid', 'Chain',
  'Link', 'Halt', 'Signal', 'Marker', 'Beacon', 'Cairn', 'Waypoint', 'Compass',
  'Sextant', 'Chart', 'Log', 'Lantern', 'Ember', 'Tally', 'Cipher', 'Sigil',
  'Verse', 'Refrain', 'Echo', 'Answer', 'Question', 'Silence', 'Vigil', 'Requiem',
  'Remnant', 'Relic', 'Token', 'Charm', 'Sentinel', 'Aegis', 'Rampart', 'Anchor',
  'Ninth', 'Tenth', 'Last', 'First', 'Lesser', 'Greater', 'Outer', 'Inner',
]

/**
 * Name for a sector, derived only from its index.
 *
 * Read as a mixed-radix number off one 64-bit hash rather than by slicing bit
 * fields, so the three lists can be any length without the extraction changing.
 * The hash has 2^64 values against a product of about 2^21, so the modulo bias
 * is around 2^-43 and not worth correcting.
 */
export function sectorName(sid: SectorId): string {
  let h = hashSector(sid)
  const pick = (list: string[]): string => {
    const n = BigInt(list.length)
    const word = list[Number(h % n)]
    h /= n
    return word
  }
  const adjective = pick(ADJECTIVES)
  const noun = pick(NOUNS)
  const designation = pick(DESIGNATIONS)
  return `${adjective} ${noun} ${designation}`
}

/** Distinct names this lexicon can produce. Exported so a test can assert it. */
export const NAME_SPACE = ADJECTIVES.length * NOUNS.length * DESIGNATIONS.length

export const LEXICON = { ADJECTIVES, NOUNS, DESIGNATIONS }
