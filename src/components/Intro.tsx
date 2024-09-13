import { ReactNode, useEffect, useRef } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { CyberspacePlane } from '../libraries/Cyberspace.ts'
import { TextureLoader, Vector3 } from 'three'
import { Text } from '@react-three/drei'
import COLORS from '../data/Colors.ts'
import logo from '../assets/logo-cropped.png'
import { SignInButton } from './SignInButton.tsx'

export function Intro() {

  const texture = useLoader(TextureLoader, logo)

  return (
    <div id="home">
      {/* <img src={logo} alt="logo" style={{position: "absolute", width: "70svw", top: "40svh", zIndex: 999}}/> */}
      <Canvas style={{height: "100svh", position: "absolute"}}>
        <CameraFlight />
      </Canvas>
      <Canvas style={{height: "100svh"}}>
        <EffectComposer>
          <Bloom mipmapBlur levels={1} intensity={4} luminanceThreshold={0.001} luminanceSmoothing={0} />
        </EffectComposer>
        <mesh position={[0, 0, -2]}>
          <planeGeometry attach="geometry" args={[5.28531073446328, 1]} />
          <meshBasicMaterial attach="material" map={texture} transparent={true} />
        </mesh>
      <group position={[0,-1, 0]}>
        <Text position={[0, 0.25, 0]} color={COLORS.ORANGE} fontSize={0.15} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          WELCOME TO CYBERSPACE 
        </Text>
        <SignInButton/>
        <mesh
          position={[0.3, 0, 0]}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={COLORS.ORANGE} />
        </mesh>
        <Text position={[0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          NEW ID
        </Text>
      </group>
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

  const logoRef = useRef<THREE.Mesh>(null)
  const logoDistance = 5

  useEffect(() => {
    CAMERA_PROGRESS_REF.current = 1
    camera.far = 2**30 
    camera.near = 0.01
    camera.position.copy(CAMERA_START)
    camera.lookAt(new Vector3(0,0,SCALE))
    camera.updateProjectionMatrix()
  },[])

  useFrame(() => {
    // camera.position.copy(camera.position.lerp(CAMERA_END, CAMERA_PROGRESS_REF.current))
    camera.position.setZ(-SCALE * CAMERA_PROGRESS_REF.current)
    CAMERA_PROGRESS_REF.current -= 0.0001
    if (CAMERA_PROGRESS_REF.current <= -1) {
      CAMERA_PROGRESS_REF.current = 1
    }

    if( logoRef.current ) {
      // Calculate the position in front of the camera
      const direction = new Vector3()
      camera.getWorldDirection(direction)
      direction.multiplyScalar(logoDistance)
      // Set the position of the plane
      logoRef.current.position.copy(camera.position).add(direction)
        
      // Make the plane face the camera
      logoRef.current.quaternion.copy(camera.quaternion)
    }
  })

  return (
    <>
      <group>
        <ambientLight intensity={2.0} />
        {/* <OrbitControls target={[0,0,SCALE]}/> */}
        <group position={[-SCALE/2, 0, -SCALE]}>
          <IntroGrid scale={SCALE} plane={CyberspacePlane.ISpace}>
          </IntroGrid>
        </group>
        <group position={[-SCALE/2, 0, 0]} rotation={[0,0,0]}>
          <IntroGrid scale={SCALE} plane={CyberspacePlane.ISpace}>
          </IntroGrid>
        </group>
        <EffectComposer>
          <Bloom mipmapBlur levels={2} intensity={50} luminanceThreshold={0.001} luminanceSmoothing={0} />
        </EffectComposer>
    </group>
    </>
  )
}

export function IntroGrid({children, scale, plane = CyberspacePlane.DSpace}: {children?: ReactNode, scale: number, plane: CyberspacePlane}) {

  const GRIDLINES = 100

  return (
    <>
      <gridHelper // Top Grid
        args={[scale, GRIDLINES, COLORS.SKY, COLORS.SKY]}
        position={[scale/2, 5, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      <gridHelper // Bottom Grid
        args={[scale, GRIDLINES, COLORS.GROUND, COLORS.GROUND]}
        position={[scale/2, -5, scale/2]} // all coordinates are positive, so the top left corner of the grid should be x0 z0.
      />
      {children}
    </>
  )
}