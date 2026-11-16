/**
 * eyeV1.ts - a version 1 payload's eye, turned into the version 2 frame.
 *
 * An eye (lib/avatarEye.ts) is in its payload's own frame, as the vertices
 * are. A version 1 payload's Z points the other way (DECK-0003 §2), and its
 * vertices are read with it negated; its eye is put into the version 2 frame
 * here, the one every other reader and writer of `extra` assumes, so a copy
 * written back out as version 2 keeps its eye where it was.
 *
 * Shared by every reader of a payload into a model: a worn avatar
 * (lib/avatar avatarFromEvent), the avatar kept on this device
 * (store/useAvatars loadMine) and PASTE or import (store/useWorkshop
 * shardFromText). Its own module, importing nothing, so lib/avatar and
 * lib/avatarEye (which reads lib/avatar) can both use it without a cycle.
 */

import type { ShardModel } from 'sno-core/shards'

/** The farthest an eye coordinate may be, in ticks (avatarEye EYE_REACH): 64 units. */
const REACH = 7680

/** `shard` with its eye in the version 2 frame when `raw`, the payload it was read from, is version 1; else `shard` itself. */
export function v1Eye<T extends Pick<ShardModel, 'extra'>>(shard: T, raw: unknown): T {
  const eye = shard.extra?.eye
  if ((raw as { v?: unknown } | null)?.v !== 1 || !Array.isArray(eye) || eye.length !== 3 || !eye.every((c) => Number.isInteger(c) && Math.abs(c as number) <= REACH)) return shard
  return { ...shard, extra: { ...shard.extra, eye: [eye[0] + 0, eye[1] + 0, -eye[2] + 0] } }
}
