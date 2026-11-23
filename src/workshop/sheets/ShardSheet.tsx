/**
 * ShardSheet.tsx - SHARD, a top-level area with its own sheet (workshop
 * redesign, phase 1; arkinox, 2026-10-23): the open shard itself, its name,
 * the Shard Feed, its counts, how it draws, and whether it walls or bounces a
 * walker. Moved from the old panel unchanged.
 */

import { useEffect, useMemo, useState } from 'react'
import { MODES, toPayload, type ShardMode } from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { ConfirmModal } from '../../hud/ConfirmModal'
import { cameSealed, carriesSealedParts } from '../../lib/carried'
import { STATE_HELP, STATE_LABEL, STATE_TAG, publishState, shardFingerprint } from '../../lib/published'
import { shardForm } from '../../lib/partForm'
import { PartFormBadge } from '../PartFormBadge'
import { bounceChip } from '../../lib/walkBounce'
import { CONSTRAINS, CONSTRAIN_TIPS, authoredConstrainOf, withAuthoredConstrain } from '../../lib/walkConstrain'
import { useCyberspace } from '../../store/useCyberspace'
import { usePublished } from '../../store/usePublished'
import { useWorkshop } from '../../store/useWorkshop'
import { BounceChip, BounceRow, OpacityRow } from '../shardRows'
import { PointGlowRows } from '../glowRows'
import { FullnessBar } from '../FullnessBar'
import { placedApart } from '../../lib/shardFullness'

