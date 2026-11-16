/**
 * AvatarSheet.tsx - AVATAR, a top-level area with its own sheet (workshop
 * redesign, phase 1; arkinox, 2026-10-23): what you wear, the ghost for
 * scale, and the way to change it, with its size against the size limit.
 */

import { useMemo } from 'react'
import { ClipboardCopy, CopyPlus } from 'lucide-react'
import { toPayload } from 'sno-core/shards'
import { avatarReach } from 'cyberspace-core'
import { Field, Switch } from '../../hud/ui/Switch'
import { ShardThumb } from '../../hud/ShardThumb'
import { avatarKb, avatarSize } from '../../lib/avatar'
import { useAvatars } from '../../store/useAvatars'
import { useCyberspace } from '../../store/useCyberspace'
import { useWorkshop } from '../../store/useWorkshop'
import { copyShard } from '../shardClipboard'

export function AvatarBody(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const me = useCyberspace((s) => s.identity.pubkey)
  const myAvatar = useAvatars((s) => s.shards[me] ?? null)
  const phase = useAvatars((s) => s.phase)
  const adoptError = useAvatars((s) => s.adoptError)
  const minePublished = useAvatars((s) => s.minePublished)
  const live = useCyberspace((s) => s.live)
  // What the avatar is (spec 8.10): its reach, its detail and its size against
  // the size limit, memoised on the shard; computed only while this sheet
  // is open, which is what shows it and acts on it.
  const buildable = shard !== null && shard.vertices.length > 0 && shard.faces.length > 0
  const info = useMemo(() => {
    if (!shard || !buildable) return { reach: 0, detail: 0, size: avatarSize('') }
    const payload = toPayload(shard)
    return { reach: Math.max(1, avatarReach(payload)), detail: shard.vertices.length + shard.faces.length, size: avatarSize(JSON.stringify(payload)) }
  }, [buildable, shard])
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  if (!shard) return null
  return (
    <>
      {/* The shape others see for you: this shard, published as kind 11333,
          drawn in the dodecahedron's cell wherever you are drawn. */}
      <div className="workshop__avatar" role="group" aria-label="My avatar">
        <div className="workshop__row">
          <span className="workshop__label">MY AVATAR</span>
          <span className="workshop__value workshop__value--wide">{myAvatar ? myAvatar.name : 'icosahedron'}</span>
        </div>
        {/* The avatar is not one of these shards. It lives in its own store,
            read back from the kind 11333 event you published, which is why
            deleting the object it was built from leaves the avatar standing
            (arkinox found this by doing it). It gets a row anyway so the
            shape you are wearing is visible and can be copied back into the
            workshop, and no row that would change it: the way to change an
            avatar is USE THIS SHARD or DODECAHEDRON under SET AVATAR. */}
        {myAvatar && (
          <ul className="workshop__list">
            <li className="workshop__list-avatar">
              <span className="workshop__pick workshop__pick--static">
                <ShardThumb shard={myAvatar} />
                <span className="workshop__pick-name">{myAvatar.name}</span>
                <span className="workshop__pick-meta">{myAvatar.vertices.length} v · {myAvatar.faces.length} f · {myAvatar.mode}</span>
              </span>
              <span className="workshop__tag" title="The shape others see for you. Change it with USE THIS SHARD below.">AVATAR</span>
              <button
                className="workshop__mini"
                title="Copy it into your objects, where you can edit it"
                aria-label="Copy your avatar into your objects"
                onClick={() => { const id = w().importShard(myAvatar); w().select(id); say(`"${myAvatar.name}" copied into your objects.`) }}
              ><CopyPlus size={13} strokeWidth={2.25} aria-hidden /></button>
              <button className="workshop__mini" title="Copy to the clipboard" aria-label="Copy your avatar to the clipboard" onClick={() => copyShard(myAvatar, 'Avatar copied.')}><ClipboardCopy size={13} strokeWidth={2.25} aria-hidden /></button>
            </li>
          </ul>
        )}
      </div>
      {/* A switch, as the avatar trail, hX and region key settings are,
          in the workshop's own green (arkinox, 2026-10-10). */}
      <div className="workshop__row">
        <Field id="ws-avatar-ghost" label="show default avatar ghost for scale">
          <Switch id="ws-avatar-ghost" className="ui-switch--ok" checked={showAvatar} onCheckedChange={(v) => w().setShowAvatar(v)} />
        </Field>
      </div>
      {/* SET AVATAR: this shard as the shape others see for you, or back to the default. */}
      <div className="workshop__avatar" role="group" aria-label="Set avatar">
        <div className="workshop__row">
          <span className="workshop__label">SET AVATAR</span>
        </div>
        {/* The buttons take their own row and share it evenly, the way NEW
            OBJECT and PASTE do. On the name's line a long object name pushed
            them off the edge (arkinox, 2026-09-15). */}
        <div className="workshop__list-row">
        {/* Adopted while LOCAL: signed and kept and drawn for you, but no relay has it. */}
        {myAvatar && !minePublished && !phase && (
          live
            ? <button className="workshop__btn workshop__btn--warn" onClick={() => { void useAvatars.getState().broadcastMine().then((ok) => say(ok ? 'Your avatar is published.' : useAvatars.getState().adoptError ?? 'No relay took the avatar.')) }} title="Send the avatar you adopted while LOCAL to the relays">BROADCAST</button>
            : <span className="workshop__value">LOCAL</span>
        )}
        {phase ? (
          <button className="workshop__btn" disabled title={phase === 'signing' ? 'Waiting for your signer' : 'Publishing to the relays'}>{phase === 'signing' ? 'SIGNING' : 'PUBLISHING'}</button>
        ) : (
          <button
            className="workshop__btn"
            disabled={!buildable || info.size.over}
            onClick={() => {
              void useAvatars.getState().adopt(shard).then((ok) => {
                const st = useAvatars.getState()
                if (!ok) { say(st.adoptError ?? 'Your avatar is as it was.'); return }
                say(st.minePublished
                  ? `"${shard.name}" is your avatar now.`
                  : `"${shard.name}" is your avatar on this device. You are LOCAL, so no relay has it. BROADCAST sends it when you go LIVE.`)
              })
            }}
            title={info.size.over
              ? 'Over the 128 KB size limit for an avatar. Make it smaller to wear it.'
              : 'Publish this object as the shape others see for you, at true scale: the white avatar on the grid is the size of one cell.'}
          >USE THIS SHARD</button>
        )}
        {myAvatar && !phase && (
          <button className="workshop__btn" onClick={() => { void useAvatars.getState().adopt(null).then((ok) => say(ok ? 'The icosahedron is your avatar again.' : useAvatars.getState().adoptError ?? 'No relay took the change.')) }} title="Back to the icosahedron; it owes no work">ICOSAHEDRON</button>
        )}
        </div>
        {/* What others will download and draw: its reach, its detail and its
            size. Over the 128 KB size limit no client draws it (spec 8.10);
            above 64,000 bytes some remote signers refuse to sign it. */}
        {buildable && (
          <span
            className="workshop__work"
            aria-live="polite"
            title={!phase && info.size.warn ? 'A remote signer (NIP-46) may fail to sign an avatar this big. A browser extension or a key on this device signs it.' : undefined}
          >
            {phase === 'signing'
              ? 'WAITING FOR YOUR SIGNER'
              : phase === 'publishing'
                ? 'SIGNED · PUBLISHING'
                : `${adoptError ? `LAST ATTEMPT: ${adoptError.toUpperCase()} · ` : ''}${info.size.over
                  ? `OVER THE 128 KB SIZE LIMIT · ${avatarKb(info.size.bytes, Math.ceil)} KB`
                  : `${info.reach.toFixed(info.reach >= 10 ? 0 : 1)} GIBSON REACH · ${info.detail} VERTICES + FACES · ${avatarKb(info.size.bytes, Math.ceil)} KB${info.size.warn ? ' · SOME REMOTE SIGNERS REFUSE EVENTS THIS BIG' : ''}`}`}
          </span>
        )}
      </div>
    </>
  )
}
