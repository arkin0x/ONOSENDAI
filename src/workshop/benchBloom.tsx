/**
 * benchBloom.tsx - the world's bloom on the bench, while LOOK is up
 * (benchLook.tsx).
 *
 * The world's own pass, not a copy of its numbers: WorldBloom
 * (scene/worldBloom.tsx: the bloom blind to the shard faces' tag, then the
 * tag made opaque for the canvas) in a composer set up as the world's is (a stencil for the tag,
 * colour-only resolves, the page's one sample count). The composer also draws as
 * the world does in ways a bare canvas does not: no tone curve, and the
 * frame encoded to the screen's colour space at the end, which is where the
 * vertex discs get their brightness out there.
 *
 * Cost: mounted only in LOOK, so the editing tools draw exactly as before
 * and keep no buffers for it. The bench draws on demand, so a still LOOK
 * costs nothing; an orbit or a moving shard pays the world's bloom for each
 * frame it draws. The composer and its passes are disposed when LOOK goes:
 * the wrapper (@react-three/postprocessing 2.16) disposes neither itself.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { EffectComposer } from '@react-three/postprocessing'
import type { EffectComposer as PostComposer } from 'postprocessing'
import { WorldBloom, resolveColourOnly } from '../scene/worldBloom'
import { COMPOSER_SAMPLES } from '../scene/composerBudget'

export function BenchBloom(): JSX.Element {
  const composer = useRef<PostComposer | null>(null)
  const hold = useCallback((c: PostComposer | null) => {
    resolveColourOnly(c)
    if (c) composer.current = c
  }, [])
  // Made once: the wrapper rebuilds its passes whenever its children are a new element (Scene.tsx).
  const bloom = useMemo(() => <WorldBloom />, [])
  useEffect(() => {
    // The passes as built (the wrapper adds them in its layout effect, before this
    // runs); on unmount it takes its effect passes off again without disposing them.
    // The bench's camera and scene never change, so the wrapper never builds again.
    const c = composer.current
    const passes = c ? [...c.passes] : []
    return () => {
      // Those it took off; the composer disposes what it still holds (its scene pass)
      // and its buffers. The Bloom effect is disposed twice (its pass, then R3F as it
      // unmounts the element), harmless in three: the first removes the listeners.
      // It also disposes postprocessing's one fullscreen triangle, shared with the
      // world's composer on the other canvas, which uploads it again on its next frame.
      if (c) for (const p of passes) if (!c.passes.includes(p)) p.dispose()
      c?.dispose()
      composer.current = null
    }
  }, [])
  return (
    <EffectComposer ref={hold} stencilBuffer multisampling={COMPOSER_SAMPLES}>
      {bloom}
    </EffectComposer>
  )
}
