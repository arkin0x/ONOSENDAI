import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader'
import threeFont from 'three/examples/fonts/helvetiker_regular.typeface.json?url'
import { FirstPersonControls } from './FirstPersonControls'
import { colors, whiteMaterial, expandedCubeMaterial, expandedBookmarkedCubeMaterial, connectToRoot, visitedMaterial, sunMaterial, connectToReplies, bookmarkedMaterial } from './materials'
import { noteGeometry } from './geometry'
import reticleImage from './reticle-mouse.png'
import logoImage from './logo-cropped.png'

import { wrapText } from './wraptext'

// we downscale the coordinates:
// 2^85 - 2^71 = 2^14 (16384)
// because otherwise there is too much empty space
export const WORLD_DOWNSCALE = 2n**65n
export const WORLD_SCALE = Number((2n**85n) / WORLD_DOWNSCALE)
export const MOBILE_WIDTH = 576 

let w, h

/**
 * layout = "mobile" | "desktop"
 * Breakpoint toggle
 */
let layout

let noteSpriteDisplayWidth

let clock, delta
let camera, scene, renderer 

let hudcamera, hudscene
let universe
let raycaster, pointer, normalizedPointer
let fontloader, font, textureloader
let controls
let reticle
let bookmarkButton, bookmarkButtonPosition, bookmarkLerp
let logo

let frame

let modal, modalMessage

let intersected
let selected

/**
 * pubkeys = {<pubkey>: [<event id>, ...], ...}
 * * not persisted
 * Indexes a user's event id's by the user's pubkey. Used to connect note nodes.
 */
let pubkeys

/**
 * loadedEvents = {<event id>: event, ...} 
 * * not persisted
 * When a note is received and visualizeNote() is called, the event is added to
 * loadedEvents by its id. This indicates it is visible in the world. Event
 * includes simhash
 */ 
let loadedEvents

/**
 * bookmarkedEvents = {<event id>: event, ...}
 * * is persisted
 * When the user bookmarks an event it is stored here and the whole event is
 * persisted in localStorage. These are hydrated on load. Event includes simhash
 * 
 */
let bookmarkedEvents

/**
 * readEvents = {<event id>: simhash in hex}
 * * is persisted
 * When the user reads an event, we store that they read it so they can see
 * where they have been. We need the event id so we can hydrate when the event
 * is ultimately loaded.
 */
let readEvents

let nodeConnectors, connectedNodes, cycling

let starttimestamp

let lilgrid

init()
animate()

