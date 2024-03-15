import { useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import "../scss/CyberspaceViewer.scss"

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer
