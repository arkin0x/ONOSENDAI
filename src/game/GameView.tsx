/**
 * GameView.tsx - in-game mode on screen (DECK-0002 §2.3).
 *
 * While you are in a game this client implements, the game's world is drawn
 * here, full screen over cyberspace, on a canvas of its own: the game's
 * shards where they stand in its region, your game position, and the pads.
 * Cyberspace is not drawn at all meanwhile (scene/frameDriver.tsx stops its
 * frames, as under the workshop), and it is exactly as you left it when you
 * come back: nothing here touches its view.
 *
 * Controls are the game's (DECK-0002 §8, game logic): forward, back and the
 * sides go the way the camera faces, snapped to the nearest axis; UP and DOWN
 * go along Y. There is no gravity in the dungeon. Drag to look around.
 *
 * Keys: W A S D or the arrows, Space or E up, Shift, Q or C down.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { BoxGeometry, EdgesGeometry, Vector3, type Group } from 'three'
import { useGame } from '../store/useGame'
import { placeShard } from '../scene/WorldShards'
import { ShardMesh } from '../scene/ShardMesh'
import { itemCentre, type AxisName, type Position, type ViewAxes } from '../lib/space'
import { BG, GAME } from '../lib/palette'
import { useRepeatable } from '../hooks/useRepeatable'
import type { GameDef } from '../lib/games/types'
import type { WorldShard } from '../lib/games/play'

/** The game's frame: cyberspace X right, Y up, Z into the screen (render Z flipped, as WorldShards draws). */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

/** How far behind you the camera sits, in gibsons: close, since a dungeon is built to be seen from inside. */
const CAMERA_DISTANCE = 3.2

/** Where the camera looks from: yaw about Y and pitch, in radians, shared by the canvas and the controls. */
interface Look { yaw: number; pitch: number }

function centreOf(game: GameDef, p: Position): [number, number, number] {
  return itemCentre(p, game.region.base, 0, AXES)
}

/** A screen direction, turned to the cyberspace axis nearest the way the camera faces. */
export function stepFor(yaw: number, press: 'forward' | 'back' | 'left' | 'right'): { axis: AxisName; dir: 1 | -1 } {
  // The camera looks along (-sin yaw, -cos yaw) in render X and Z; render Z is cyberspace -Z.
  const turn = { forward: 0, right: -Math.PI / 2, back: Math.PI, left: Math.PI / 2 }[press]
  const a = yaw + turn
  const rx = -Math.sin(a), rz = -Math.cos(a)
  if (Math.abs(rx) >= Math.abs(rz)) return { axis: 'x', dir: rx > 0 ? 1 : -1 }
  return { axis: 'z', dir: -rz > 0 ? 1 : -1 }
}

function Shards({ game, world }: { game: GameDef; world: WorldShard[] }): JSX.Element {
  const placed = useMemo(() => world.map((w) => placeShard({ key: w.key, at: w.at, height: w.height, plane: game.region.plane, shard: w.shard }, game.region.base, 0, AXES)), [game, world])
  return (
    <>
      {placed.map((p) => (
        <group key={p.key} position={p.centre}>
          <ShardMesh shard={p.shard} scale={p.scale} clip={p.clip} pose={p.pose} lit />
        </group>
      ))}
    </>
  )
}

const CUBE_EDGES = new EdgesGeometry(new BoxGeometry(0.8, 0.8, 0.8))

/** You, at your game position: drawn as nothing in cyberspace is, so play is never mistaken for travel (spec §8.11.7). */
function Player({ at }: { at: [number, number, number] }): JSX.Element {
  return (
    <group position={at}>
      <mesh><boxGeometry args={[0.6, 0.6, 0.6]} /><meshBasicMaterial color={GAME} transparent opacity={0.55} /></mesh>
      <lineSegments geometry={CUBE_EDGES}><lineBasicMaterial color={GAME} /></lineSegments>
    </group>
  )
}

/** A pad's mark: a ring breathing over it, so the one thing cyberspace does not have is seen. */
function PadMark({ at }: { at: [number, number, number] }): JSX.Element {
  const ring = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const t = clock.elapsedTime
    ring.current.position.y = 0.6 + 0.15 * Math.sin(t * 2)
    ring.current.rotation.y = t * 0.8
  })
  return (
    <group position={at}>
      <group ref={ring}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.9, 0.05, 8, 40]} /><meshBasicMaterial color={GAME} /></mesh>
      </group>
    </group>
  )
}

/** The camera, eased behind you at the look the drag set. */
function Rig({ target, look }: { target: [number, number, number]; look: React.MutableRefObject<Look> }): null {
  const { camera } = useThree()
  const eye = useRef(new Vector3(...target))
  const want = useMemo(() => new Vector3(), [])
  const focus = useRef(new Vector3(...target))
  useFrame((_, dt) => {
    const { yaw, pitch } = look.current
    const k = 1 - Math.exp(-dt * 10)
    focus.current.lerp(new Vector3(...target), k)
    want.set(
      focus.current.x + Math.sin(yaw) * Math.cos(pitch) * CAMERA_DISTANCE,
      focus.current.y + Math.sin(pitch) * CAMERA_DISTANCE,
      focus.current.z + Math.cos(yaw) * Math.cos(pitch) * CAMERA_DISTANCE,
    )
    eye.current.lerp(want, k)
    camera.position.copy(eye.current)
    camera.lookAt(focus.current)
  })
  return null
}