function init(){

    // keep track of when we started the application so we can request notes from earlier than this. TODO wait, isn't there a browser api for this?
    starttimestamp = +new Date()

    frame = 0n

    w = window.innerWidth
    h = window.innerHeight

    layout = w > MOBILE_WIDTH ? "desktop" : "mobile"

    // noteSpriteDisplayWidth = w < 680 ? w-40 : w/4
    bookmarkButtonPosition = new THREE.Vector2( 
        layout == "desktop" ? -noteSpriteDisplayWidth + 20 : -(w/2),
        layout == "desktop" ? (h/2) - 20 : -(h/2)
    )

    clock = new THREE.Clock()

    camera = new THREE.PerspectiveCamera(45, w/h,0.1,10000000)
        camera.position.set(0,0,0)
        camera.rotation.set(-Math.PI/180*30,0,0)
    scene = new THREE.Scene()
    // scene.fog = new THREE.Fog( "#160621", 1, WORLD_SCALE*0.75)
    scene.fog = new THREE.Fog( "#160621", 1, WORLD_SCALE*0.33)
    scene.add(camera)

    hudcamera = new THREE.OrthographicCamera(-w/2, w/2, h/2, -h/2,0.001,1000)
    hudscene = new THREE.Scene()
    hudscene.add(hudcamera)

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2()
    normalizedPointer = new THREE.Vector2()

    renderer = new THREE.WebGLRenderer()
    renderer.setPixelRatio( window.devicePixelRatio )
    renderer.setSize(w,h)
    renderer.autoClear = false
    document.querySelector('#app').appendChild( renderer.domElement )

    // event listeners
    window.addEventListener( 'resize', onWindowResize )

    // font loader
    fontloader = new FontLoader();
    fontloader.load( threeFont, function ( loadedFont ) {
        font = loadedFont
    })

    textureloader = new THREE.TextureLoader()
    textureloader.load( reticleImage, setupReticle )
    // textureloader.load( bookmarkImage, setupBookmark )
    textureloader.load( logoImage, setupOrtho)


    function setupReticle( tex ){
    // test screen coordinate proxy sprite
    // let spr = new THREE.Sprite(new THREE.SpriteMaterial({map: tex}))
    // spr.scale.set( 50, 50, 1)
    // spr.center.set(0.5,0.5)
    // spr.position.set(-w/2*.9,-h/2*.9,-20)
    // hudcamera.add(spr)
    // console.log(spr.getWorldPosition(new THREE.Vector3()))
        let material = new THREE.SpriteMaterial({map: tex})
        material.color.set('yellow')
        let width = material.map.image.width
        let height = material.map.image.height
        reticle = new THREE.Sprite( material )
        reticle.center.set(0.5,0.5)
        reticle.scale.set( 50, 50, 1)
        hudcamera.add(reticle)
        reticle.position.set(0,0,-2)
        renderer.domElement.addEventListener('mouseleave',function(){
            reticle.visible = false
        })
        renderer.domElement.addEventListener('mouseenter',function(){
            reticle.visible = true
        })
    }
    function setupBookmark( tex ){
        let material = new THREE.SpriteMaterial({map: tex})
        material.color.set(colors.LOGO_PURPLE)
        let width = material.map.image.width
        let height = material.map.image.height
        bookmarkButton = new THREE.Sprite( material )
        bookmarkButton.visible=false
        bookmarkButton.center.set(0,1)
        bookmarkButton.scale.set( width/8, height/8, 1)
        hudcamera.add(bookmarkButton)
        bookmarkButton.position.set(bookmarkButtonPosition.x,bookmarkButtonPosition.y,-3)
    }
    function setupOrtho( tex ){
        // logo
        let material = new THREE.SpriteMaterial({map: tex})
        let width = material.map.image.width
        let height = material.map.image.height
        let ratio = height/width
        let logoSize = Math.min(w/3,250) //screen width/4
        logo = new THREE.Sprite(material)
        logo.center.set(1,1)
        logo.scale.set( logoSize, logoSize*ratio, 1)
        hudcamera.add(logo)
        logo.position.set(w/2-16,-h/2+logoSize*ratio+16,-1)

        // hud compass
        let compassSize = Math.min(w/6,logoSize*(1/2))
        lilgrid = new THREE.Group()
        // top pink grid
        let a = new THREE.GridHelper(1,5,colors.LOGO_PURPLE,colors.LOGO_PURPLE)
        // bottom blue grid
        let b = new THREE.GridHelper(1,5,colors.LOGO_BLUE,colors.LOGO_BLUE)
        // middle black plane
        let p = new THREE.PlaneGeometry(1.05,1.05)
        let pm = new THREE.MeshBasicMaterial({color: 0x000000, side: THREE.DoubleSide})
        let pl = new THREE.Mesh(p,pm)
        const lilsunGeometry = new THREE.CircleGeometry( 0.25, 32);
        const lilsun = new THREE.Mesh(lilsunGeometry, sunMaterial)
        lilsun.position.z -= 0.65
        pl.rotateX(-Math.PI/2)
        pl.position.y -= 0.01
        b.position.y -= 0.02
        lilgrid.add(a)
        lilgrid.add(pl)
        lilgrid.add(b)
        lilgrid.add(lilsun)
        lilgrid.position.set(w/2-logoSize/2,h/2-compassSize*(3/4),-compassSize*2)
        lilgrid.scale.set(compassSize,compassSize,compassSize)
        hudcamera.add(lilgrid)
        lilgrid.setRotationFromQuaternion( camera.getWorldQuaternion( new THREE.Quaternion() ).invert() )
    }

    // scene objects
    universe = new THREE.Group()
    scene.add(universe)

    // ambient light for whole scene
    const ambientLight = new THREE.AmbientLight( 0x999999, 1 )
    scene.add( ambientLight );

    // cyberpunk style left/right lights
    const environmentLightLeft = new THREE.DirectionalLight( colors.ENVIRONMENT_LEFT_COLOR, 0.8 );
    environmentLightLeft.position.set( 1, 1, 1 );
    scene.add( environmentLightLeft );
    const environmentLightRight = new THREE.DirectionalLight( colors.ENVIRONMENT_RIGHT_COLOR, 0.8 );
    environmentLightRight.position.set( -1, -1, -1 );
    scene.add( environmentLightRight );

    // gridhelper
    const grid = new THREE.GridHelper(WORLD_SCALE/2,100,colors.LOGO_PURPLE,colors.LOGO_PURPLE)
    grid.position.set(0,-(WORLD_SCALE)/4,0)
    scene.add(grid)

    //sun
    const sunGeometry = new THREE.CircleGeometry( 2000000, 64 );
    const sun = new THREE.Mesh(sunGeometry, sunMaterial)
    sun.position.set(0,-1000,-10000000)
    scene.add(sun)

    // camera objects
    // operator light - attached to camera
    const OPERATOR_LAMP_STRENGTH = 0.65
    const operatorLampLeft = new THREE.PointLight( colors.LEFT_LAMP_COLOR, OPERATOR_LAMP_STRENGTH, 100, 1 )
    const operatorLampCenter = new THREE.PointLight( colors.CENTER_LAMP_COLOR, OPERATOR_LAMP_STRENGTH, 500, 1 )
    const operatorLampRight = new THREE.PointLight( colors.RIGHT_LAMP_COLOR, OPERATOR_LAMP_STRENGTH, 100, 1 )
    operatorLampLeft.position.set(-5,0,-2)
    operatorLampCenter.position.set(0,0,-2)
    operatorLampRight.position.set(5,0,-2)
    camera.add(operatorLampLeft)
    camera.add(operatorLampCenter)
    camera.add(operatorLampRight)

    // camera controls
    controls = new FirstPersonControls( camera, renderer.domElement )
    controls.movementSpeed = 500;
    controls.lookSpeed = 0.25;
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1.8;

    loadedEvents = {}
    bookmarkedEvents = JSON.parse(localStorage.getItem('bookmarks')) || {}
    readEvents = {}
    pubkeys = {}

    nodeConnectors = []
    connectedNodes = []
    cycling = false

}

