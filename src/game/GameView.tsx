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
 * sides go the way the camera faces, snapped to the nearest axis. In a game
 * with gravity JUMP jumps (twice in the air for the double jump) and a tick
 * on every frame carries the fall; in one without, UP and DOWN go along Y.
 * TAKE and OPEN show by the key and the door, and are always a tap. In a
 * world whose gate is a DECK-0004 door (lib/games/keyDoor.ts), the key item is
 * drawn as the model it wears once its bag is opened, until it is in ITEMS,
 * and the door wears its own looks, closed and open. The clock
 * runs on the bar from the entry; the exit zone stops it and shows the exit
 * card. Drag to look around.
 *
 * Keys: W A S D or the arrows (held, a press every 110 ms, as WALK's hold),
 * Space to jump (or up), E or Enter for TAKE and OPEN, Shift, Q or C down.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyRound } from 'lucide-react'
import { BoxGeometry, EdgesGeometry, Vector3, type Group } from 'three'
import { holdsDoorKey, offerFor, useGame, type GameSession } from '../store/useGame'
import { useInventory } from '../store/useInventory'
import { ModelInMotion } from '../scene/ItemModel'
import { loadItemModel, modelFromPayload, type LoadedModel } from '../hooks/useItemModel'
import { animationOf, modelOf, type ItemModelRef } from '../lib/itemModel'
import { keyItemHeld, sceneNow } from '../lib/games/keyDoor'
import { newestAt } from '../lib/games/source'
import type { Hidden } from '../lib/hidden'
import type { HeldItem } from '../lib/inventory'
import type { Box } from '../lib/clip'
import { placeShard } from '../scene/WorldShards'
import { ShardMesh } from '../scene/ShardMesh'
import { itemCentre, type AxisName, type Position, type ViewAxes } from '../lib/space'
import { BG, GAME } from '../lib/palette'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import type { GameDef } from '../lib/games/types'
import type { WorldShard } from '../lib/games/play'
import { clockMs, formatClearTime, keyTaken, type Progress } from '../lib/games/progress'

/** A held direction key presses at once and then every this many ms: WALK's hold (store/walkHold.ts WALK_HOLD_MS). */
const HOLD_MS = 110

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

/**
 * A pad's mark: a ring breathing over it, so the one thing cyberspace does not
 * have is seen. A pad with a `beacon` also gets a column of light that tall,
 * rising from where you stand on it, drawn through the fog so it is seen from
 * anywhere (the tutorial dungeon's way back for a player who fell out).
 */
function PadMark({ at, beacon }: { at: [number, number, number]; beacon?: number }): JSX.Element {
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
      {beacon !== undefined && beacon > 0 && (
        <mesh position={[0, 0.5 + beacon / 2, 0]}>
          <cylinderGeometry args={[0.3, 0.3, beacon, 16, 1, true]} />
          <meshBasicMaterial color={GAME} transparent opacity={0.45} fog={false} depthWrite={false} />
        </mesh>
      )}
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

/** The key's mark: a slow gold ring round it while it lies there, so it is seen from below. */
function KeyMark({ at }: { at: [number, number, number] }): JSX.Element {
  const ring = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const t = clock.elapsedTime
    ring.current.position.y = 1 + 0.2 * Math.sin(t * 2.4)
    ring.current.rotation.y = t * 1.2
  })
  return (
    <group position={at}>
      <group ref={ring}>
        <mesh><torusGeometry args={[1.1, 0.06, 8, 40]} /><meshBasicMaterial color="#ffd23f" /></mesh>
      </group>
    </group>
  )
}

/**
 * The model a key item wears (DECK-0004 §2.5), from where the game's world
 * comes from: the relays for a live game (hooks/useItemModel, the app's one
 * cache), the bundled fixture for the DEV game. Null when it wears none or it
 * cannot be had: the item is then drawn as a plain gold block.
 */
async function gameModel(game: GameDef, ref: ItemModelRef): Promise<LoadedModel | null> {
  if (game.world.kind !== 'fixture') return loadItemModel(ref)
  const ev = newestAt(await game.world.load(), ref.address)
  if (!ev || ev.tags.some((t) => t[0] === 'encrypted')) return null
  try { return await modelFromPayload(ref.address, JSON.parse(ev.content)) } catch { return null }
}

/** A key item lying in the world: the model it wears, in its motion, its centre on its point (DECK-0004 §2.5). */
function KeyItemMark({ game, item }: { game: GameDef; item: Hidden }): JSX.Element {
  const ref = useMemo(() => modelOf(item.inner?.tags ?? []), [item])
  const animation = useMemo(() => animationOf(item.inner?.tags ?? []), [item])
  const [model, setModel] = useState<LoadedModel | null>(null)
  useEffect(() => {
    if (!ref) return
    let live = true
    void gameModel(game, ref).then((m) => { if (live) setModel(m) })
    return () => { live = false }
  }, [game, ref])
  const box = useMemo<Box>(() => ({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }), [])
  const scale = model ? 2 ** model.shard.unit : 1
  return (
    <group position={centreOf(game, item.at)}>
      {model
        ? <group scale={scale}><ModelInMotion model={model} animation={animation} id={item.eventId} box={box} amplitude={0.08} lit outline={false} /></group>
        : <mesh><boxGeometry args={[0.5, 0.5, 0.5]} /><meshBasicMaterial color="#ffd23f" /></mesh>}
    </group>
  )
}

