import { useActionChain } from "../hooks/cyberspace/useActionChain"
import { BufferGeometry, LineBasicMaterial, Quaternion, Vector3 } from "three"
import { ThreeAvatar } from "../components/ThreeAvatar"
import { useContext, useEffect, useRef, useState } from "react"
import { AvatarContext } from "../providers/AvatarContext"
import { cyberspaceToSectorPosition, extractActionState, getSectorCoordinatesFromCyberspaceCoordinates } from "./Cyberspace"
import { useRotationStore } from "../store/RotationStore"
import { getTag } from "./Nostr"
import { useFrame } from "@react-three/fiber"
import { DecimalVector3 } from "./DecimalVector3"
import Decimal from "decimal.js"

type AvatarProps = {
  pubkey: string
}

/**
 * Avatar takes a pubkey and renders a ThreeAvatar while setting up action chain management and state storage of the avatar's actions and simulated state.
 * @param pubkey string
 * @returns ThreeAvatar
 */
export const Avatar = ({pubkey}: AvatarProps) => {

  useActionChain(pubkey)

  const {simulatedState} = useContext(AvatarContext)
  const {rotation} = useRotationStore()

  if (!simulatedState[pubkey]) {
    console.log('Avatar: no simulated state for', pubkey.substring(0,8)+".","Not rendering.")
    return null
  }


  const {sectorPosition, plane, velocity, time} = extractActionState(simulatedState[pubkey])

  // console.log(simulatedState[pubkey].tags.find(getTag('Cd')), sectorPosition.toArray())

  return <>
    <ThreeAvatarTrail position={sectorPosition} rotation={rotation} pubkey={pubkey}/>
    {/* <Tether pubkey={pubkey} sectorPosition={sectorPosition}/> */}
    <ThreeAvatar position={sectorPosition} rotation={rotation} />
  </>
}

function Tether({pubkey, sectorPosition}: {pubkey: string, sectorPosition: DecimalVector3}) {

  const home = getSectorCoordinatesFromCyberspaceCoordinates(pubkey).toVector3()

  const tetherMaterial = new LineBasicMaterial({ color: 0xff2323 })

  const lineBufferGeometry = new BufferGeometry().setFromPoints([home, sectorPosition.toVector3()])

  return (
    <lineSegments scale={[1,1,1]} geometry={lineBufferGeometry} material={tetherMaterial} />
  )
}

function ThreeAvatarTrail({pubkey, position, rotation}: {pubkey: string, position: DecimalVector3, rotation: Quaternion}) {
  const {actionState, simulatedState} = useContext(AvatarContext)
  const [lines, setLines] = useState<JSX.Element[]>([])
  const actions = actionState[pubkey]
  // for each pair of actions, render a line between them

  console.log(lines.length)

  const AvatarMaterialEdges = new LineBasicMaterial({ color: 0xff2323 })

  useEffect(() => {
    if (!actions || actions.length < 2) {
      return
    }

    const _lines: JSX.Element[] = [ ]

    for (let i = 0; i < actions.length; i++) {
      try {
        let startPoint, endPoint 
        if (i === actions.length - 1){
          startPoint = extractActionState(actions[i])
          // use simulated state for last line
          endPoint = position.toVector3()
        } else {
          startPoint = extractActionState(actions[i])
          endPoint = extractActionState(actions[i+1]).sectorPosition.toVector3()
        }

        const line = <lineSegments scale={[1,1,1]} geometry={new BufferGeometry().setFromPoints([startPoint.sectorPosition.toVector3(), endPoint])} key={Math.random().toString()} material={AvatarMaterialEdges} />
        _lines.push(line)
      } catch (e) {
        console.error('ThreeAvatarTrail:', e)
      }
    }

    setLines(() => [..._lines])

    return () => {
      lines.forEach(line => {
        line.props.geometry.dispose()
      })
    }
  }, [actionState])

  // console.log(lines)

  function tracer() {
    // const currentPos = getSectorCoordinatesFromCyberspaceCoordinates(simulatedState[pubkey].tags.find(getTag('C'))![1]).toVector3()
    // const trace = currentPos.clone().add(new Vector3(5, 5, 0))
    // console.log(currentPos, trace)
    return (
      <group position={position.toVector3()}>
        <lineSegments scale={[1,1,1]} geometry={new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0,0,10).applyQuaternion(rotation)])} key={"tracer"} material={AvatarMaterialEdges} />
      </group>
    )
  }

  return <>
    {/* <TestMesh/> */}
    {lines}
    {/* {tracer()} */}
  </>
}

const TestMesh = () => {

  const testRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (testRef.current) {
      // testRef.current.rotation.x += 0.01
      // testRef.current.rotation.y += 0.01
    }
  })

  return (
    <mesh ref={testRef}
      position={new Vector3(0, 0, -1)}
    >
      <coneGeometry args={[1, 4, 16]}/>
      <meshNormalMaterial />
    </mesh>
  )
}