/**
 * ItemModelPreview.tsx: the item composer's look at the model an item will
 * wear, moving as it will move in cyberspace, inside the blue box it will
 * get (ItemModel.tsx draws the same thing in the world).
 *
 * One small canvas, framed on the box from a three-quarter view a little
 * above, lit as on the bench (shardLight.tsx) so the faces read. Takes no
 * pointer events, as the avatar card's spin does (ShardSpin).
 */

import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Box } from '../lib/clip'
import type { ItemAnimation } from '../lib/itemModel'
import type { LoadedModel } from '../hooks/useItemModel'
import { keepPrograms } from '../lib/keepPrograms'
import { ShardLights } from './shardLight'
import { framedDistance } from './ThumbStage'
import { ModelInMotion, useItemBox } from './ItemModel'

/** The camera's field of view, in degrees, as for the feed's pictures. */
const FOV = 35

function Framed({ model, animation }: { model: LoadedModel; animation: readonly ItemAnimation[] }): JSX.Element {
  const camera = useThree((s) => s.camera)
  const size = useItemBox(model, animation)
  // The box in model units about the place: whole gibsons, 2^unit to a model unit.
  const box = useMemo<Box>(() => {
    const perUnit = 2 ** model.shard.unit
    const h = size.gibsons.map((g) => g / 2 / perUnit)
    return { min: [-h[0], -h[1], -h[2]], max: [h[0], h[1], h[2]] }
  }, [size, model.shard.unit])
  useEffect(() => {
    const reach = Math.hypot(box.max[0], box.max[1], box.max[2])
    const d = framedDistance(Math.max(reach, 1e-3), FOV)
    const n = Math.hypot(0.62, 0.42, 0.66)
    camera.position.set((d * 0.62) / n, (d * 0.42) / n, (d * 0.66) / n)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [box, camera])
  return <ModelInMotion model={model} animation={animation} id={model.shard.id} box={box} amplitude={size.amplitude} lit />
}

export function ItemModelPreview({ model, animation, size = 132 }: { model: LoadedModel; animation: readonly ItemAnimation[]; size?: number }): JSX.Element {
  return (
    <div className="itemmodel__preview" style={{ width: size, height: size }} role="img" aria-label={`${model.shard.name}, as the item shows it`}>
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: FOV, near: 0.001, far: 100000 }}
        style={{ width: size, height: size, pointerEvents: 'none' }}
        onCreated={({ gl, scene }) => keepPrograms(gl, scene)}
      >
        <ShardLights />
        <Framed model={model} animation={animation} />
      </Canvas>
    </div>
  )
}
