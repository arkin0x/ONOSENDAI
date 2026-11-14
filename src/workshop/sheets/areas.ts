/**
 * areas.ts - the workshop's top-level areas, each a button in the top bar and
 * a sheet of its own (workshop redesign, phase 1), and what else opens as a
 * sheet: the palette and STAMP's object picker. One sheet at a time.
 */

/** A top-level area in the top bar. */
export type Area = 'menu' | 'shard' | 'grid' | 'avatar' | 'motion'

/** Everything that opens as a sheet over the dock: an area, MORE (phase 2), the palette, the object picker. */
export type SheetKind = Area | 'more' | 'palette' | 'object'

/** The words on each area's button and sheet header. */
export const AREA_LABEL: Record<Area, string> = { menu: 'MENU', shard: 'SHARD', grid: 'GRID', avatar: 'AVATAR', motion: 'MOTION' }

/**
 * Whether MOTION has an editor to open. The motion editor (PR #735,
 * workshop/AnimEditor.tsx) drops into sheets/MotionSheet.tsx as it is; until
 * it lands, the MOTION button holds its place in the top bar, greyed out.
 */
export const MOTION_READY = false
