import COLORS from "../../data/Colors"
import { useEffect, useState } from "react"
import { ControlState, useControlStore } from "../../store/ControlStore"
import { Text } from '@react-three/drei'

export function MovementControls() {

  function renderControlUnit() {
    return (
      <group position={[0,3,0]}>
        <ButtonBox text={'FOLLOW\nESC'} position={[0, -1.5, 0]} activate={{resetView: true}} toggle/>
        <ButtonBox text={'BACK\nS'} position={[0, -.5, 0]} activate={{backward: true}} down up/>
        <ButtonBox text={'FORWARD\nW'} position={[0, .5, 0]} activate={{forward: true}} down up/>
        <ButtonBox text={'CRUISE'} position={[0, 1.5, 0]} activate={{cruise: true}} toggle/>
        <ButtonBox text={'UP\nE'} position={[2, .5, 0]} activate={{up: true}} down up/>
        <ButtonBox text={'DOWN\nQ'} position={[2, -.5, 0]} activate={{down: true}} down up/>
        <ButtonBox text={'RIGHT\nD'} position={[3, 0, 0]} activate={{right: true}} down up/>
        <ButtonBox text={'LEFT\nA'} position={[1, 0, 0]} activate={{left: true}} down up/>
        <pointLight position={[0, 8, 1]} intensity={100} color={COLORS.RED} />
      </group>
    )
  }

  return (
    <group>
      {renderControlUnit()}
    </group>
  )
}

function ButtonBox({text, position, activate, down, up, toggle}: {text: string, position: [number, number, number], activate: Partial<ControlState>, down?: boolean, up?: boolean, toggle?: boolean}) {
  const { controlState, setControlState } = useControlStore()
  const [color, setColor] = useState(COLORS.DARK_PURPLE)

  const boxSize = 0.8
  const key = Object.keys(activate)[0] as keyof ControlState

  function over() {
    if (controlState[key]) return
    setColor(COLORS.ORANGE)
  }

  function go() {
    if (toggle) {
      setControlState({ [key]: !controlState[key] })
      setColor(controlState[key] ? COLORS.DARK_PURPLE : COLORS.RED)
    } else if (down) {
    setControlState(activate)
    setColor(COLORS.RED)
    }
  }

  function stop() {
    if (toggle) return
    if (up) {
      setControlState({ [key]: false })
    setColor(COLORS.DARK_PURPLE)
    }
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
      <boxGeometry args={[boxSize, boxSize, .2]} />
      <Text position={[0, 0, .21]} color={color === COLORS.DARK_PURPLE ? COLORS.RED : COLORS.BLACK} fontSize={0.17} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'} anchorX={'center'} textAlign='center'>
        {text}
      </Text>
    </mesh>
  )
}