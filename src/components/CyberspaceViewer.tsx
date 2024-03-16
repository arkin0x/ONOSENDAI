import { useContext, useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import "../scss/CyberspaceViewer.scss"
import { Avatar } from '../libraries/Avatar'
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { SectorManager } from './SectorManager'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)
  const { identity } = useContext<IdentityContextType>(IdentityContext)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        <SectorManager />
        <Avatar pubkey={identity.pubkey} />
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer
