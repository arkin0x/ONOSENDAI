// import { useEffect, useRef } from 'react'
import { useRef } from 'react'
import { Canvas } from "@react-three/fiber"
// import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
// import { Avatar } from './Avatar.tsx'
import { Avatar } from '../libraries/Avatar.tsx'
// import { Tester } from './Tester'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        <Avatar pubkey={'3a0d60ea3c211817f0fcf2b771c935052b82e2acfdfa5661b805cabfd98294bc'}/>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer
