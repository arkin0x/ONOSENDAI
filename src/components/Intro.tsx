import { ReactNode, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { CyberspacePlane } from '../libraries/Cyberspace.ts'
import { Vector3 } from 'three'
import COLORS from '../data/Colors.ts'
import logo from '../assets/logo-cropped.png'

export function Intro() {

  return (
    <div id="home">
      <Canvas style={{height: "100svh"}}>
        <CameraFlight />
      </Canvas>
    </div>
  )

}

function CameraFlight() {

  const SCALE = 1000

  const { camera } = useThree()

  const CAMERA_START = new Vector3(0, 0, 0)
  const CAMERA_END = new Vector3(0, 0, -SCALE)
  const CAMERA_PROGRESS_REF = useRef(1)

  useEffect(() => {
    CAMERA_PROGRESS_REF.current = 1
    camera.far = 2**30 
    camera.near = 0.01
    camera.position.copy(CAMERA_START)
    camera.updateProjectionMatrix()
  },[])

  useFrame(() => {
    // camera.position.copy(camera.position.lerp(CAMERA_END, CAMERA_PROGRESS_REF.current))
    camera.position.setZ(-SCALE * CAMERA_PROGRESS_REF.current)
    CAMERA_PROGRESS_REF.current -= 0.0001
    if (CAMERA_PROGRESS_REF.current <= -1) {
      CAMERA_PROGRESS_REF.current = 1
    }
  })

  return (
    <>
      <ambientLight intensity={2.0} />
      <OrbitControls target={[0,0,SCALE]} />
      <group position={[-SCALE/2, 0, -SCALE]}>
        <IntroGrid scale={SCALE} plane={CyberspacePlane.ISpace}>
        </IntroGrid>
      </group>
      <group position={[-SCALE/2, 0, 0]} rotation={[0,0,0]}>
        <IntroGrid scale={SCALE} plane={CyberspacePlane.ISpace}>
        </IntroGrid>
      </group>
      <EffectComposer>
        <Bloom mipmapBlur levels={9} intensity={50} luminanceThreshold={0.001} luminanceSmoothing={0} />
      </EffectComposer>
    </>
  )
}

export function IntroGrid({children, scale, plane = CyberspacePlane.DSpace}: {children?: ReactNode, scale: number, plane: CyberspacePlane}) {

  const GRIDLINES = 100

  return (
    <>
      <gridHelper // Top Grid
        args={[scale, GRIDLINES, COLORS.GRID_CROSS, plane === CyberspacePlane.DSpace ? 0x3B0097 : COLORS.SKY]}
        position={[scale/2, 5, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <gridHelper // Bottom Grid
        args={[scale, GRIDLINES, COLORS.GRID_CROSS, plane === CyberspacePlane.DSpace ? 0x3A0C40 : COLORS.GROUND]}
        position={[scale/2, -5, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      {children}
    </>
  )
}