export function ShardBody(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const me = useCyberspace((s) => s.identity.pubkey)
  // PUBLISH (store/usePublished.ts): where this shard stands with the Shard
  // Feed, which the bench cannot show, since a published object and one that
  // never left the browser look the same. RETRACT asks first, so the asking
  // is state here; the yes goes to the store.
  const ledger = usePublished((s) => s.ledger)
  const publishing = usePublished((s) => s.publishing)
  const retracting = usePublished((s) => s.retracting)
  // The object RETRACT was asked about, by id, never a bare yes: the
  // confirmation shows only while that same object is on the bench in the
  // open sheet, and is dropped the moment either changes, so it can never
  // come back over a different object (review of snocrash #36, 2026-10-15).
  const [retractAsk, setRetractAsk] = useState<string | null>(null)
  // Parts that came to you sealed go public only if you say so (DECK-0003 §1.10; lib/carried.ts).
  const [publishAsk, setPublishAsk] = useState<string | null>(null)
  useEffect(() => { setRetractAsk(null) }, [shard?.id])
  // Each is the whole object written out and measured or hashed: a cost on
  // every paint of a big shard (a Basilica nave's payload is hundreds of KB),
  // paid only while this sheet is open, the one place that shows them.
  const pubState = useMemo(
    () => publishState(shard ? ledger[shard.id] : undefined, shard ? shardFingerprint(shard) : '', me),
    [shard, ledger, me],
  )
  const wireBytes = useMemo(() => (shard ? new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(shard)))).length : 0), [shard])
  // Something to publish: its own vertices, or objects it places (DECK-0003 §1.9 rule 13).
  const hasContent = shard !== null && (shard.vertices.length > 0 || (shard.parts?.length ?? 0) > 0)
  // A shard that came to you sealed (TAKE, a split build's piece among them) goes public only if you say so.
  const [sealedAsk, setSealedAsk] = useState<string | null>(null)
  const w = useWorkshop.getState
  if (!shard) return null
  return (
    <>
      <input className="workshop__name" value={shard.name} onChange={(e) => w().rename(shard.id, e.target.value)} aria-label="Object name" spellCheck={false} />
      {/* PUBLISH: this shard as a public kind 33331 object, listed by the
          Shard Feed and read by other apps (DECK-0003 §3.1), the way
          snocrash.art publishes one (arkinox, 2026-10-10: "I want to make
          steps, rivers, walls, and other pieces that should show up in the
          shard feed instantly"). Hiding seals a copy at a place; this puts
          the object itself on your relays for anyone to place. The tag is
          the ledger's word (lib/published.ts), since no relay keeps one. */}
      <div className="workshop__avatar" role="group" aria-label="Publishing">
        <div className="workshop__row">
          <span className="workshop__label">SHARD FEED</span>
          <span className={`tag ${STATE_TAG[pubState]}`} title={STATE_HELP[pubState]}>{STATE_LABEL[pubState]}</span>
          {/* What it is when another shard places it: the bench's corner mark, the same component (lib/partForm.ts). */}
          <PartFormBadge form={shardForm(shard, ledger, me)} size="inline" />
          <span className="workshop__gap" />
        </div>
        <div className="workshop__list-row">
          <button
            className="workshop__btn workshop__btn--warn"
            disabled={!hasContent || publishing || retracting || !me}
            onClick={() => { if (carriesSealedParts(shard)) setPublishAsk(shard.id); else if (cameSealed(shard)) setSealedAsk(shard.id); else void usePublished.getState().publish(shard) }}
            title={!hasContent
              ? 'Nothing to publish yet: add points, or place objects'
              : pubState === 'other-key'
                ? STATE_HELP['other-key']
                : 'Publish this shard as a public object on your relays: the Shard Feed lists it and anyone can place it. PUBLISH AGAIN replaces it in place, same address.'}
          >{publishing ? 'PUBLISHING' : pubState === 'published' || pubState === 'edited' ? 'PUBLISH AGAIN' : 'PUBLISH'}</button>
          {(pubState === 'published' || pubState === 'edited') && (
            <button
              className="workshop__btn workshop__btn--danger"
              disabled={publishing || retracting}
              onClick={() => setRetractAsk(shard.id)}
              title="Ask your relays to drop the published object (NIP-09). Copies others made stay theirs. The shard stays here."
            >{retracting ? 'RETRACTING' : 'RETRACT'}</button>
          )}
        </div>
        <span className="workshop__work">{wireBytes.toLocaleString('en-US')} BYTES ON THE WIRE · {shard.vertices.length} VERTICES + {shard.faces.length} FACES{shard.parts?.length ? ` + ${shard.parts.length} PLACED` : ''}</span>
        {/* How full it is against what one hide holds whole (lib/shardFullness.ts; owner, 2026-11-23). */}
        <FullnessBar payload={wireBytes} apart={placedApart(shard)} />
      </div>
      {publishAsk === shard.id && (
        <ConfirmModal
          title={`Publish "${shard.name}"?`}
          body={<>It carries parts that came to you sealed. Published with it, anyone can read them.</>}
          confirmLabel="PUBLISH THEM TOO"
          cancelLabel="LEAVE THEM OUT"
          danger={false}
          onBackdrop={() => setPublishAsk(null)}
          onConfirm={() => { setPublishAsk(null); void usePublished.getState().publish(shard, true) }}
          onCancel={() => { setPublishAsk(null); void usePublished.getState().publish(shard) }}
        />
      )}
      {sealedAsk === shard.id && (
        <ConfirmModal
          title={`Publish "${shard.name}"?`}
          body={<>It came to you sealed in a bag or a chest. Published, anyone can read it.</>}
          confirmLabel="PUBLISH IT"
          cancelLabel="KEEP IT PRIVATE"
          danger={false}
          onBackdrop={() => setSealedAsk(null)}
          onConfirm={() => { setSealedAsk(null); void usePublished.getState().publish(shard) }}
          onCancel={() => setSealedAsk(null)}
        />
      )}
      {retractAsk === shard.id && (
        <ConfirmModal
          title={`Retract "${shard.name}"?`}
          body={<>A deletion goes to your relays, naming the object&apos;s address (NIP-09). Relays that honor it drop the object and the Shard Feed stops listing it; a relay that does not may keep handing it out. Copies and LIVE LINKs others placed stay theirs. The shard stays in your workshop, and PUBLISH puts it back.</>}
          confirmLabel="RETRACT"
          busy={retracting}
          onConfirm={() => { void usePublished.getState().retract(shard).then(() => setRetractAsk(null)) }}
          onCancel={() => setRetractAsk(null)}
        />
      )}
      <div className="ws__stats">
        {shard.vertices.length} vertices · {shard.faces.length} faces · unit 2^{shard.unit} = {formatCellSize(shard.unit)}
        {bounceChip(shard) && <> · <BounceChip shard={shard} /></>}
        {shard.mode !== 'solid' && shard.faces.length > 0 && <> · faces draw in SOLID</>}
        {shard.facecolors && <> · <button className="workshop__link" onClick={() => w().clearFaceColors()} title="Give every face back to its corners, so colors blend across them again">{shard.facecolors.length} face colors, clear</button></>}
      </div>
      <div className="workshop__row">
        <span className="workshop__label">DRAW</span>
        <div className="workshop__modes" role="group" aria-label="Render mode">
          {MODES.map((m: ShardMode) => (
            <button key={m} className={`workshop__mode ${shard.mode === m ? 'is-on' : ''}`} aria-pressed={shard.mode === m} onClick={() => w().setMode(m)}>{m.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {/* How solid the object draws (DECK-0003 §1.11): a slider with a
          number to type, as the hyperspace rail has (arkinox, 2026-10-23);
          100 is solid and writes nothing. */}
      <OpacityRow />
      {/* How its points draw (DECK-0003 §1.15 and §1.16): POINT SIZE, GLOW,
          RADIUS and GLOW STRENGTH, greyed but in place outside POINTS
          (owner, 2026-11-15). */}
      <PointGlowRows />
      {/* Whether a walker can cross it in WALK (DECK-0003 §1.12): three
          buttons like DRAW's. A shard that never chose shows OPAQUE,
          which is what it publishes as (arkinox, 2026-10-23). */}
      <div className="workshop__row">
        <span className="workshop__label">CONSTRAIN MOVEMENT IN WALK MODE</span>
        <div className="workshop__modes" role="group" aria-label="Constrain movement in WALK mode">
          {CONSTRAINS.map((c) => (
            <button key={c} className={`workshop__mode ${authoredConstrainOf(shard) === c ? 'is-on' : ''}`} aria-pressed={authoredConstrainOf(shard) === c} title={CONSTRAIN_TIPS[c]} onClick={() => w().setConstrain(c)}>{c.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {/* Whether walkers with GRAVITY on bounce off its top (lib/walkBounce.ts),
          beside CONSTRAIN, its closest sibling (arkinox, 2026-11-10). */}
      <BounceRow />
    </>
  )
}
