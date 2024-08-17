import { AvatarGeometryEdges, AvatarMaterialEdges } from "../../data/AvatarModel"

export function AvatarMarker() {
  return (
    <group position={[0,0,0]}>
      {/* default avatar represented by dodecahedron */}
      <lineSegments scale={[.5,.5,.5]} geometry={AvatarGeometryEdges} material={AvatarMaterialEdges} />
      {/* <axesHelper position={[0,0,0]} scale={512}/> */}
    </group>
  )
}