/**
 * colourTable.ts: the Colour Table, our own table from a block in someone's
 * file to one of our 256 colours (cyberspace-neon-256, DECK-0003 Appendix C),
 * and to one of a few shapes.
 *
 * Every colour here was chosen by us, by eye, against our own palette, to
 * make builds look like they belong in cyberspace: stone in our steels, wood
 * in our ambers, the sixteen dyes on our neon ramps. None is sampled from a
 * game's textures or copied from another tool's table, and nothing here
 * ships a game's art (design 4.3 and 4.8). Block names are matched as plain
 * words in the person's own file; the importer shows them only as "from your
 * file", beside our swatch.
 *
 * Each block belongs to a family (a stone, a wood, a dye). Builders mix
 * three or four similar blocks for texture, and texture is what defeats
 * merging faces into rectangles; MERGE SIMILAR gives a whole family its one
 * colour. The person can change any block's colour on top of this.
 *
 * Shapes (design 4.6): cubes, and approximations of slabs, stairs, fences,
 * walls, panes, doors, trapdoors, beds, carpets and snow layers. Glass, ice
 * and water are their own layers, drawn as separate pieces with opacity.
 * Plants, torches and other small things are decorations, skipped unless the
 * person turns them on. A few blocks are never drawn at all (barrier blocks,
 * light blocks).
 *
 * Pure.
 */

import { blockName, shortName, stateProps } from './blockGrid'

/** Which piece a block's faces go into: solid, or one of the see-through families, each its own object (SNO opacity is per object, DECK-0003 §1.11). */
export type Layer = 'solid' | 'glass' | 'ice' | 'water'
export const LAYERS: readonly Layer[] = ['solid', 'glass', 'ice', 'water']

/** How opaque each layer's pieces are drawn, a whole percent. */
export const LAYER_OPACITY: Readonly<Record<Layer, number | undefined>> = { solid: undefined, glass: 40, ice: 70, water: 60 }
/** What WALK does at each layer's faces (lib/walkConstrain.ts): walls hold, water lets you through. */
export const LAYER_CONSTRAIN: Readonly<Record<Layer, 'all' | 'off'>> = { solid: 'all', glass: 'all', ice: 'all', water: 'off' }

export type Shape =
  | 'cube' | 'slab-bottom' | 'slab-top' | 'stairs' | 'fence' | 'gate' | 'wall' | 'pane'
  | 'door' | 'trapdoor' | 'carpet' | 'layer' | 'bed' | 'decor'

export interface BlockLook {
  /** The family MERGE SIMILAR gives one colour. */
  family: string
  /** Our colour for this block: an index of cyberspace-neon-256. */
  colour: number
  /** The family's one colour under MERGE SIMILAR. */
  familyColour: number
  layer: Layer
  shape: Shape
  /** A plant, torch or other small thing: skipped unless decorations are on. */
  decor: boolean
  /** Never drawn: barrier blocks, light blocks, and anything that has no look of its own. */
  hidden: boolean
}

// ---------------------------------------------------------------- materials

interface Material { family: string; colour: number; base: number; layer?: Layer }

const mat = (family: string, colour: number, base = colour, layer?: Layer): Material => ({ family, colour, base, ...(layer ? { layer } : {}) })

/** The sixteen dyes: [wool and concrete, terracotta, our family colour]. */
const DYES: Record<string, [number, number]> = {
  white: [225, 219], light_gray: [215, 210], gray: [205, 202], black: [196, 194],
  brown: [122, 121], red: [107, 106], orange: [117, 115], yellow: [143, 141],
  lime: [159, 157], green: [163, 162], cyan: [4, 3], light_blue: [30, 28],
  blue: [42, 41], purple: [59, 58], magenta: [76, 75], pink: [86, 84],
}
const DYE_NAMES = Object.keys(DYES).sort((a, b) => b.length - a.length)

/** Wood species: [planks, log or stem, leaves]. */
const WOODS: Record<string, [number, number, number]> = {
  oak: [124, 121, 170], spruce: [121, 120, 169], birch: [127, 218, 164], jungle: [123, 122, 172],
  acacia: [116, 205, 163], dark_oak: [120, 112, 169], mangrove: [105, 104, 171], cherry: [94, 88, 86],
  pale_oak: [219, 207, 213], bamboo: [141, 156, 165], crimson: [81, 89, 105], warped: [187, 185, 186],
}
const WOOD_NAMES = Object.keys(WOODS).sort((a, b) => b.length - a.length)

