/**
 * placeSpawn.ts - for tests: give the store a signed spawn to build on.
 *
 * The page no longer signs a spawn on load (arkinox, 2026-10-01): an identity
 * with nothing saved starts provisional, at its spawn coordinate with no
 * events, and its first move signs the spawn. Tests that are about what
 * happens on a chain need the chain, so this signs one the way a respawn
 * does, with the self-check already answered "none" so it is not held, and
 * puts the respawn counter back since nothing here was a respawn.
 */

import { useCyberspace } from '../useCyberspace'

export async function placeSpawn(): Promise<void> {
  const s = useCyberspace.getState()
  if (s.events.length > 0) return
  const respawns = s.respawns
  useCyberspace.setState({ selfCheck: { pubkey: s.identity.pubkey, status: 'none' } })
  await s.respawn()
  useCyberspace.setState({ respawns })
  try { localStorage.removeItem('onosendai:respawns') } catch { /* no storage stand-in */ }
}