function GameCanvas({ session, at, look, items }: { session: GameSession; at: Position; look: React.MutableRefObject<Look>; items: Record<string, HeldItem> }): JSX.Element {
  const { game, world, door, room, keys, progress } = session
  const me = centreOf(game, at)
  const pads = useMemo(() => game.pads.map((p) => ({ at: centreOf(game, p.at), beacon: p.beacon })), [game])
  const taken = keyTaken(progress)
  // What stands as the door stands: its closed or open look and its room (lib/games/keyDoor.ts), or the LEGACY key and gate.
  const drawn = useMemo(() => (world ? sceneNow(game, { shards: world, door, room }, progress).drawn : null), [game, world, door, room, taken, progress.doorOpen])
  // A real key item, once its bag is open, until it is in ITEMS.
  const lying = useMemo(() => keys.filter((k) => !keyItemHeld(items, k)), [keys, items])
  // The ring marks where the key lies, seen from below, until it is held (or, LEGACY, taken).
  const ring = door ? (game.keyBag && !holdsDoorKey(session, items) && !progress.doorOpen ? game.keyBag.at : null) : game.key && !taken ? game.key.at : null
  return (
    <Canvas camera={{ fov: 70, near: 0.05, far: 400, position: [me[0], me[1], me[2] + CAMERA_DISTANCE] }} dpr={[1, 2]} gl={{ antialias: true }} style={{ background: BG }}>
      <fog attach="fog" args={[BG, 6, 60]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[10, 18, 6]} intensity={1.1} />
      <pointLight position={me} intensity={6} distance={12} decay={1.6} color="#ffe2f4" />
      <Rig target={me} look={look} />
      {drawn && <Shards game={game} world={drawn} />}
      {pads.map((p, i) => <PadMark key={i} at={p.at} beacon={p.beacon} />)}
      {ring && <KeyMark at={centreOf(game, ring)} />}
      {lying.map((k) => <KeyItemMark key={k.eventId} game={game} item={k} />)}
      <Player at={me} />
    </Canvas>
  )
}

type Press = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'jump'

function PadButton({ press, label, onPress }: { press: Press; label: ReactNode; onPress: (p: Press) => void }): JSX.Element {
  const repeat = useRepeatable()
  return <button className={`gamepad__btn gamepad__btn--${press}`} aria-label={press} {...repeat(() => onPress(press))}>{label}</button>
}

/** The clock on the bar: running from the entry, stopped at the clear time. */
function Clock({ progress }: { progress: Progress }): JSX.Element {
  const [, redraw] = useState(0)
  useEffect(() => {
    if (progress.clearedMs !== null) return
    const t = window.setInterval(() => redraw((n) => n + 1), 100)
    return () => clearInterval(t)
  }, [progress.clearedMs])
  return <span className="gameview__clock" aria-label="time">{formatClearTime(clockMs(progress, Date.now()))}</span>
}

export function GameView(): JSX.Element | null {
  const entryId = useGame((s) => s.session?.entryId ?? null)
  // One component per session, so its look and its notes start fresh each time (review of #660).
  return entryId ? <GameScreen key={entryId} /> : null
}

