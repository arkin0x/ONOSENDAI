/**
 * heldSize.ts - what the placed objects on the bench resolve to, handed over
 * by the bench (Bench HeldProbe, which can read them: lib/parts useResolved)
 * so BY SIZE can measure a held object as drawn from outside the canvas: the
 * move keys, the handles and a turn (lib/heldSize.ts says why).
 */

import { create } from 'zustand'
import type { ResolvedParts } from '../lib/heldSize'

const NONE: ResolvedParts = new Map()

export const useBenchResolved = create<{ resolved: ResolvedParts }>(() => ({ resolved: NONE }))