function animate() {
    requestAnimationFrame( animate )
    render()
}

function render() {
    frame++

    delta = clock.getDelta() 

    // console.log(delta)

    controls.update(delta)
    pointer.x = controls.pointer.x
    pointer.y = controls.pointer.y

    updateRaycast(controls)
    updateSelectedNote(controls)

    // updateUniverse(controls)

    scaleNotes()
    animateReticle(delta)
    animateSelectedNote()

    controls.postUpdate()

    // minimap
    lilgrid?.setRotationFromQuaternion( camera.getWorldQuaternion( new THREE.Quaternion() ).invert() )

    // must manually clear to do multiple cameras
    renderer.clear()
    renderer.render(scene, camera)
    renderer.clearDepth()
    renderer.render(hudscene, hudcamera)
}

function onWindowResize() {

    w = window.innerWidth
    h = window.innerHeight

    camera.aspect = w / h
    camera.updateProjectionMatrix()

    hudcamera.left = -w / 2
    hudcamera.right = w / 2
    hudcamera.top = h / 2
    hudcamera.bottom = -h / 2
    hudcamera.updateProjectionMatrix()

    renderer.setSize( w, h )

    controls.handleResize()

}

function updateCycle(controls){
    if (controls.cycle === 0 || !connectedNodes.length || !selected) return

    if (cycling === true ){
        // we want to display the selected node first, so don't do this
        if (controls.cycle === 1){
            connectedNodes.push(connectedNodes.shift())
        } else if (controls.cycle === -1){
            connectedNodes.unshift(connectedNodes.pop())
        }
    }

    cycling = true

    let node = connectedNodes[0]

    // let dist = distanceVector(node.position, camera.position)
    // camera.translateX(dist.x)
    // camera.translateY(dist.y)
    // camera.translateZ(dist.z)

    // look from above selected node
    // let selectedNode = selected.intersected.object.position
    // camera.position.set( selectedNode.x, selectedNode.y + 50, selectedNode.z )

    // trying differentperspectives
    // camera.position.set( node.position.x, node.position.y + 10, node.position.z-3 )
    let camdist = 50
    let newPos = new THREE.Vector3(node.position.x, node.position.y + camdist/2, node.position.z+camdist)

    let equal = camera.position.equals(newPos)

    if(equal){
        // the camera is already where it needs to be. So we should actuall go
        // to the next node
        updateCycle(controls)
        return
    }

    camera.position.copy( newPos )
    let lookTarget = node.getWorldPosition(node.position) 
    controls.lookAt( lookTarget )
    // controls.update(delta)

    // testing camera set position: this works!
    // if (controls.cycle === 0 ) return
    // camera.position.set( 0,0,0)
    // controls.update(delta)

    // let test = new THREE.Object3D()
    // test.position
    // let vec3 = new THREE.Vector3(1,2,3)
    // vec3.copy


}

