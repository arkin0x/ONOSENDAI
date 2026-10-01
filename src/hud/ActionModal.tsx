/**
 * ActionModal.tsx: one action in someone's chain, with its reactions and
 * public comments (arkinox, 2026-09-28).
 *
 * Opened from the chain explorer's "💬 Comments (N)" for the action under
 * the mark. It says what the action was and who took it, then the reactions
 * and the comment thread, laid out like the comment section under a hidden
 * shard. An action of yours that is not on a relay yet can be commented on,
 * but nobody else can see it until it is published, and the modal says so.
 */

import { nip19 } from 'nostr-tools'
import { ACTION_KIND } from '../lib/social'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { useSocialUi } from '../store/useSocialUi'
import { ProfilePic } from './ProfileBadge'
import { Reactions } from './Reactions'
import { ActionComments } from './Comments'
import { useEscape } from '../hooks/useEscape'

export function ActionModal(): JSX.Element | null {
  const action = useSocialUi((s) => s.action)
  const me = useCyberspace((s) => s.identity.pubkey)
  const unpublished = useCyberspace((s) => (action && action.pubkey === me ? s.published[action.id] !== 'ok' : false))
  const profile = useProfile(action?.pubkey ?? null)
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', action !== null, () => useSocialUi.getState().closeAction())
  if (!action) return null

  const close = (): void => useSocialUi.getState().closeAction()
  const npub = nip19.npubEncode(action.pubkey)
  const mine = action.pubkey === me
  const target = { id: action.id, pubkey: action.pubkey, kind: ACTION_KIND }

  return (
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Action" onPointerDown={close}>
      <div className="modal__card secret" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className={`explorer__type explorer__type--${action.type}`}>{action.type.toUpperCase()}</span>
          {mine && <span className="secret__mine">YOURS</span>}
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>

        <div className="secret__creator">
          <span className="secret__label">Moved by</span>
          <div className="secret__person">
            <ProfilePic pubkey={action.pubkey} size={40} />
            <div className="secret__person-text">
              <span className="secret__name">{profileLabel(profile, npub)}{mine ? ' (you)' : ''}</span>
              <span className="secret__npub" title={npub}>{shortHex(npub, 14, 8)}</span>
            </div>
          </div>
        </div>

        <dl className="secret__facts">
          <div><dt>When</dt><dd title={formatStamp(action.createdAt)}>{formatAgo(action.createdAt)}</dd></div>
          <div><dt>Coord</dt><dd title={action.coordHex}>{shortHex(action.coordHex, 8, 6)}</dd></div>
          <div><dt>Sector</dt><dd title={action.sector}>{action.sector}</dd></div>
        </dl>

        {unpublished && (
          <p className="notice">This move is only on this device. Switch to LIVE to publish it; until then nobody else can see it, or what is said about it.</p>
        )}

        <Reactions target={target} />
        <ActionComments action={target} />
      </div>
    </div>
  )
}
