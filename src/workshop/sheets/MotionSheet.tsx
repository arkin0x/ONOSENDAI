/**
 * MotionSheet.tsx - MOTION, a top-level area with its own sheet (workshop
 * redesign, phase 1; arkinox, 2026-11-14: "It's too much for appending to the
 * bottom of the shard menu"). The motion editor (workshop/AnimEditor.tsx)
 * lives here whole: presets, the motion list and its controls, path points,
 * messages, and its preview row (PLAY, PAUSE, STOP and the scrub), which
 * stays pinned at the top of the sheet while the rest scrolls.
 */

import { AnimEditor } from '../AnimEditor'

export function MotionBody(): JSX.Element | null {
  return <AnimEditor />
}
