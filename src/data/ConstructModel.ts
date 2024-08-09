import { EdgesGeometry, LineBasicMaterial, BoxGeometry } from 'three'

const ConstructGeometry = new BoxGeometry(1,1,1)
export const ConstructGeometryEdges = new EdgesGeometry(ConstructGeometry)
export const ConstructMaterialEdges = new LineBasicMaterial({ color: 0x78004e })
