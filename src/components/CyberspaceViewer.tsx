// import { useEffect, useRef } from 'react'
import { useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
// import { Avatar } from './Avatar.tsx'
import { Avatar2 } from './Avatar2.tsx'
// import { Tester } from './Tester'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      {/* <Tester/> */}
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        <Cyberspace>
          <Avatar2/>
        </Cyberspace>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer
