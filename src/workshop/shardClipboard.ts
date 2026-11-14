/**
 * shardClipboard.ts - a whole shard onto the clipboard, the bench's and the
 * system's, for MENU's list and AVATAR's row. Moved out of Workshop.tsx
 * unchanged (workshop redesign, phase 1).
 */

import { toPayload, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../store/useWorkshop'

/**
 * Put a shard on the clipboard, or say why not. Two silences lived here.
 *
 * An empty shard copied happily. A brand new object is zero vertices, and
 * the payload that comes out is well formed, so pasting one into snocrash
 * reported success and put nothing on the bench. "Nothing happens" was the
 * whole of the bug report and it was accurate. Nothing is worth copying
 * until there is something in it.
 *
 * And where there is no clipboard at all, `navigator.clipboard?.writeText(x)
 * .then(...)` short-circuits the ENTIRE chain, not just the call: the button
 * did nothing and said nothing. The check is explicit now, and the avatar's
 * COPY goes through here too, where it used to reach for
 * navigator.clipboard with no guard and throw.
 *
 * It fills the bench's own clipboard first, so the PASTE beside the tools
 * puts the whole shard down in any shard (arkinox, 2026-10-08), and that
 * works even where the system clipboard does not.
 */
export function copyShard(s: ShardModel, ok: string): void {
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  if (!w().copyShard(s)) { say(`"${s.name}" is empty. There is nothing to copy yet.`); return }
  const clip = navigator.clipboard
  if (!clip) return
  void clip.writeText(JSON.stringify(toPayload(s))).then(
    () => say(ok),
    () => say(`Copied "${s.name}" for PASTE here. The system clipboard refused it.`),
  )
}

export function copyShardById(id: string): void {
  const w = useWorkshop.getState
  const s = w().shards.find((x) => x.id === id)
  if (!s) return
  copyShard(s, `Copied "${s.name}" to the clipboard. PASTE it here or anywhere.`)
}
