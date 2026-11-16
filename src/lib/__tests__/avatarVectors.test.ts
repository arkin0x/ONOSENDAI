/**
 * The spec's golden vectors for what a reader checks on an avatar event
 * (CYBERSPACE_V2.md 8.10, avatar-vectors.json from arkin0x/cyberspace,
 * copied unchanged): the verdict every avatar is drawn by (avatarShard) and
 * the size limit the AVATAR sheet and adopt refuse at (avatarSize), against
 * the spec's own answers. No verdict reads a tag: an avatar carries no work.
 */
import { describe, expect, it } from 'vitest'
import { AVATAR_CONTENT_MAX, AVATAR_KIND, verifyAvatar } from 'cyberspace-core'
import { avatarSize } from '../avatar'
import { avatarShard } from '../../store/useAvatars'
import vectors from './fixtures/avatar-vectors.json'

interface Recipe { prefix: string; fill: string; count: number; suffix: string }
interface VectorEvent { kind: number; pubkey: string; tags: string[][]; content: string | null; content_recipe?: Recipe }
const contentOf = (e: VectorEvent): string =>
  e.content ?? `${e.content_recipe!.prefix}${e.content_recipe!.fill.repeat(e.content_recipe!.count)}${e.content_recipe!.suffix}`

describe('avatar golden vectors (spec 8.10)', () => {
  it('uses the spec constants', () => {
    expect(vectors.constants.kind).toBe(AVATAR_KIND)
    expect(vectors.constants.content_max).toBe(AVATAR_CONTENT_MAX)
  })

  it('reaches the spec verdict on every event, and draws none the spec refuses', () => {
    expect(vectors.verdicts.length).toBeGreaterThan(20)
    for (const row of vectors.verdicts) {
      const e = row.event as VectorEvent
      const event = { ...e, content: contentOf(e) }
      expect(verifyAvatar(event), row.name).toEqual(row.verdict)
      // What every avatar is drawn by: nothing the spec refuses, and nothing for the default avatar.
      if (!row.verdict.ok) expect(avatarShard(event), row.name).toBeNull()
    }
  })

  it('refuses a content over the limit, as a reader and before signing', () => {
    for (const row of vectors.content_limit) {
      const content = row.bytes === 0 ? '' : `{"vertices":[],"p":"${'a'.repeat(row.bytes - '{"vertices":[],"p":""}'.length)}"}`
      expect(avatarSize(content).bytes, String(row.bytes)).toBe(row.bytes)
      expect(avatarSize(content).over, String(row.bytes)).toBe(row.refused)
      if (row.bytes > 0) expect(verifyAvatar({ kind: AVATAR_KIND, content }).reason === 'too-large', String(row.bytes)).toBe(row.refused)
    }
  })

  it('refuses the study avatars over the limit and keeps the rest', () => {
    const operative = vectors.corpus.find((r) => r.name === 'operative-v3')!
    expect(operative.refused).toBe(false)
    for (const row of vectors.corpus) expect(avatarSize('x'.repeat(row.bytes)).over, row.name).toBe(row.refused)
  })
})
