/**
 * areas.ts - the workshop's top-level areas, each a button in the top bar and
 * a sheet of its own (workshop redesign, phase 1), and what else opens as a
 * sheet: the palette and STAMP's object picker. One sheet at a time.
 */

/** A top-level area in the top bar. */
export type Area = 'menu' | 'shard' | 'grid' | 'avatar' | 'motion'

/** Everything that opens as a sheet over the dock. */
export type SheetKind = Area | 'palette' | 'object'

/** The words on each area's button and sheet header. */
export const AREA_LABEL: Record<Area, string> = { menu: 'MENU', shard: 'SHARD', grid: 'GRID', avatar: 'AVATAR', motion: 'MOTION' }

/**
 * Whether MOTION has an editor to open: it has (workshop/AnimEditor.tsx in
 * sheets/MotionSheet.tsx, PR #735).
 */
export const MOTION_READY = true
