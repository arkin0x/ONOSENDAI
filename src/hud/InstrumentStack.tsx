/**
 * InstrumentStack.tsx - the order of the chips in the top-left stack.
 *
 * arkinox's rule (2026-10-14): "Toasts on the bottom, return button
 * notification ui stuff on the top, persistent stuff in the middle." So a
 * chip says which group it belongs to by where App puts it, and the groups
 * are drawn in one fixed order whatever order they are handed in:
 *
 * | Group | What | Examples |
 * |---|---|---|
 * | return | a view you can leave: the chip carries RETURN or EXIT | VIEWING (focus, /C/ link, hyperspace stop), BUILD |
 * | status | what is simply true right now, there until it stops being true | broken chain, the line, a ride, the chain, XOR BITS, notifications, found, nearby, presence |
 * | toast | a word about something that just happened, gone when tapped or timed out | job done, starred, WALK stopped, a /C/ link's block |
 *
 * Each group is `display: contents`, so the stack's own gap and alignment
 * apply across all of them as if they were one list.
 */

import type { ReactNode } from 'react'

export type InstrumentGroup = 'return' | 'status' | 'toast'

/** Top to bottom. */
export const INSTRUMENT_GROUPS: readonly InstrumentGroup[] = ['return', 'status', 'toast']

export function InstrumentStack({ groups }: { groups: Record<InstrumentGroup, ReactNode> }): JSX.Element {
  return (
    <>
      {INSTRUMENT_GROUPS.map((g) => (
        <div key={g} className={`instruments__group instruments__group--${g}`}>{groups[g]}</div>
      ))}
    </>
  )
}
