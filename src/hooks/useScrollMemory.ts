/**
 * useScrollMemory.ts - a long list that comes back where it was left
 * (lib/scrollMemory.ts has the rules). Put the returned ref on the element
 * that scrolls:
 *
 *   const listRef = useScrollMemory('workshop-menu', loaded)
 *   <div className="ws__panel" ref={listRef}>…</div>
 *
 * `list` names the list; the signed-in identity is added to it, so each
 * identity has its own place in each list. `ready` says the list has drawn
 * every row it is going to (default true): while it is false the place goes
 * back only once the list is tall enough to reach it exactly, never part way.
 *
 * The place is put back before paint when the rows are already there, and
 * otherwise as they arrive, whether the caller draws again or rows land under
 * a memoized child. A switch of identity puts back that identity's place.
 */

import { useCallback, useLayoutEffect, useRef } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { attachScrollMemory, scrollKey, type ScrollMemory } from '../lib/scrollMemory'

export function useScrollMemory(list: string, ready = true): (el: HTMLElement | null) => void {
  const me = useCyberspace((s) => s.identity.pubkey)
  const key = scrollKey(list, me)
  const readyNow = useRef(ready)
  readyNow.current = ready
  const memory = useRef<ScrollMemory | null>(null)
  // A new key hands React a new ref: the old element is let go and the same
  // element taken again under the new key.
  const ref = useCallback((el: HTMLElement | null) => {
    memory.current?.detach()
    memory.current = el ? attachScrollMemory(el, key, () => readyNow.current) : null
  }, [key])
  // Each draw of the caller may have brought the rows, or made the list ready.
  useLayoutEffect(() => { memory.current?.settle() })
  return ref
}
