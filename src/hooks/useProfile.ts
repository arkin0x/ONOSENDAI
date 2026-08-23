/**
 * useProfile.ts — a pubkey's profile, requested and reactive.
 *
 * Reads from the shared profile cache and asks it to fetch on first sight.
 * Returns undefined while unknown, null when fetched-but-none, or the profile.
 */

import { useEffect } from 'react'
import { useProfiles, type Profile } from '../store/useProfiles'

export function useProfile(pubkey: string | null | undefined): Profile | null | undefined {
  const profile = useProfiles((s) => (pubkey ? s.profiles[pubkey] : undefined))
  useEffect(() => { if (pubkey) useProfiles.getState().request(pubkey) }, [pubkey])
  return profile
}
