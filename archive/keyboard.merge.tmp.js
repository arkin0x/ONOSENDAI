
// keyboard
const keyState = {}
document.addEventListener('keyup',function(e){
    e.preventDefault()
    keyState[e.code] = 0 
})
document.addEventListener('keydown',function(e){
    e.preventDefault()
    console.log(e.code)
    keyState[e.code] = 1
})

/**
 * updatePosition is called every frame. It reads the keyState and translates
 * the camera.
 */
function updatePosition(){
    const move = 1.00
    const yMove = move
    const zMove = move
    const xMove = move
    const zRot = Math.PI / 180 * 30

    let x = 0
    let y = 0
    let z = 0
    let zR = 0
    let yR = 0
    let xR = 0


    Object.keys(keyState).forEach( key => {

        const keyFramesDown = keyState[key]

        if (!keyState[key]) return

        let doUpdate = true

        switch (key) {
            case 'KeyW': // move forward
                z -= zMove
                break;
            case 'KeyS': // move back
                z += zMove
                break;
            case 'KeyA': // move left
                x -= xMove
                break;
            case 'KeyD': // move right
                x += xMove
                break;
            case 'Space': // move up
                y += yMove
                break;
            case 'ShiftLeft': // move down
                y -= yMove
                break;
            case 'KeyQ': // yaw left
                if(keyFramesDown===1) yR += zRot 
                break;
            case 'KeyE': // yaw right
                if(keyFramesDown===1) yR -= zRot 
                break;
            case 'KeyZ': // roll left
                if(keyFramesDown===1) zR += zRot 
                break;
            case 'KeyC': // roll right
                if(keyFramesDown===1) zR -= zRot
                break;
            default:
                doUpdate = false
                break;
        }

        if (doUpdate) {
            keyState[key]++
            camera.position.setX(camera.position.x + x)
            camera.position.setY(camera.position.y + y)
            camera.position.setZ(camera.position.z + z)
            camera.rotation.setFromVector3(new THREE.Vector3(camera.rotation.x + xR, camera.rotation.y + yR, camera.rotation.z + zR))
        }
    })
}
