import { 
 MeshPhongMaterial, 
 MeshBasicMaterial, 
 DoubleSide,
 LineBasicMaterial,
 AlwaysDepth
} from "three"

// colors
const LOGO_PURPLE = 0x78004e
const LOGO_PURPLE_HIGHLIGHT = 0xb20074
const LOGO_BLUE = 0x0062cd
const LOGO_TEAL = 0x06a4a4
const BITCOIN = 0xff9900
const GRID_COLOR = 0x00006fa//0xf747bc
const ENVIRONMENT_LEFT_COLOR = 0x7029f4
const ENVIRONMENT_RIGHT_COLOR = 0xff07ac
const LEFT_LAMP_COLOR = 0xf747bc
const RIGHT_LAMP_COLOR = 0x7029f4
const CENTER_LAMP_COLOR = 0xffffff

export const colors = {
 LOGO_PURPLE,
 LOGO_PURPLE_HIGHLIGHT,
 LOGO_BLUE,
 LOGO_TEAL,
 BITCOIN,
 GRID_COLOR,
 ENVIRONMENT_LEFT_COLOR,
 ENVIRONMENT_RIGHT_COLOR,
 LEFT_LAMP_COLOR,
 RIGHT_LAMP_COLOR,
 CENTER_LAMP_COLOR,
}

export const sunMaterial = new MeshBasicMaterial({
 // color: 0xff2323,
 // color: 0xff0000
 // color: LOGO_PURPLE,
 color: 0x160621,
 side: DoubleSide,
 fog: false,
})
// sunMaterial.depthFunc = AlwaysDepth

export const whiteMaterial = new MeshPhongMaterial({
 color: 0xffffff,
 shininess: 30,
 specular: 0xffffff,
 transparent: true,
 opacity: 0.90,
})

export const bookmarkedMaterial = new MeshPhongMaterial({
 // color: 0xff2323,
 color: 0xff3b3b,
 shininess: 50,
 specular: 0xffffff,
 transparent: true,
 opacity: 0.90,
 fog: false,
})

export const placeholderMaterial = new MeshPhongMaterial({
 color: 0xffffff,
 shininess: 50,
 specular: 0x333333,
 transparent: true,
 opacity: 0.20,
})

export const placeholderVisitedMaterial = new MeshPhongMaterial({
 color: LOGO_PURPLE,
 shininess: 10,
 specular: 0x111111,
 // transparent: true,
 // opacity: 0.90,
})

export const expandedCubeMaterial = new MeshPhongMaterial({
 color: LOGO_TEAL,
 shininess: 30,
 specular: 0xffffff,
 transparent: true,
 opacity: 0.75,
 fog: false,
})

export const expandedBookmarkedCubeMaterial = new MeshPhongMaterial({
 color: 0xff3b3b,
 shininess: 30,
 specular: 0xffffff,
 transparent: true,
 opacity: 0.75,
 fog: false,
})

export const relatedCubeMaterial = new MeshPhongMaterial({
 color: LOGO_TEAL,
 shininess: 30,
 specular: 0x999999,
 transparent: true,
 opacity: 0.90,
})

// for a note thas was selected but not read
export const selectedMaterial = new MeshPhongMaterial({
 color: LOGO_BLUE,
 shininess: 30,
 specular: 0xffffff,
 // transparent: true,
 // opacity: 0.90,
})

export const visitedMaterial = new MeshPhongMaterial({
 color: LOGO_PURPLE,
 shininess: 10,
 specular: 0x111111,
 // transparent: true,
 // opacity: 0.90,
})

export const connectToRoot = new LineBasicMaterial({color: LOGO_BLUE})
export const connectToReplies = new LineBasicMaterial({color: LOGO_PURPLE})

export const textMaterial = new MeshBasicMaterial({color: BITCOIN})