/**
 * Materials by name, first match wins: [pattern, family, colour, family colour, layer].
 * Matched against the block's name with its shape's ending taken off
 * ("stone_brick_stairs" is matched as "stone_brick").
 */
const RULES: Array<[RegExp, Material]> = [
  // See-through.
  [/^tinted_glass$/, mat('glass', 251, 251, 'glass')],
  [/(^|_)glass$/, mat('glass', 242, 242, 'glass')],
  [/^(ice|frosted_ice)$/, mat('ice', 31, 31, 'ice')],
  [/^packed_ice$/, mat('ice', 30, 31)],
  [/^blue_ice$/, mat('ice', 29, 31)],
  [/^(water|bubble_column)$/, mat('water', 28, 28, 'water')],
  [/^lava$/, mat('lava', 108)],
  // Dark stone.
  [/^(cobbled_)?deepslate(_.*)?$|^polished_deepslate|^chiseled_deepslate|^cracked_deepslate|^reinforced_deepslate/, mat('dark-stone', 202, 202)],
  [/blackstone/, mat('dark-stone', 199, 202)],
  [/basalt/, mat('dark-stone', 203, 202)],
  [/^bedrock$/, mat('dark-stone', 197, 202)],
  [/^crying_obsidian$/, mat('obsidian', 57, 252)],
  [/^obsidian$/, mat('obsidian', 252, 252)],
  [/^coal_block$/, mat('dark-stone', 195, 202)],
  [/^netherite_block$|^ancient_debris$/, mat('dark-stone', 198, 202)],
  [/sculk/, mat('sculk', 24, 24)],
  // Pale stone.
  [/diorite/, mat('pale-stone', 218, 219)],
  [/calcite/, mat('pale-stone', 221, 219)],
  [/quartz/, mat('pale-stone', 222, 219)],
  [/^bone_block$/, mat('pale-stone', 220, 219)],
  [/^(iron_block|heavy_weighted|iron)$/, mat('metal', 219, 219)],
  [/^raw_iron_block$/, mat('metal', 216, 219)],
  // Warm stone.
  [/granite/, mat('granite', 113, 113)],
  [/dripstone/, mat('granite', 114, 113)],
  // Bricks.
  [/^red_nether_brick/, mat('nether-brick', 98, 96)],
  [/nether_brick/, mat('nether-brick', 96, 96)],
  [/^mud_brick|^packed_mud$/, mat('brick', 122, 106)],
  [/^brick(s)?$/, mat('brick', 106, 106)],
  // Sand.
  [/^red_sand$|red_sandstone/, mat('red-sand', 116, 116)],
  [/^sand$|sandstone|^suspicious_sand$/, mat('sand', 134, 134)],
  [/end_stone/, mat('end-stone', 150, 150)],
  [/purpur/, mat('purpur', 61, 61)],
  [/dark_prismarine/, mat('prismarine', 185, 188)],
  [/prismarine/, mat('prismarine', 188, 188)],
  // Nether.
  [/^netherrack$|^crimson_nylium$/, mat('netherrack', 98, 98)],
  [/^warped_nylium$/, mat('warped', 187, 187)],
  [/^soul_(sand|soil)$/, mat('soul', 129, 129)],
  [/^nether_wart_block$/, mat('netherrack', 105, 98)],
  [/^warped_wart_block$/, mat('warped', 186, 187)],
  [/^magma_block$/, mat('lava', 108, 108)],
  [/^shroomlight$/, mat('light', 118, 135)],
  // Lights.
  [/^glowstone$/, mat('light', 135, 135)],
  [/^sea_lantern$/, mat('light', 230, 135)],
  [/^(jack_o_lantern|lit_pumpkin)$/, mat('light', 126, 135)],
  [/^redstone_lamp$/, mat('light', 133, 135)],
  [/froglight$/, mat('light', 241, 135)],
  [/^beacon$/, mat('light', 242, 135)],
  // Metals and gems.
  [/^gold_block$|^raw_gold_block$/, mat('gold', 135, 135)],
  [/^diamond_block$/, mat('gem', 7, 7)],
  [/^emerald_block$/, mat('gem', 174, 7)],
  [/^lapis_block$/, mat('gem', 41, 7)],
  [/^redstone_block$/, mat('gem', 107, 7)],
  [/^amethyst_block$|^budding_amethyst$/, mat('gem', 61, 7)],
  [/oxidized_.*copper|oxidized_cut_copper|^oxidized_copper/, mat('copper', 189, 116)],
  [/weathered_.*copper|^weathered_copper/, mat('copper', 181, 116)],
  [/exposed_.*copper|^exposed_copper/, mat('copper', 125, 116)],
  [/copper/, mat('copper', 116, 116)],
  // Ground.
  [/^grass_block$|^moss_block$/, mat('grass', 164, 164)],
  [/^mycelium$/, mat('grass', 66, 164)],
  [/^podzol$|^coarse_dirt$|^rooted_dirt$/, mat('dirt', 120, 121)],
  [/^dirt$|^farmland$/, mat('dirt', 121, 121)],
  [/^dirt_path$|^grass_path$/, mat('dirt', 130, 121)],
  [/^mud$/, mat('dirt', 199, 121)],
  [/^clay$/, mat('stone', 211, 209)],
  [/^gravel$|^suspicious_gravel$/, mat('stone', 208, 209)],
  [/^snow(_block)?$|^powder_snow$/, mat('snow', 223, 223)],
  // Stone, after every stone-like name above.
  [/^deepslate_.*_ore$/, mat('dark-stone', 201, 202)],
  [/_ore$/, mat('stone', 207, 209)],
  [/^tuff/, mat('stone', 206, 209)],
  [/^smooth_stone/, mat('stone', 213, 209)],
  [/^mossy_/, mat('stone', 205, 209)],
  [/^cracked_|^chiseled_stone/, mat('stone', 208, 209)],
  [/^stone_brick|^stone_bricks$/, mat('stone', 211, 209)],
  [/andesite/, mat('stone', 210, 209)],
  [/cobblestone/, mat('stone', 207, 209)],
  [/^stone$|^infested_stone/, mat('stone', 209, 209)],
  // Things made of wood.
  [/^(bookshelf|chiseled_bookshelf|barrel|composter|note_block|jukebox|beehive|bee_nest|loom|cartography_table|fletching_table|smithing_table)$/, mat('woodwork', 122, 122)],
  [/^crafting_table$|^chest$|^trapped_chest$/, mat('woodwork', 124, 122)],
  [/^(furnace|blast_furnace|smoker|dispenser|dropper|observer|piston|sticky_piston|stonecutter|grindstone)$/, mat('stone', 207, 209)],
  // Plants that are blocks.
  [/^hay_block$/, mat('hay', 141, 141)],
  [/^dried_kelp_block$/, mat('hay', 154, 141)],
  [/^melon$/, mat('grass', 163, 164)],
  [/^(carved_)?pumpkin$/, mat('hay', 125, 141)],
  [/^cactus$/, mat('grass', 170, 164)],
  [/_mushroom_block$|^mushroom_stem$/, mat('mushroom', 106, 106)],
  [/^sponge$|^wet_sponge$/, mat('hay', 142, 141)],
  [/^slime_block$/, mat('slime', 159, 159)],
  [/^honey_block$|^honeycomb_block$/, mat('hay', 134, 141)],
  [/^tnt$/, mat('gem', 107, 7)],
  [/^target$/, mat('gem', 101, 7)],
]

