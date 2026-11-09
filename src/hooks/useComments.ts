/**
 * useComments: the comments on one hidden item, and posting one.
 *
 * Fetched once per subject from the app's relays (every comment on the
 * bag, threaded to this item), opened with the key that opened the bag: the
 * bag's region key, or in a room the room key (DECK-0006). Every bag this
 * device hid or found holds that key (`bagKeyHex`), so nothing is computed.
 * Only a subject without it has the region key derived from where the bag
 * is, in the region worker and never during render (a key at height 20
 * froze the page for seconds; above 20 cyberspace-core refuses and the card
 * crashed, 2026-11-09), and only up to this machine's limit: above it the
 * section says COMMENTS UNAVAILABLE.
 * Posted by sealing the words under that key, signing the kind 1111 with the
 * active signer and publishing it to the same relays. A posted comment is
 * shown at once; a failed publish says so and keeps the text.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_COMMENT_LENGTH, commentsFilter, itemParent, openComments, sealedComment, threadComments, type Comment, type CommentParent, type CommentSubject } from '../lib/comments'
import { hexToBytes, type NostrEvent } from '../lib/events'
import { onCanonicalSignIn, publish, queryChecked, type ReadTrouble } from '../lib/relay'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { localKeyCeiling } from '../lib/deployPlan'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useMutes } from '../store/useMutes'
import { pruneThread } from '../lib/muteList'

export interface CommentsState {
  comments: Comment[]
  loading: boolean
  error: string | null
  /** Why the canonical relay gave the last read nothing, if it did not answer (it is not "no comments"). */
  trouble: ReadTrouble | null
  posting: boolean
  /**
   * No key can be had for these comments: the bag's key is not held here and
   * its height is above what this machine computes. Absent for public comments.
   */
  unavailable?: boolean
  /** Post a comment on the item, or a reply to one of its comments. Resolves true when a relay accepted it. */
  post: (text: string, parent?: CommentParent) => Promise<boolean>
  refresh: () => void
}

export function useComments(subject: CommentSubject | null): CommentsState {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [opened, setOpened] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<ReadTrouble | null>(null)
  const [posting, setPosting] = useState(false)
  const [tick, setTick] = useState(0)
  const key = subject ? `${subject.author}:${subject.lookupId}:${subject.itemId}` : null
  // The key that opened the bag, held by every bag hidden or found here
  // (the region key, or in a room the room key): read, never computed.
  const heldHex = subject?.bagKeyHex
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const held = useMemo(() => (heldHex ? hexToBytes(heldHex) : null), [key, heldHex])
  // Not held, and above what this machine computes: no key to be had. Cheap to
  // tell, so it is told in render; the key itself never is.
  const unavailable = !!subject && !held && subject.height > Math.min(MAX_COMPUTE_HEIGHT, localKeyCeiling())
  // Not held but within reach: derived in the region worker, once per subject.
  const [derived, setDerived] = useState<{ key: string; regionKey: Uint8Array | null } | null>(null)
  useEffect(() => {
    if (!subject || held || unavailable) return
    let alive = true
    // A refusal thrown before the promise (no Worker, computed inline) reads as a rejection.
    Promise.resolve()
      .then(() => regionKeyOffThread(subject.at, subject.height, MAX_COMPUTE_HEIGHT))
      .then((rk) => { if (alive) setDerived({ key: key!, regionKey: rk.key }) })
      .catch(() => { if (alive) setDerived({ key: key!, regionKey: null }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, held, unavailable])
  const regionKey = held ?? (derived && derived.key === key ? derived.regionKey : null)
  // Derived and still refused (the worker failed): no key, as above the limit.
  const failed = !held && !!derived && derived.key === key && !derived.regionKey
  const waiting = !!subject && !regionKey && !unavailable && !failed

  useEffect(() => {
    if (!subject || !regionKey) return
    let alive = true
    setLoading(true); setError(null); setEvents([]); setOpened(new Map())
    queryChecked(commentsFilter(subject))
      .then(async ({ events: found, trouble: why }) => { const words = await openComments(found, regionKey); if (alive) { setEvents(found); setOpened(words); setTrouble(why) } })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, regionKey])

  // Refused for want of AUTH: read again once the relay signs this visit in.
  useEffect(() => (trouble ? onCanonicalSignIn(() => setTick((t) => t + 1)) : undefined), [trouble])

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
  return { comments, loading: loading || waiting, error, trouble, posting, unavailable: unavailable || failed, post, refresh: () => setTick((t) => t + 1) }
}
