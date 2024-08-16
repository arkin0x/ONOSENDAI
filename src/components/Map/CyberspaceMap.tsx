import { useContext } from 'react'
import { Canvas } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { IdentityContextType } from '../../types/IdentityType'
import { IdentityContext } from '../../providers/IdentityProvider'
import { AvatarMarker } from './AvatarMarker'
import { MapControls } from './MapControls'
// import { BlockMarkers } from './BlockMarkers'
// import { Constructs } from './Constructs'
// import { ObjectMarkers } from './ObjectMarkers'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import SectorGrid from './SectorGrid'
import { OrbitControls } from '@react-three/drei'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const MAP_SIZE = 2**30

const CyberspaceMap = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)

  return (
    <div className="cyberspace-map">
      <div id="map">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <MapControls />
          <AvatarMarker pubkey={identity?.pubkey} scale={MAP_SIZE} />
          {/* <ObjectMarkers scale={MAP_SIZE} /> */}
          {/* <BlockMarkers scale={MAP_SIZE} /> */}
          {/* <Constructs scale={MAP_SIZE} /> */}
          {/* <SectorMarkers pubkey={identity?.pubkey} scale={MAP_SIZE} /> */}
          <SectorGrid scale={MAP_SIZE} />
          <OrbitControls target={[0,0,0]} />
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={15} luminanceThreshold={0.00001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
      {/* <div id="map-hud">
        <Canvas style={{ position: 'absolute', top: 0 }} camera={{ near: 0.1, far: 1000, fov: 70 }} children={undefined}>
        </Canvas>
      </div> */}
    </div>
  )
}

export default CyberspaceMap 