/** A dye family's material, for any dyed block: wool, concrete, terracotta, glass, carpet, a bed. */
function dyeMaterial(name: string): Material | null {
  for (const dye of DYE_NAMES) {
    if (name !== dye && !name.startsWith(`${dye}_`)) continue
    const rest = name.slice(dye.length + 1)
    const [main, terracotta] = DYES[dye]
    const family = `dye:${dye}`
    if (rest === 'stained_glass') return mat(family, main, main, 'glass')
    if (rest === 'terracotta' || rest === 'glazed_terracotta') return mat(family, terracotta, main)
    if (/^(wool|concrete|concrete_powder|shulker_box|bed|carpet|banner|candle)$/.test(rest) || rest === '') return mat(family, main, main)
    return null
  }
  return null
}

/** A wood's material: planks, logs, leaves of one species, one family. */
function woodMaterial(name: string): Material | null {
  const n = name.replace(/^stripped_/, '')
  for (const sp of WOOD_NAMES) {
    if (n !== sp && !n.startsWith(`${sp}_`)) continue
    const rest = n.slice(sp.length + 1)
    const [planks, log, leaves] = WOODS[sp]
    const family = `wood:${sp}`
    if (rest === 'leaves') return mat(`leaves:${sp}`, leaves, leaves)
    // A stripped log shows the wood inside, so it is the planks' colour.
    if (/^(log|wood|stem|hyphae|block)$/.test(rest)) return mat(family, name.startsWith('stripped_') ? planks : log, planks)
    if (rest === '' || /^(planks|mosaic|sign|hanging_sign|pressure_plate|button|shelf)$/.test(rest)) return mat(family, planks, planks)
    return null
  }
  if (/^(azalea|flowering_azalea)_leaves$/.test(name)) return mat('leaves:azalea', name.startsWith('flowering') ? 166 : 164, 164)
  return null
}

