import COLORS from "../../data/Colors"
import { useEffect, useState } from "react"
import { ControlState, useControlStore } from "../../store/ControlStore"
import { Text } from '@react-three/drei'

export function MovementControls() {

  function renderControlUnit() {
    return (
      <group>
        <ButtonBox text={'FOLLOW'} position={[0, 1.5, 0]} activate={{resetView: true}} down/>
        <ButtonBox text={'BACK'} position={[0, -.5, 0]} activate={{backward: true}} down up/>
        <ButtonBox text={'FORWARD'} position={[0, .5, 0]} activate={{forward: true}} down up/>
        <ButtonBox text={'UP'} position={[2, .5, 0]} activate={{up: true}} down up/>
        <ButtonBox text={'DOWN'} position={[2, -.5, 0]} activate={{down: true}} down up/>
        <ButtonBox text={'RIGHT'} position={[3, 0, 0]} activate={{right: true}} down up/>
        <ButtonBox text={'LEFT'} position={[1, 0, 0]} activate={{left: true}} down up/>
        <pointLight position={[0, 8, 1]} intensity={500} color={COLORS.RED} />
      </group>
    )
  }

  return (
    <group>
      {renderControlUnit()}
    </group>
  )
}

function ButtonBox({text, position, activate, down, up}: {text: string, position: [number, number, number], activate: Partial<ControlState>, down?: boolean, up?: boolean}) {
  const { controlState, setControlState } = useControlStore()
  const [color, setColor] = useState(COLORS.DARK_PURPLE)

  const boxSize = 0.8
  const key = Object.keys(activate)[0] as keyof ControlState

  function over() {
    if (controlState[key]) return
    setColor(COLORS.ORANGE)
  }

  function go() {
    if (!down) return
    setControlState(activate)
    setColor(COLORS.RED)
  }

  function stop() {
    if (!up) {
      return
    }
    setControlState({[key]: false})
    setColor(COLORS.DARK_PURPLE)
  }

  useEffect(() => {
    if (controlState[key]) {
      setColor(COLORS.RED)
    } else {
      setColor(COLORS.DARK_PURPLE)
    }
  }, [controlState, key])

  return (
    <mesh position={position} 
      onPointerOver={over}
      onPointerDown={go} 
      onPointerUp={stop}
      onPointerOut={stop}
    >
      <meshPhysicalMaterial color={color} opacity={0.5} transparent={true}/>
      <boxGeometry args={[boxSize, boxSize, boxSize]} />
      <Text position={[0, 0, boxSize]} color={COLORS.RED} fontSize={0.17} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'} anchorX={'center'} textAlign='center'>
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
