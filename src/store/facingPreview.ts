/**
 * facingPreview.ts - whether the bench shows the FACING choice (DECK-0003
 * §1.18): on while the AVATAR sheet is open (Workshop), so PATH and UPRIGHT
 * can be seen on the shape itself (workshop/FacingPreview.tsx).
 */

import { create } from 'zustand'

export const useFacingPreview = create<{ on: boolean }>(() => ({ on: false }))