/** What we draw a material we have no rule for in: a neutral steel. */
const UNKNOWN = mat('other', 214, 214)

/** The material of a block name with its shape's ending already taken off. */
export function materialOf(name: string): Material {
  return dyeMaterial(name) ?? woodMaterial(name) ?? RULES.find(([re]) => re.test(name))?.[1] ?? (name === 'terracotta' ? mat('granite', 115, 113) : UNKNOWN)
}

// ---------------------------------------------------------------- shapes

/** Never drawn: they have no look of their own in a build. */
const HIDDEN = /^(barrier|light|structure_void|moving_piston|piston_head|air|cave_air|void_air|structure_block|jigsaw|command_block|chain_command_block|repeating_command_block)$/

/**
 * Small things, skipped unless decorations are on: plants, flowers, crops,
 * torches and lanterns, rails and redstone, a sign, banners, heads, buttons,
 * levers, plates, pots, ladders, vines, chains, candles and the like.
 */
const DECOR = new RegExp([
  '_sapling$', '^(short_)?grass$', '^tall_grass$', '^fern$', '^large_fern$', '^dead_bush$', '^bush$', '_flower$', '^dandelion$', '^poppy$', '^blue_orchid$',
  '^allium$', '^azure_bluet$', '_tulip$', '^oxeye_daisy$', '^lily_of_the_valley$', '^wither_rose$', '^sunflower$', '^lilac$', '^rose_bush$', '^peony$',
  '^torchflower', '^pitcher_', '^pink_petals$', '^wildflowers$', '^leaf_litter$', '_mushroom$', '_fungus$', '_roots$', '^nether_sprouts$', '_vines?(_plant)?$', '^vine$',
  '^cave_vines', '^glow_lichen$', '^hanging_roots$', '^spore_blossom$', '^big_dripleaf', '^small_dripleaf$', '^azalea$', '^flowering_azalea$',
  '^wheat$', '^carrots$', '^potatoes$', '^beetroots$', '^sweet_berry_bush$', '^melon_stem$', '^pumpkin_stem$', '^attached_', '^sugar_cane$', '^bamboo$', '^bamboo_sapling$',
  '^kelp', '^seagrass$', '^tall_seagrass$', '^sea_pickle$', '_coral$', '_coral_fan$', '_coral_wall_fan$', '^lily_pad$', '^cocoa$', '^nether_wart$', '^chorus_',
  'torch$', '^lantern$', '^soul_lantern$', '^end_rod$', '^lightning_rod$', '^campfire$', '^soul_campfire$', '^fire$', '^soul_fire$', 'candle$', '_candle_cake$', '^cake$',
  'rail$', '^redstone_wire$', '^repeater$', '^comparator$', '^tripwire', '^lever$', '_button$', '_pressure_plate$', '^daylight_detector$',
  '_sign$', '_wall_sign$', '_hanging_sign$', '_banner$', '_wall_banner$', '_head$', '_wall_head$', '_skull$', '_wall_skull$',
  '^flower_pot$', '^potted_', '^ladder$', '^scaffolding$', '^cobweb$', '^chain$', '^iron_chain$', '^bell$', '^brewing_stand$', '^hopper$',
  '^lectern$', '^enchanting_table$', '^anvil$', '^chipped_anvil$', '^damaged_anvil$', '^cauldron$', '_cauldron$', '^conduit$', '^decorated_pot$',
  '^pointed_dripstone$', '_amethyst_bud$', '^amethyst_cluster$', '^frogspawn$', '^turtle_egg$', '^sniffer_egg$', '^dragon_egg$', '^end_portal', '^nether_portal$',
  '^tripwire_hook$', '^sculk_vein$', '^firefly_bush$', '^cactus_flower$', '^dried_ghast$', '^copper_torch$', '^copper_lantern$',
].join('|'))

