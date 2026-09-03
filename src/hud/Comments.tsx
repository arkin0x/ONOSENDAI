/**
 * Comments.tsx: the comment section under a hidden shard or message.
 *
 * NIP-22 comments, threaded: each answers the item or another comment, and
 * the person answered is `p`-tagged, so their client tells them. The list
 * and a composer; REPLY opens a composer under a comment. The words are
 * sealed to the place like the item (FF-1 derived-key events under the bag's
 * region key): here they read as words, elsewhere as an invitation to come
 * and find them. A comment this client could not open shows the placeholder.
 */

import { useState } from 'react'
import { nip19 } from 'nostr-tools'
import { MAX_COMMENT_LENGTH, commentParent, countComments, type Comment, type CommentParent, type CommentSubject } from '../lib/comments'
import { formatAgo, formatStamp } from '../lib/time'
import { useComments } from '../hooks/useComments'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { ProfilePic } from './ProfileBadge'

function Composer({ placeholder, busy, onPost, onCancel }: { placeholder: string; busy: boolean; onPost: (text: string) => Promise<boolean>; onCancel?: () => void }): JSX.Element {
  const [text, setText] = useState('')
  const send = async (): Promise<void> => { if (await onPost(text)) { setText(''); onCancel?.() } }
  return (
    <div className="comments__form">
      <textarea
        className="comments__input"
        value={text}
        maxLength={MAX_COMMENT_LENGTH}
        placeholder={placeholder}
        rows={2}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
      />
      <div className="comments__row">
        {onCancel && <button className="secret__act" onClick={onCancel} disabled={busy}>CANCEL</button>}
        <button className="secret__act comments__post" onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? 'POSTING…' : 'POST'}</button>
      </div>
    </div>
  )
}

function Author({ pubkey, mine }: { pubkey: string; mine: boolean }): JSX.Element {
  const profile = useProfile(pubkey)
  let npub = pubkey
  try { npub = nip19.npubEncode(pubkey) } catch { /* shown as hex */ }
  return (
    <span className="comment__author">
      <ProfilePic pubkey={pubkey} size={18} />
      <span className="comment__name">{profileLabel(profile, npub)}{mine ? ' (you)' : ''}</span>
    </span>
  )
}

function CommentRow({ c, me, depth, posting, onPost }: { c: Comment; me: string; depth: number; posting: boolean; onPost: (text: string, parent: CommentParent) => Promise<boolean> }): JSX.Element {
  const [replying, setReplying] = useState(false)
  return (
    <li className="comment" style={{ marginLeft: Math.min(depth, 4) * 14 }}>
      <div className="comment__head">
        <Author pubkey={c.pubkey} mine={c.pubkey === me} />
        <span className="comment__when" title={formatStamp(c.createdAt)}>{formatAgo(c.createdAt)}</span>
      </div>
      <p className={`comment__text ${c.sealed ? 'comment__text--sealed' : ''}`}>{c.text}</p>
      {!replying && <button className="comment__reply" onClick={() => setReplying(true)}>REPLY</button>}
      {replying && <Composer placeholder="Your reply" busy={posting} onPost={(t) => onPost(t, commentParent(c))} onCancel={() => setReplying(false)} />}
      {c.replies.length > 0 && (
        <ul className="comments__list">
          {c.replies.map((r) => <CommentRow key={r.id} c={r} me={me} depth={depth + 1} posting={posting} onPost={onPost} />)}
        </ul>
      )}
    </li>
  )
}

export function Comments({ subject }: { subject: CommentSubject }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const signerKind = useCyberspace((s) => s.signerKind)
  const { comments, loading, error, posting, post, refresh } = useComments(subject)
  const n = countComments(comments)
  return (
    <section className="comments" aria-label="Comments">
      <div className="comments__head">
        <span className="secret__label">Comments{n > 0 ? ` (${n})` : ''}</span>
        <button className="comment__reply" onClick={refresh} disabled={loading}>{loading ? 'LOADING…' : 'REFRESH'}</button>
      </div>
      {comments.length === 0 && !loading && <p className="comments__empty">No comments yet.</p>}
      {comments.length > 0 && (
        <ul className="comments__list">
          {comments.map((c) => <CommentRow key={c.id} c={c} me={me} depth={0} posting={posting} onPost={post} />)}
        </ul>
      )}
      <Composer placeholder={subject.author === me ? 'Add a note under your own' : 'Say something to the author'} busy={posting} onPost={(t) => post(t)} />
      {error && <p className="comments__error">{error}</p>}
      <p className="comments__note">
        Comments are sealed to this place, like what they answer: other clients show only that a comment is
        hiding somewhere in cyberspace. The author is tagged and gets told by their own client.
        {signerKind !== 'local' ? ' Your signer will be asked to sign it.' : ''}
      </p>
    </section>
  )
}