function GameCanvas({ game, world, at, look }: { game: GameDef; world: WorldShard[] | null; at: Position; look: React.MutableRefObject<Look> }): JSX.Element {
  const me = centreOf(game, at)
  const pads = useMemo(() => game.pads.map((p) => centreOf(game, p.at)), [game])
  return (
    <Canvas camera={{ fov: 70, near: 0.05, far: 400, position: [me[0], me[1], me[2] + CAMERA_DISTANCE] }} dpr={[1, 2]} gl={{ antialias: true }} style={{ background: BG }}>
      <fog attach="fog" args={[BG, 6, 60]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[10, 18, 6]} intensity={1.1} />
      <pointLight position={me} intensity={6} distance={12} decay={1.6} color="#ffe2f4" />
      <Rig target={me} look={look} />
      {world && <Shards game={game} world={world} />}
      {pads.map((p, i) => <PadMark key={i} at={p} />)}
      <Player at={me} />
    </Canvas>
  )
}

type Press = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down'

function PadButton({ press, label, onPress }: { press: Press; label: ReactNode; onPress: (p: Press) => void }): JSX.Element {
  const repeat = useRepeatable()
  return <button className={`gamepad__btn gamepad__btn--${press}`} aria-label={press} {...repeat(() => onPress(press))}>{label}</button>
}

export function GameView(): JSX.Element | null {
  const session = useGame((s) => s.session)
  const busy = useGame((s) => s.busy)
  const message = useGame((s) => s.message)
  // Facing into cyberspace -Z at first: the tutorial dungeon's hall runs that way from the start.
  const look = useRef<Look>({ yaw: Math.PI, pitch: 0.35 })
  const [exitFailed, setExitFailed] = useState(false)

  const onPress = (p: Press): void => {
    const g = useGame.getState()
    if (p === 'up') g.step('y', 1)
    else if (p === 'down') g.step('y', -1)
    else { const s = stepFor(look.current.yaw, p); g.step(s.axis, s.dir) }
  }

  // The game's keys, only while the game is on screen (the cyberspace keys stand down: hooks/useKeyboard.ts).
  useEffect(() => {
    if (!session) return
    const keys: Record<string, Press> = {
      KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      Space: 'up', KeyE: 'up', ShiftLeft: 'down', ShiftRight: 'down', KeyQ: 'down', KeyC: 'down',
    }
    const down = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const p = keys[e.code]
      if (!p) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      onPress(p)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [session !== null])

  // Drag to look: yaw with the horizontal, pitch with the vertical, kept above the floor and below straight down.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null)
  if (!session) return null
  const { game, world, worldError, at } = session

  const leave = async (): Promise<void> => {
    const refused = await useGame.getState().exit()
    setExitFailed(refused !== null)
  }

  const status = busy === 'entering' ? 'ENTERING' : busy === 'arriving' ? 'ARRIVING' : busy === 'teleporting' ? 'TELEPORTING' : busy === 'exiting' ? 'LEAVING' : world === null ? 'LOADING THE WORLD' : null

  return (
    <div className="gameview" role="application" aria-label={`${game.name}: in a game`}>
      <div
        className="gameview__canvas"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; (e.target as Element).setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          look.current.yaw -= (e.clientX - d.x) * 0.008
          look.current.pitch = Math.max(-0.6, Math.min(1.3, look.current.pitch + (e.clientY - d.y) * 0.006))
          drag.current = { ...d, x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
      >
        <GameCanvas game={game} world={world} at={at} look={look} />
      </div>
      <div className="gameview__bar">
        <span className="gameview__name">{game.name}</span>
        {status && <span className="gameview__status">{status}</span>}
        <button className="gameview__exit" disabled={busy !== null} onClick={() => { void leave() }}>EXIT GAME</button>
      </div>
      {(message || worldError) && (
        <p className="gameview__note" role="status">
          {message ?? worldError}
          {exitFailed && message && <button className="tag tag--tap" onClick={() => { setExitFailed(false); useGame.getState().hide() }}>BACK TO CYBERSPACE</button>}
        </p>
      )}
      <div className="gamepad" aria-label="game controls">
        <div className="gamepad__dirs">
          <PadButton press="forward" label="▲" onPress={onPress} />
          <PadButton press="left" label="◀" onPress={onPress} />
          <PadButton press="right" label="▶" onPress={onPress} />
          <PadButton press="back" label="▼" onPress={onPress} />
        </div>
        <div className="gamepad__lift">
          <PadButton press="up" label="UP" onPress={onPress} />
          <PadButton press="down" label="DOWN" onPress={onPress} />
        </div>
      </div>
    </div>
  )
}