/** Shape endings, longest first, and what each name is matched as once it is taken off. */
const SHAPE_ENDINGS: Array<[string, Shape]> = [
  ['_fence_gate', 'gate'], ['_stained_glass_pane', 'pane'], ['_glass_pane', 'pane'], ['_trapdoor', 'trapdoor'],
  ['_stairs', 'stairs'], ['_slab', 'slab-bottom'], ['_fence', 'fence'], ['_wall', 'wall'], ['_door', 'door'],
  ['_carpet', 'carpet'], ['_bed', 'bed'],
]

/** A decoration's colour: a warm light for flames, a green for plants, a steel for the rest. */
function decorColour(name: string): number {
  if (/torch|lantern|campfire|fire|candle|end_rod/.test(name)) return 135
  if (/rose|poppy|tulip|petals|flower|orchid|allium|bluet|daisy|lily|lilac|peony|berry/.test(name)) return 86
  if (/sapling|grass|fern|vine|kelp|seagrass|bush|leaf|wheat|carrot|potato|beet|cane|bamboo|dripleaf|azalea|moss|lichen|roots|sprouts|lily_pad/.test(name)) return 166
  if (/redstone|repeater|comparator/.test(name)) return 107
  if (/sign|banner|ladder|lectern|scaffolding|bell|chest/.test(name)) return 124
  return 212
}

/** Our look for one block state from someone's file. */
export function lookOf(state: string): BlockLook {
  const name = shortName(state)
  const props = stateProps(state)
  if (HIDDEN.test(name)) return { family: 'hidden', colour: 0, familyColour: 0, layer: 'solid', shape: 'cube', decor: false, hidden: true }
  if (DECOR.test(name)) {
    const c = decorColour(name)
    return { family: 'decor', colour: c, familyColour: c, layer: 'solid', shape: 'decor', decor: true, hidden: false }
  }
  let shape: Shape = 'cube'
  let material = name
  if (name === 'iron_bars') { shape = 'pane'; material = 'iron' }
  else if (name === 'glass_pane') { shape = 'pane'; material = 'glass' }
  else if (name === 'snow') { shape = Number(props.layers) >= 8 ? 'cube' : 'layer'; material = 'snow' }
  else if (name === 'moss_carpet') { shape = 'carpet'; material = 'moss_block' }
  else {
    for (const [ending, s] of SHAPE_ENDINGS) {
      if (!name.endsWith(ending)) continue
      shape = s
      material = name.slice(0, -ending.length)
      // A pane keeps its glass: white_stained_glass_pane is white glass.
      if (ending === '_stained_glass_pane') material = `${material}_stained_glass`
      else if (ending === '_glass_pane') material = `${material}_glass`
      break
    }
  }
  // Slabs say which half; a double slab is a whole block.
  if (shape === 'slab-bottom') shape = props.type === 'top' ? 'slab-top' : props.type === 'double' ? 'cube' : 'slab-bottom'
  // Names whose material is a plural of a slab's: stone_brick from stone_brick_slab, brick from brick_slab.
  const m = materialOf(material === 'stone_brick' ? 'stone_bricks' : material === 'brick' ? 'bricks' : material)
  return { family: m.family, colour: m.colour, familyColour: m.base, layer: m.layer ?? 'solid', shape, decor: false, hidden: false }
}

// ---------------------------------------------------------------- choices

export interface ColourChoices {
  /** Give each family its one colour (design 4.3). */
  mergeSimilar: boolean
  /** Draw decorations as small markers instead of skipping them. */
  showDecor: boolean
  /** The person's own colour for a block, by its name without properties (every stair of oak, whichever way it faces), over everything else. */
  overrides: Readonly<Record<string, number>>
}

export const DEFAULT_CHOICES: ColourChoices = { mergeSimilar: false, showDecor: false, overrides: {} }

/** The colour a state is drawn in under these choices. */
export function colourFor(state: string, look: BlockLook, choices: ColourChoices): number {
  const own = choices.overrides[blockName(state)]
  if (Number.isInteger(own) && own >= 0 && own <= 255) return own
  return choices.mergeSimilar ? look.familyColour : look.colour
}

/** Whether a state is drawn at all under these choices. */
export function drawn(look: BlockLook, choices: Pick<ColourChoices, 'showDecor'>): boolean {
  return !look.hidden && (!look.decor || choices.showDecor)
}