function updateRaycast(controls){
    normalizedPointer.x = ( pointer.x / window.innerWidth ) * 2 - 1;
    normalizedPointer.y = - ( pointer.y / window.innerHeight ) * 2 + 1;

    raycaster.setFromCamera( normalizedPointer, hudcamera );
    const hudintersects = raycaster.intersectObjects( hudcamera.children, false)

    raycaster.setFromCamera( normalizedPointer, camera );
    const intersects = raycaster.intersectObjects( universe.children, false )
    
    if ( intersects.length > 0 ) {
        intersected = intersects[0]
    } else {
        intersected = null;
    }
}

function updateSelectedNote(controls){
    if (controls.pointerUpThisFrame && intersected && selected?.intersected !== intersected){
        // teardown current selection
        if(selected){
            // teardown
            let mesh = selected.intersected.object
            // mesh.scale.set(1,1,1)
            mesh.rotation.y = 0
            mesh.rotation.x = 0
            mesh.material = bookmarkedEvents.hasOwnProperty(mesh.userData.event.id) ? bookmarkedMaterial : visitedMaterial
            nodeConnectors.forEach(n =>{
                n.geometry.dispose()
                scene.remove(n)
            })
            nodeConnectors = []
        }

        // buildup new selection
        let mesh = intersected.object
        let event = mesh.userData?.event

        if( event ){
            // save cache of read events
            readEvents[event.id] = event.simhash

            augUIModal(event,mesh)
        }

        selected = {
            intersected,
        }

        // connect root notes to replies, or reply to the root note
        showThread(event)

    }
}

function updateUniverse(controls){
    const scaleFactor = 0.1
    const scaleMin = 0.05
    const scaleMax = 10
    let scalar = null
    if(controls.cycle<0){
        scalar = 1 - scaleFactor
    }
    if(controls.cycle>0){
        scalar = 1 + scaleFactor
    }
    if(scalar){
        let oldScale = universe.scale.x
        let newScale = oldScale * scalar
        if(newScale < scaleMin || newScale > scaleMax) return
        universe.scale.set(newScale,newScale,newScale)
        universe.children.forEach(c => c.scale.set(1/newScale,1/newScale,1/newScale))
        // console.log('scale',newScale)
    }
}

function scaleNotes(){

    const frustum = new THREE.Frustum().setFromProjectionMatrix( new THREE.Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ) );

    const visibleObjects = []
    scene.traverse( node => {
        // console.log(node)
        if( node.isMesh && node.parent === universe && ( frustum.containsPoint( node.position ) || frustum.intersectsObject( node ) )){
            visibleObjects.push( node )
        }
    })

    let rescaleThresh = 1000

    // scale
    visibleObjects.forEach( mesh => {
        let dist = camera.position.distanceTo(mesh.position)
        if(!mesh.userData.scaledAt || (mesh.userData.scaledAt && Math.abs(dist-mesh.userData.scaledAt) > rescaleThresh)){
        mesh.scale.set(scale,scale,scale)
            // store what distance we scaled the mesh at and then only scale it again if the distance changes significantly.
            mesh.userData.scaledAt = dist
            console.log('scale',Math.random())
        }
    })

}

function animateReticle(delta) {
    if(!reticle) return

    reticle.position.set(pointer.x-w/2,h/2-pointer.y)

    // console.log(pointer.x-w/2, h/2-pointer.y)

    if(intersected){
        // console.log(intersected)
        if( controls.pointerXdelta == 0 && controls.pointerYdelta == 0){
            // spin
            reticle.material.rotation += 5 * delta
        }
        if( controls.mouseDragOn ){
            // scale reticle to indicate click
            // let scalenum = Math.min(1.5,reticle.scale.x * 1.01)
            // console.log(reticle.scale)
            // reticle.scale.set(scalenum, scalenum, scalenum)
        }
    } else {
        // unwind
        reticle.material.rotation *= 0.9
        if (Math.abs(reticle.material.rotation) < 0.0001) reticle.material.rotation = 0
    }
}

function animateSelectedNote(){
    // animate & fx for note data

    // highlight note block
    if( !selected?.intersected?.object ) return

    let deg = Math.PI/180
    let angle45 = deg * 45

    let mesh = selected.intersected.object

    // mesh.scale.set(2,2,2)
    mesh.rotation.y += 2 * delta
    mesh.rotation.x += 1 * delta
    mesh.material = bookmarkedEvents.hasOwnProperty(mesh.userData.event.id) ? expandedBookmarkedCubeMaterial : expandedCubeMaterial  

}

/**
 * @param {THREE.Vector3} a - mesh 1 position
 * @param {THREE.Vector3} b - mesh 2 position
 */
function connectNotes(a,b,mat = connectToRoot){
    let points = []
    points.push(a)
    points.push(b)
    let lineGeom = new THREE.BufferGeometry().setFromPoints(points)
    let line = new THREE.Line(lineGeom, mat)
    scene.add(line)
    nodeConnectors.push(line)
}

function showThread(event){
    if(event){
        // console.log(event.id,event.tags)
        let rootEvent = event.tags[0] && event.tags[0][0] === "e" && event.tags[0][1] ? event.tags[0][1] : false
        if(rootEvent && isLoaded(rootEvent)){
            // connect activated event cube to root event
            connectNotes(selected.intersected.object.position,loadedEvents[rootEvent].noteMesh.position)
        }
        if(!rootEvent && ( event.tags?.length==0 || (event.tags[0] && event.tags[0][0] !== "e"))){
            // console.log('checking for replies to',event.id)
            // see if there are replies
            let replies = Object.keys(loadedEvents).map(e => loadedEvents[e]).filter(e => e.tags[0] && e.tags[0][1] && e.tags[0][1] === event.id)
            replies.forEach(r => connectNotes(selected.intersected.object.position, r.noteMesh.position,connectToReplies))
            // console.log('replies',replies)
        }
    }
}

