// import { useEffect, useRef } from 'react'
import { useContext, useRef } from 'react'
import { Canvas } from "@react-three/fiber"
// import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
// import { Avatar } from './Avatar.tsx'
import { Avatar } from '../libraries/Avatar.tsx'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
// import { Tester } from './Tester'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)
  const {identity} = useContext<IdentityContextType>(IdentityContext)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        <Avatar pubkey={identity.pubkey}/>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer
