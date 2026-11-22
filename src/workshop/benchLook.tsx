/**
 * benchLook.tsx - the shard on the bench, and how LOOK shows it as the world
 * does.
 *
 * arkinox, 2026-11-15: "workshop: the vertices are very large. in the LOOK
 * tool only we should make the vertices and faces look exactly like they
 * would in cyberspace."
 *
 * Every editing tool (STAMP, SELECT, PAINT, ADD, FACE) draws the shard lit by
 * the bench's lights (ShardMesh `lit`, scene/shardLight.tsx) with a large
 * handle on every point, so a finger can find it. LOOK draws the same
 * ShardMesh the world draws, with the world's own switches: `world` (faces
 * unlit at their own colours, tagged so the bloom is blind to them) and its
 * headlamp (scene/headlamp.ts), the world's discs for the vertices, the
 * world's modes, opacity and motion, under the world's own bloom
 * (benchBloom.tsx). Nothing is imitated, so the two cannot drift apart. What
 * differs is only the canvas's units, and that is put right here:
 *
 * - The discs are sized in the camera's units (scene/dotScale.ts). The world
 *   draws a shard at 2^(unit - zoom) render cells per model unit; the bench
 *   draws one bench unit per model unit. LOOK gives the discs in model units
 *   at the zoom you are at in the world, so the shard at the same size on
 *   screen carries the same dots in both.
 * - The headlamp's reach and the lines' near fade are in render cells too
 *   (scene/headlamp.ts, scene/nearFade.ts). LOOK writes them in bench units
 *   (BenchLookRig) while it is up, and puts back what it found when it goes
 *   (the reach, the fade and its switch), so the world's canvas, paused
 *   under the workshop (scene/frameDriver.tsx), comes back to its own
 *   numbers even before its HeadlampRig writes them again.
 *
 * In LOOK the editing marks go: the handles and their halos, the selected
 * faces' fill, the corners being joined, a placed object's selection box,
 * the move handles, the motion path marks and the held bar. What is held
 * stays held, so the next editing tool shows it again, and LOOK's keys leave
 * it alone (Bench Keys): a true preview, with nothing to move by accident.
 */

import { useLayoutEffect } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { Vector3 } from 'three'
import { ShardMesh } from '../scene/ShardMesh'
import { DotScale, cellsPerUnit } from '../scene/dotScale'
import { headlampUniforms } from '../scene/headlamp'
import { LINE_FADE_FROM, LINE_FADE_TO, lineFade } from '../scene/nearFade'
import { useCyberspace } from '../store/useCyberspace'
import { useAnimPreview } from '../store/animPreview'
import { useWorkshop } from '../store/useWorkshop'
import { benchReach, benchShardLook, isLook, lookDotScale } from './lookTool'

/**
 * The shard on the bench, drawn in the current tool's look. One ShardMesh in
 * every tool, so switching tools swaps its materials, never the mesh or the
 * camera.
 */
export function BenchShard({ onFace, onPart }: {
  onFace: (e: ThreeEvent<MouseEvent>, face: number) => void
  onPart: (e: ThreeEvent<MouseEvent>, part: number) => void
}): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
  const selectKind = useWorkshop((s) => s.selectKind)
  const partSel = useWorkshop((s) => s.partSel)
  // The motion editor's preview draws the motion whatever the tool (store/animPreview.ts).
  const previewing = useAnimPreview((s) => s.on)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  if (!shard) return null
  const look = isLook(tool)
  return (
    <DotScale.Provider value={look ? lookDotScale(shard.unit, scaleExp) : 1}>
      <ShardMesh
        shard={shard}
        {...benchShardLook(look)}
        still={!look && !previewing}
        onFaceClick={tool === 'paint' || (tool === 'select' && selectKind === 'faces') ? onFace : undefined}
        onPartClick={tool === 'select' || tool === 'face' || tool === 'paint' || tool === 'view' ? onPart : undefined}
        selectedParts={look ? undefined : partSel}
      />
    </DotScale.Provider>
  )
}

/**
 * While LOOK is up: the world's headlamp reach and line fade, in bench units
 * (see the top of this file). Mounted only in LOOK.
 */
export function BenchLookRig(): null {
  const shard = useWorkshop((s) => s.current())
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const k = cellsPerUnit(shard?.unit ?? 0, scaleExp)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3 } | null
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    lineFade.range.value.set(LINE_FADE_FROM / k, LINE_FADE_TO / k)
    invalidate()
  }, [k, invalidate])
  // The world's own numbers back when LOOK goes: what was there when it came, read before
  // the frame callback below first writes. Things in the world that read them on the CPU
  // (ItemModel, ItemVanish, SpawnMarker) run ahead of the world's HeadlampRig.
  useLayoutEffect(() => {
    const reach = headlampUniforms.uHeadlampReach.value
    const on = lineFade.on.value
    return () => {
      headlampUniforms.uHeadlampReach.value = reach
      lineFade.on.value = on
      lineFade.range.value.set(LINE_FADE_FROM, LINE_FADE_TO)
    }
  }, [])
  useFrame((state) => {
    // An orbiting camera, as the world's is outside WALK: the near fade on.
    lineFade.on.value = 1
    if (!controls) return
    headlampUniforms.uHeadlampReach.value = benchReach(state.camera.position.distanceTo(controls.target), k)
  })
  return null
}