function augUIModal(event,mesh) {
    let message = `event:${event.id}\n\n${event.content}\n\npubkey:${event.pubkey.trim()}\n\n[${mesh.position.x}x]\n[${mesh.position.y}y]\n[${mesh.position.z}z]`
    teardownAugUIModal()
    modal = document.createElement('div')
    modal.classList.add('dom-ui')
    modal.id = 'aug-modal'
    modal.setAttribute('data-augmented-ui','')
    let app = document.querySelector('#app')
    app.appendChild(modal)
    modalMessage = document.createElement('div')
    modalMessage.classList.add('message')
    modalMessage.textContent = message
    modalMessage.addEventListener('wheel',function(e){
        // mousewheel scrolling without a scrollbar for modal
        let scrollSpeed = 30
        let currentScroll = parseInt(e.target.dataset.scroll) || 0
        let scrollDirection = Math.sign(e.deltaY) * scrollSpeed
        let newScroll = currentScroll-scrollDirection
        let buffer = 100 //pixel buffer so we can see the whole message

        // don't allow us to scroll up farther than the content (backwards)
        if (newScroll > 0) return;
        
        // don't allow us to completely past the content (too far)
        let parent = document.getElementById('aug-modal')
        if (parent.clientHeight - newScroll > e.target.clientHeight + buffer ) return;

        // update
        e.target.setAttribute('data-scroll',newScroll)
        e.target.style.transform = `translateY(${newScroll}px)`
        return false;
    })
    modal.appendChild(modalMessage)
    let modalClose = document.createElement('div')
    modalClose.id = 'modal-close'
    modalClose.classList.add('button')
    modalClose.setAttribute('data-augmented-ui','tl-clip tr-clip br-clip bl-clip')
    modalClose.textContent = 'dismiss'
    modalClose.addEventListener('click',function(){
        teardownAugUIModal()
    })
    modal.appendChild(modalClose)

    // bookmark button
    bookmarkButton = document.createElement('div')
    // bookmarkButton.classList.add('dom-ui')
    bookmarkButton.id = 'bookmark'
    bookmarkButton.classList.add('button')
    if(isBookmarked(event.id)) bookmarkButton.classList.add('set')
    bookmarkButton.setAttribute('data-augmented-ui','')
    bookmarkButton.addEventListener('click',function(){
        // console.log('bmclick')
        if (isBookmarked(event.id)){
            // console.log('removing')
            removeBookmark(event.id)
            bookmarkButton.classList.remove('set')
        } else {
            addBookmark(event)
            bookmarkButton.classList.add('set')
        }
    })
    modal.appendChild(bookmarkButton)

}
function teardownAugUIModal(){
    let modal = document.querySelector('#aug-modal')
    if(modal) document.querySelector('#app').removeChild(modal)
}

function isLoaded(eventID){
    return loadedEvents.hasOwnProperty(eventID)
}

function isBookmarked(eventID){
    return bookmarkedEvents.hasOwnProperty(eventID)
}

function removeBookmark(eventID){
    delete bookmarkedEvents[eventID]
    return updateBookmarkCache()
}

function addBookmark(event){
    let eventCopy = Object.assign({},event)
    delete eventCopy.noteMesh // we don't want to store this mesh data in localStorage
    bookmarkedEvents[event.id] = eventCopy
    return updateBookmarkCache()
}

function updateBookmarkCache(){
    let stored = JSON.stringify(bookmarkedEvents)
    try {
        localStorage.setItem('bookmarks',stored)
    } catch(e){
        console.error(e)
        return false //failed to save
    }
    return true //success
}

function cacheEvent(event){
    if (isLoaded(event.id)){
        // event already exists. skip it.
        // noop
        return false
    } else {
        // event was new. cache it.
        loadedEvents[event.id] = event
        if (pubkeys.hasOwnProperty(event.pubkey)){
            pubkeys[event.pubkey].push(event.id)
        } else {
            pubkeys[event.pubkey] = [event.id]
        }
        // go create event now
        return true
    }
}

export const visualizeNote = (event,coords) => {
    if (!cacheEvent(event)) return
    let mat = whiteMaterial
    if (isBookmarked(event.id)){
        mat = bookmarkedMaterial
    }
    const noteMesh = new THREE.Mesh(noteGeometry,mat)
    noteMesh.userData['event'] = event
    noteMesh.position.set(
        coords[0],
        coords[1],
        coords[2],
    )
    event.noteMesh = noteMesh
    universe.add(noteMesh)
}

export function getEventsList() {
    return Object.keys(loadedEvents).length
}
