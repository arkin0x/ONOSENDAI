import { IcosahedronGeometry, EdgesGeometry, LineBasicMaterial } from 'three'

export const AvatarGeometry = new IcosahedronGeometry(.5,1)
export const AvatarGeometryEdges = new EdgesGeometry(AvatarGeometry)
export const AvatarMaterialEdges = new LineBasicMaterial({ color: 0xff2323 })
