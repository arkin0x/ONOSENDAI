/**
 * Reactions.tsx: who reacted to something, one row per emoji, and a row of
 * one-tap reactions to add yours (arkinox, 2026-09-28, laid out as the
 * reaction list under a note in other clients: the emoji, then the faces).
 *
 * Tapping a reaction you already gave takes it back (a NIP-09 deletion of your
 * kind 7). The faces are the reactors' profile pictures; past MAX_FACES a row
 * says how many more.
 */

import { useReactions } from '../hooks/useSocial'
import { REACTIONS, reactionGlyph, type SocialTarget } from '../lib/social'
import { useCyberspace } from '../store/useCyberspace'
import { ProfilePic } from './ProfileBadge'

/** Faces drawn per emoji row before "+N". */
const MAX_FACES = 8

function Glyph({ content, image }: { content: string; image?: string }): JSX.Element {
  return image ? <img className="reactions__img" src={image} alt={content} /> : <>{reactionGlyph(content)}</>
}

export function Reactions({ target, alsoTell = [] }: { target: SocialTarget; alsoTell?: string[] }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const { groups, loading, busy, error, toggle } = useReactions(target, alsoTell)
  const given = new Set(groups.filter((g) => g.ids.has(me)).map((g) => g.content))
  return (
    <section className="reactions" aria-label="Reactions">
      <span className="secret__label">Reactions{loading ? ' …' : groups.length ? ` (${groups.reduce((n, g) => n + g.pubkeys.length, 0)})` : ''}</span>
      {groups.length > 0 && (
        <ul className="reactions__list">
          {groups.map((g) => (
            <li key={g.content} className="reactions__row">
              <span className="reactions__glyph" title={g.content}><Glyph content={g.content} image={g.image} /></span>
              <span className="reactions__faces">
                {g.pubkeys.slice(0, MAX_FACES).map((pk) => <ProfilePic key={pk} pubkey={pk} size={26} />)}
                {g.pubkeys.length > MAX_FACES && <span className="reactions__more">+{g.pubkeys.length - MAX_FACES}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="reactions__pick" role="group" aria-label="React">
        {REACTIONS.map((r) => (
          <button
            key={r}
            className={`reactions__btn ${given.has(r) ? 'is-on' : ''}`}
            disabled={busy}
            aria-pressed={given.has(r)}
            title={given.has(r) ? 'Take your reaction back' : r === '+' ? 'Like' : `React ${r}`}
            onClick={() => void toggle(r)}
          >{reactionGlyph(r)}</button>
        ))}
      </div>
      {error && <p className="comments__error">{error}</p>}
    </section>
  )
}
