import { useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
import { Avatar } from './Avatar.tsx'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={0.8} />
        <Cyberspace>
          <Avatar/>
        </Cyberspace>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer

