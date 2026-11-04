/**
 * useComments: the comments on one hidden item, and posting one.
 *
 * Fetched once per subject from the app's relays (every comment on the
 * bag, threaded to this item), opened with the bag's region key, which this
 * client derives from where the bag is, exactly as it did to open the bag.
 * Posted by sealing the words under that key, signing the kind 1111 with the
 * active signer and publishing it to the same relays. A posted comment is
 * shown at once; a failed publish says so and keeps the text.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_COMMENT_LENGTH, commentsFilter, itemParent, openComments, sealedComment, threadComments, type Comment, type CommentParent, type CommentSubject } from '../lib/comments'
import { hexToBytes, type NostrEvent } from '../lib/events'
import { publish, query } from '../lib/relay'
import { regionKeyAt } from '../lib/shardCrypto'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useMutes } from '../store/useMutes'
import { pruneThread } from '../lib/muteList'

export interface CommentsState {
  comments: Comment[]
  loading: boolean
  error: string | null
  posting: boolean
  /** Post a comment on the item, or a reply to one of its comments. Resolves true when a relay accepted it. */
  post: (text: string, parent?: CommentParent) => Promise<boolean>
  refresh: () => void
}

export function useComments(subject: CommentSubject | null): CommentsState {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [opened, setOpened] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [tick, setTick] = useState(0)
  const key = subject ? `${subject.author}:${subject.lookupId}:${subject.itemId}` : null
  // The region key is a function of the bag (its place and height), so it is derived once per subject.
  // In a room it is the room key, which the find already carries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const regionKey = useMemo(() => (subject ? (subject.roomKeyHex ? hexToBytes(subject.roomKeyHex) : regionKeyAt(subject.at, subject.height, MAX_COMPUTE_HEIGHT).key) : null), [key])

  useEffect(() => {
    if (!subject || !regionKey) return
    let alive = true
    setLoading(true); setError(null); setEvents([]); setOpened(new Map())
    query(commentsFilter(subject))
      .then(async (found) => { const words = await openComments(found, regionKey); if (alive) { setEvents(found); setOpened(words) } })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const post = useCallback(async (text: string, parent?: CommentParent): Promise<boolean> => {
    if (!subject || !regionKey) return false
    setPosting(true); setError(null)
    try {
      const body = text.trim().slice(0, MAX_COMMENT_LENGTH)
      const template = await sealedComment(subject, parent ?? itemParent(subject), body, Math.floor(Date.now() / 1000), regionKey)
      const event = await useCyberspace.getState().signEvent(template)
      const result = await publish(event)
      if (!result.ok) { setError(`Not published: ${result.reason}`); return false }
      setEvents((prev) => [...prev, event])
      setOpened((prev) => new Map(prev).set(event.id, body))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setPosting(false)
    }
  }, [subject, regionKey])

  // A comment by someone blocked is not shown, nor others' replies under it; yours stay (store/useMutes).
  const muted = useMutes((s) => s.muted)
  const me = useCyberspace((s) => s.identity.pubkey)
  const comments = subject ? pruneThread(threadComments(events, subject, opened), muted, me) : []
  return { comments, loading, error, posting, post, refresh: () => setTick((t) => t + 1) }
}
