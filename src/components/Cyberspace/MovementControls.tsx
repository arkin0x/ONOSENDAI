import COLORS from "../../data/Colors"
import { useMemo, useState } from "react"
import { ControlState, useControlStore } from "../../store/ControlStore"
import { BoxGeometry, EdgesGeometry, Intersection, LineBasicMaterial, Object3D, Raycaster } from "three"

export function MovementControls() {

  function renderControlUnit() {
    return (
      <group>
        {/* {ButtonBox([0, 0, 0])} */}
        <ButtonBox position={[0, 0, 1]} activate={{backward: true}}/>
        <ButtonBox position={[0, 0, -1]} activate={{forward: true}}/>
        <ButtonBox position={[0, 1, 0]} activate={{up: true}}/>
        <ButtonBox position={[0, -1, 0]} activate={{down: true}}/>
        <ButtonBox position={[1, 0, 0]} activate={{right: true}}/>
        <ButtonBox position={[-1, 0, 0]} activate={{left: true}}/>
        <pointLight position={[0, 5, 1]} intensity={500} color={COLORS.RED} />
      </group>
    )
  }

  return (
    <group>
      {renderControlUnit()}
    </group>
  )
}

function ButtonBox({position, activate}: {position: [number, number, number], activate: Partial<ControlState>}) {
  const { setControlState } = useControlStore()
  const [color, setColor] = useState(COLORS.DARK_PURPLE)
  const boxSize = 0.7
  function go() {
    setControlState(activate)
    setColor(COLORS.RED)
  }
  function stop() {
    const key = Object.keys(activate)[0]
    setControlState({[key]: false})
    setColor(COLORS.DARK_PURPLE)
  }
  return (
    <mesh position={position} 
      onPointerOver={() => setColor(COLORS.ORANGE)}
      onPointerDown={go} 
      onPointerUp={stop}
      onPointerOut={stop}
    >
      <meshPhysicalMaterial color={color} opacity={0.5} transparent={true}/>
      <boxGeometry args={[boxSize, boxSize, boxSize]} />
      {/* <coneGeometry args={[boxSize, boxSize*2, 8]} /> */}
      {/* <lineSegments>
        <edgesGeometry args={[new BoxGeometry(boxSize, boxSize, boxSize)]} />
        <lineBasicMaterial color={color} linewidth={1} transparent={true} opacity={.8}/>
      </lineSegments> */}
      {/* <lineSegments
        geometry={new EdgesGeometry(new BoxGeometry(boxSize, boxSize, boxSize))}
        material={new LineBasicMaterial({ color: color, linewidth: 1, fog: true, opacity: 0.8 })}
      /> */}
    </mesh>
  )
}