function GameScreen(): JSX.Element | null {
  const session = useGame((s) => s.session)
  const busy = useGame((s) => s.busy)
  // ITEMS: a real key item is held once it is there (TAKE), and opens the door from there.
  const items = useInventory((s) => s.items)
  const message = useGame((s) => s.message)
  // Facing into cyberspace -Z at first: the tutorial dungeon's hall runs that way from its entry point.
  const look = useRef<Look>({ yaw: Math.PI, pitch: 0.35 })
  const [exitFailed, setExitFailed] = useState(false)

  const gravity = session?.game.gravity === true
  const onPress = (p: Press): void => {
    const g = useGame.getState()
    if (p === 'jump') g.jump()
    else if (p === 'up') { if (g.session?.game.gravity) g.jump(); else g.step('y', 1) }
    else if (p === 'down') g.step('y', -1)
    else { const s = stepFor(look.current.yaw, p); g.step(s.axis, s.dir) }
  }
  /** TAKE or OPEN, whichever is offered where you stand. */
  const act = (): void => {
    const g = useGame.getState()
    const s = g.session
    if (!s?.at) return
    const offer = offerFor(s)
    if (offer === 'take') g.take()
    else if (offer === 'open') g.open()
  }

  // Under gravity, the fall and the jump move on every frame (lib/games/gravity.ts tick).
  useEffect(() => {
    if (!gravity) return
    let raf = 0
    const frame = (): void => { useGame.getState().tick(); raf = requestAnimationFrame(frame) }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [gravity])

  // The game's keys, only while the game is on screen (the cyberspace keys stand down: hooks/useKeyboard.ts).
  useEffect(() => {
    if (!session) return
    const dirs: Record<string, Press> = {
      KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'down', ShiftRight: 'down', KeyQ: 'down', KeyC: 'down',
    }
    // A held direction: a press at once, then every HOLD_MS, whatever the keyboard's own repeat does (WALK's hold).
    const held = new Map<string, number>()
    const release = (code: string): void => { const t = held.get(code); if (t !== undefined) { clearInterval(t); held.delete(code) } }
    const releaseAll = (): void => { for (const code of [...held.keys()]) release(code) }
    const down = (e: KeyboardEvent): void => {
      // macOS sends no keyup for a key let go while Cmd is down: Cmd ends every hold, as WALK's hold does (store/walkHold.ts).
      if (e.key === 'Meta') { releaseAll(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
      // Enter on a focused button presses that button (EXIT GAME among them), never TAKE or OPEN (review of #668).
      if (e.code === 'Enter' && target?.closest?.('button')) return
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) onPress('up'); return }
      if (e.code === 'KeyE' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) act(); return }
      const p = dirs[e.code]
      if (!p) return
      e.preventDefault()
      if (e.repeat || held.has(e.code)) return
      onPress(p)
      held.set(e.code, window.setInterval(() => onPress(p), HOLD_MS))
    }
    // A focused button presses on Space's keyup: JUMP must never press EXIT GAME (review of #660).
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Meta') { releaseAll(); return }
      release(e.code)
      if (e.code === 'Space') e.preventDefault()
    }
    const hidden = (): void => { if (document.visibilityState === 'hidden') releaseAll() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      releaseAll()
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [session !== null])

  // Drag to look: yaw with the horizontal, pitch with the vertical, kept above the floor and below straight down.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null)
  if (!session) return null
  const { game, world, worldError, at, progress } = session
  const offer = offerFor(session, items)
  const cleared = progress.clearedMs !== null

  const leave = async (): Promise<void> => {
    const refused = await useGame.getState().exit()
    setExitFailed(refused !== null)
  }

  const status = busy === 'entering' ? 'ENTERING' : busy === 'teleporting' ? 'TELEPORTING' : busy === 'exiting' ? 'LEAVING' : world === null && !worldError ? 'LOADING THE WORLD' : null

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
        {/* You appear at the entry point once the world says where it is (DECK-0002 §2.2). */}
        {at && <GameCanvas session={session} at={at} look={look} items={items} />}
      </div>
      <div className="gameview__bar">
        <span className="gameview__name">{game.name}</span>
        {game.exit && <Clock progress={progress} />}
        {holdsDoorKey(session, items) && !progress.doorOpen && <span className="gameview__key" aria-label="You have the key"><KeyRound size={14} strokeWidth={2.5} aria-hidden /></span>}
        {status && <span className="gameview__status">{status}</span>}
        {/* Leaving is offered at every moment of play (DECK-0002 §2.3): only an exit already on its way holds it. */}
        <button className="gameview__exit" disabled={busy === 'exiting'} onClick={(e) => { e.currentTarget.blur(); void leave() }}>EXIT GAME</button>
      </div>
      {(message || worldError) && (
        <p className="gameview__note" role="status">
          {message ?? worldError}
          {exitFailed && message && <button className="tag tag--tap" onClick={() => { setExitFailed(false); useGame.getState().hide() }}>BACK TO CYBERSPACE</button>}
        </p>
      )}
      {offer && (
        <div className="gameview__act">
          {offer === 'locked'
            ? <span className="gameview__locked" role="status">LOCKED</span>
            : <button className="gameview__actbtn" disabled={busy !== null} onClick={(e) => { e.currentTarget.blur(); act() }}>{offer === 'take' ? 'TAKE' : 'OPEN'}</button>}
        </div>
      )}
      {cleared && (
        <div className="gameview__card" role="dialog" aria-label="Dungeon clear">
          <span className="gameview__cardtitle">CLEAR</span>
          <span className="gameview__cardtime">{formatClearTime(progress.clearedMs!)}</span>
          <button className="gameview__exit gameview__exit--card" disabled={busy === 'exiting'} onClick={(e) => { e.currentTarget.blur(); void leave() }}>EXIT GAME</button>
        </div>
      )}
      <div className="gamepad" aria-label="game controls" hidden={cleared}>
        <div className="gamepad__dirs">
          <PadButton press="forward" label="▲" onPress={onPress} />
          <PadButton press="left" label="◀" onPress={onPress} />
          <PadButton press="right" label="▶" onPress={onPress} />
          <PadButton press="back" label="▼" onPress={onPress} />
        </div>
        {game.gravity
          ? <div className="gamepad__lift"><button className="gamepad__btn gamepad__btn--jump" aria-label="jump" {...noCallout} onPointerDown={(e) => { e.preventDefault(); onPress('jump') }}>JUMP</button></div>
          : (
            <div className="gamepad__lift">
              <PadButton press="up" label="UP" onPress={onPress} />
              <PadButton press="down" label="DOWN" onPress={onPress} />
            </div>
          )}
      </div>
    </div>
  )
}
