/**
 * partForms.ts: the LINK or COPY of every object the shard on the bench places
 * (lib/partForm.ts), read from the workshop, the publish ledger and who you
 * are; what workshop/PartBadges draws.
 */

import { useMemo } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { partForm, type PartForm } from '../lib/partForm'
import { useCyberspace } from '../store/useCyberspace'
import { usePublished } from '../store/usePublished'
import { useWorkshop } from '../store/useWorkshop'

/** The form of the placement by each of `shard`'s refs, by ref index. */
export function usePartForms(shard: ShardModel | null): (refIndex: number) => PartForm {
  const library = useWorkshop((s) => s.shards)
  const ledger = usePublished((s) => s.ledger)
  const me = useCyberspace((s) => s.identity.pubkey)
  return useMemo(() => {
    const byId = new Map(library.map((s) => [s.id, s]))
    return (i: number) => partForm(shard?.refs?.[i], shard ?? {}, me, (id) => byId.get(id), ledger)
  }, [shard, library, ledger, me])
}
