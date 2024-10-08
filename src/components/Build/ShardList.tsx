import { useEffect, useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import { CyberspaceShard, useBuilderStore } from '../../store/BuilderStore'
import COLORS from '../../data/Colors'
import { useFrame, useThree } from '@react-three/fiber'
import { ThreeEvent } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { shardStateDataTo3DData } from './Shards'
import { Shard } from '../Cyberspace/Shard'
import { Selector } from './Selector'
import { useShardMinerStore } from '../../store/ShardMinerStore'
import useNDKStore from '../../store/NDKStore'
import { useAvatarStore } from '../../store/AvatarStore'
import { extractCyberspaceActionState } from '../../libraries/Cyberspace'
import { Spinner } from '../Spinner'

interface ShardListProps {
  create?: boolean
  deploy?: boolean
}

function ShardList({create, deploy}: ShardListProps) {
  const { addShard, setGridSize, setCurrentShard, deleteShard, shards, shardIndex} = useBuilderStore()
  const { startMining, isMining } = useShardMinerStore()
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { getLatest } = useAvatarStore()
  const [readyToMine, setReadyToMine] = useState(false)
  const groupRef = useRef<Group>(null)
  const { camera, viewport } = useThree()

  // Functions

  function getPositionFromXY(x: number, y: number, z: number = 0) {
    const _x = viewport.width * (x/100)
    const _y = viewport.height * (y/100)
    const position = new Vector3(-viewport.width / 2 + _x, -viewport.height / 2 + _y, z)
    return position
  }

  function startMiningShard() {
    if (!readyToMine) return
    const pubkey = identity?.pubkey
    const latestAction = getLatest(pubkey!)
    if (!latestAction) return
    const actionState = extractCyberspaceActionState(latestAction)
    const coordRaw = actionState.coordinate.raw
    startMining(shards[shardIndex!], coordRaw, latestAction.id)
  }

  function handleClick(event: ThreeEvent<MouseEvent>, shard: CyberspaceShard) {
    event.stopPropagation()
    if (event.button === 0) {
      setCurrentShard(shard.id)
    }
    if (event.button === 2 && create) {
      const shouldDelete = confirm('Delete this shard?')
      if (shouldDelete) {
        deleteShard(shard.id)
      }
    }
  }

  function renderVertices(shard: CyberspaceShard) {
    return shard.vertices.map((vertex) => (
      <group key={vertex.id}>
        <mesh // actual vertex mesh
          position={vertex.position}
        >
          <sphereGeometry args={[0.1, 32, 32]} />
          <meshPhongMaterial color={COLORS.PURPLE} />
        </mesh>
      </group>
    ))
  }

  // Effects

  useEffect(() => {
    setGridSize(3)
  }, [setGridSize])

  useEffect(() => {
    if (shardIndex === null || shards.length === 0) return
    const pubkey = identity?.pubkey

    if (!pubkey) return

    const latestAction = getLatest(pubkey)

    if (!latestAction) return

    setReadyToMine(true)

  }, [getLatest, identity, shardIndex, shards, startMining])

  useFrame(() => {
    if (create && groupRef.current) {
      const cameraPosition = camera.position.clone()
      const offset = new Vector3(0.125, .1, -.2)
      offset.applyQuaternion(camera.quaternion)
      groupRef.current.position.copy(cameraPosition.add(offset))
      groupRef.current.quaternion.copy(camera.quaternion)
      const SCALAR = 0.005
      const scale = new Vector3(SCALAR, SCALAR, SCALAR)
      groupRef.current.scale.copy(scale)
    }
  })

  function shardList() {
    const position = new Vector3(5, 0.5, 0)
    const positionOffset = new Vector3(0, -3, 0)
    function incrementPosition () {
      return position.add(positionOffset).clone()
    }
    const list = shards.map((shard) => {
      const scale = 1 / (Math.log2(shard.gridSize) * 2)
      const scaleShard = new Vector3(scale, scale, scale)
      const adjustUI = -Math.log(shard.gridSize)
      return (
      <group rotation={[Math.PI/4, 0, 0]} position={incrementPosition()} key={shard.id} onClick={(e) => handleClick(e, shard)} onContextMenu={(e) => handleClick(e, shard)}>
        <group scale={scaleShard}>
          <Shard shardData={shardStateDataTo3DData(shard)}/>
          {renderVertices(shard)}
          <gridHelper args={[shard.gridSize, shard.gridSize, COLORS.ORANGE, COLORS.PURPLE]} />
        </group>
        <Text 
          color={COLORS.ORANGE} 
          fontSize={0.5} 
          font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
          textAlign='center'
          anchorX={'right'}
          position={[adjustUI, 0, 0]} 
          rotation={[-Math.PI/4, 0, 0]}
        >
          SHARD {shard.id}
        </Text>
        { shardIndex !== null && shards[shardIndex] === shard ? 
          <group position={[adjustUI -7,0,0]} rotation={[-Math.PI/4,0,-Math.PI/2]} scale={[.5,.5,.5]}>
            <Selector />
          </group> 
        : null }
      </group>
      )
    })
    create && list.push((
      <group scale={[8,8,8]} key={'create'} position={incrementPosition()}>
        <mesh
          position={[0, 0, 0]}
          onClick={() => addShard()}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={COLORS.ORANGE} />
        </mesh>
        <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          NEW
        </Text>
      </group>
    ))
    deploy && readyToMine && !isMining && list.push((
      <group scale={[8,8,8]} key={'deploy'} position={incrementPosition()}>
        <mesh
          position={[0, 0, 0]}
          onClick={() => startMiningShard()}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={COLORS.ORANGE} />
        </mesh>
        <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          DEPLOY 
        </Text>
      </group>
    ))
    deploy && isMining && list.push((
      <Spinner text={"MINING"} position={incrementPosition()} scale={[.7,.7,.7]}/>
    ))
    return list
  }

  // layout for LOCAL uses getPositionFromXY since it's part of the hud layer
  if (deploy) {
    return (
      <group
        position={getPositionFromXY(290, 355, -30)}
      >
        {shardList()}
      </group>
    )
  }

  // layout for BUILD uses useFrame to position it relative to the camera
  if (create) {
    return (
      <group ref={groupRef}>
        {shardList()}
      </group>
    )
  }
}

export default ShardList