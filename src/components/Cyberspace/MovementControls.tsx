import COLORS from "../../data/Colors"
import { useState } from "react"
import { ControlState, useControlStore } from "../../store/ControlStore"
import { Text } from '@react-three/drei'

export function MovementControls() {

  function renderControlUnit() {
    return (
      <group>
        <ButtonBox text={'BACK'} position={[-2, -.5, 0]} activate={{backward: true}}/>
        <ButtonBox text={'FORWARD'} position={[-2, .5, 0]} activate={{forward: true}}/>
        <ButtonBox text={'UP'} position={[0, .5, 0]} activate={{up: true}}/>
        <ButtonBox text={'DOWN'} position={[0, -.5, 0]} activate={{down: true}}/>
        <ButtonBox text={'RIGHT'} position={[1, 0, 0]} activate={{right: true}}/>
        <ButtonBox text={'LEFT'} position={[-1, 0, 0]} activate={{left: true}}/>
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

function ButtonBox({text, position, activate}: {text: string, position: [number, number, number], activate: Partial<ControlState>}) {
  const { setControlState } = useControlStore()
  const [color, setColor] = useState(COLORS.DARK_PURPLE)
  const boxSize = 0.8
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
      <boxGeometry args={[boxSize, boxSize, .3]} />
      <Text position={[0, 0, .3]} color={COLORS.RED} fontSize={0.17} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'} anchorX={'center'} textAlign='center'>
        {text}
      </Text>
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
