/**
 * escapeOrder.ts - what Esc does next in the workshop, in arkinox's order
 * (2026-10-01): the open panel, then the view pad, then what is in hand, then
 * out of a placed part one level (as EXIT does), and only then the workshop.
 * Its own module so the order is tested without the bench.
 */
export type EscapeStep = 'panel' | 'view' | 'hand' | 'exit' | 'close'

export function escapeStep(panelOpen: boolean, viewOpen: boolean, inHand: boolean, insideDepth: number): EscapeStep {
  if (panelOpen) return 'panel'
  if (viewOpen) return 'view'
  if (inHand) return 'hand'
  if (insideDepth > 0) return 'exit'
  return 'close'
}
