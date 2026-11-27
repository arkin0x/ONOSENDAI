/**
 * blueprint.worker.ts - makes a blueprint's key off the page (PBKDF2-SHA256,
 * 500,000 rounds, lib/blueprint/format.ts deriveKey), so a smash's shatter
 * never stutters while it runs. Holds no state.
 */

import { deriveKey, lookupOf } from '../lib/blueprint/format'

export interface KeyRequest { id: number; encoding: Uint8Array; rounds?: number }
export type KeyAnswer = { id: number; key: Uint8Array; lookup: string } | { id: number; error: string }

self.onmessage = async (event: MessageEvent<KeyRequest>) => {
  const { id, encoding, rounds } = event.data
  try {
    const key = await deriveKey(encoding, rounds)
    const lookup = await lookupOf(key)
    ;(self as unknown as Worker).postMessage({ id, key, lookup } satisfies KeyAnswer)
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ id, error: String((e as Error)?.message ?? e) } satisfies KeyAnswer)
  }
}
