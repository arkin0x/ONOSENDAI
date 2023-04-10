import * as THREE from 'three'
import { NIC } from './NIC'
import { simhash, embedNumber3D, downscale } from './simhash'
import { FirstPersonControls } from './FirstPersonControls'
import { colors, whiteMaterial, expandedCubeMaterial, expandedBookmarkedCubeMaterial, connectToRoot, visitedMaterial, sunMaterial, connectToReplies, bookmarkedMaterial, speedLineMaterial, sectorLineMaterial } from './materials'
import { noteGeometry } from './geometry'
import reticleImage from './reticle-mouse.png'
import logoImage from './logo-cropped.png'
import purify from 'dompurify'
import urlRegex from 'url-regex'
import { timer } from './utils'
import { sectorLineData } from './sectorLineData'
const urlRegx = urlRegex()

// Initialize network interface controller
const { pool, relays } = NIC()

let subs = 0

// listen for notes
function requestKind1Events(quantity=Infinity){
    if(subs > 0) return
    let sub = pool.sub(relays, [{ kinds: [1] }])
    subs++
    let received = 0
    sub.on('event',function (event) {
        let stopTimer = timer()
        received++
        let semanticHash = simhash(event.content)
        let semanticCoordinate = embedNumber3D(semanticHash.hash)
        let downscaledSemanticCoordinate = downscale(semanticCoordinate, WORLD_DOWNSCALE)
        event.simhash = semanticHash.hex
        event.coords = downscaledSemanticCoordinate
        // visualizeNote(event,downscaledSemanticCoordinate)
        storeEventBySectorAddress(event)

        if (received >= quantity){
            sub.unsub()
            subs--
        }
        asyncTime += stopTimer()
    })
    // return function to unlisten
    return function(){
        sub.unsub()
        subs--
    }
}

// we downscale the coordinates:
// 2^85 - 2^71 = 2^14 (16384)
// because otherwise there is too much empty space
export const WORLD_DOWNSCALE = 2n ** 65n
export const WORLD_SCALE = Number((2n ** 85n) / WORLD_DOWNSCALE)
export const MOBILE_WIDTH = 576
const MAX_FRAME_TIME = 32 // ~30FPS

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
let textureloader
let controls
let reticle
let bookmarkButton, bookmarkButtonPosition, bookmarkLerp
let logo
let speedLines, speedUI, speedLineCount, speedLinesNearDist, speedLinesFarDist

let sectorLines, sectorUI, lastSector

let frame

let app, modal, modalMessage, ccs

let intersected
let selected

// indexeddb
let db

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

let nodeConnectors

let lilgrid

let sector, loadZone

let scanTasks, taskTimings, timeBudget, asyncTime

const TASK_TIMING_REDUCE = 1

let startTimeStamp

init()
animate()

function init() {

    // keep track of when we started the application so we can request notes from earlier than this. TODO wait, isn't there a browser api for this?
    startTimeStamp = +new Date()

    frame = 0n

    lastSector = { address: false } // compared in animate()

    w = window.innerWidth
    h = window.innerHeight

    layout = w > MOBILE_WIDTH ? "desktop" : "mobile"

    // noteSpriteDisplayWidth = w < 680 ? w-40 : w/4
    bookmarkButtonPosition = new THREE.Vector2(
        layout == "desktop" ? -noteSpriteDisplayWidth + 20 : -(w / 2),
        layout == "desktop" ? (h / 2) - 20 : -(h / 2)
    )

    clock = new THREE.Clock()

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000000)
    camera.position.set(0, 0, 0)
    scene = new THREE.Scene()
    // scene.fog = new THREE.Fog( "#160621", 1, WORLD_SCALE*0.75)
    scene.fog = new THREE.Fog("#160621", 1, WORLD_SCALE * 0.33)
    scene.add(camera)

    hudcamera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.001, 1000)
    hudscene = new THREE.Scene()
    hudscene.add(hudcamera)

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2()
    normalizedPointer = new THREE.Vector2()

    renderer = new THREE.WebGLRenderer()
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    renderer.autoClear = false
    document.querySelector('#app').appendChild(renderer.domElement)

    // event listeners
    window.addEventListener('resize', onWindowResize)

    textureloader = new THREE.TextureLoader()
    textureloader.load(reticleImage, setupReticle)
    // textureloader.load( bookmarkImage, setupBookmark )
    textureloader.load(logoImage, setupOrtho)


    function setupReticle(tex) {
        // test screen coordinate proxy sprite
        // let spr = new THREE.Sprite(new THREE.SpriteMaterial({map: tex}))
        // spr.scale.set( 50, 50, 1)
        // spr.center.set(0.5,0.5)
        // spr.position.set(-w/2*.9,-h/2*.9,-20)
        // hudcamera.add(spr)
        let material = new THREE.SpriteMaterial({ map: tex })
        material.color.set('yellow')
        let width = material.map.image.width
        let height = material.map.image.height
        reticle = new THREE.Sprite(material)
        reticle.center.set(0.5, 0.5)
        reticle.scale.set(50, 50, 1)
        hudcamera.add(reticle)
        reticle.position.set(0, 0, -2)
        renderer.domElement.addEventListener('mouseleave', function () {
            reticle.visible = false
        })
        renderer.domElement.addEventListener('mouseenter', function () {
            reticle.visible = true
        })
    }
    function setupBookmark(tex) {
        let material = new THREE.SpriteMaterial({ map: tex })
        material.color.set(colors.LOGO_PURPLE)
        let width = material.map.image.width
        let height = material.map.image.height
        bookmarkButton = new THREE.Sprite(material)
        bookmarkButton.visible = false
        bookmarkButton.center.set(0, 1)
        bookmarkButton.scale.set(width / 8, height / 8, 1)
        hudcamera.add(bookmarkButton)
        bookmarkButton.position.set(bookmarkButtonPosition.x, bookmarkButtonPosition.y, -3)
    }
    function setupOrtho(tex) {
        // logo
        let material = new THREE.SpriteMaterial({ map: tex })
        let width = material.map.image.width
        let height = material.map.image.height
        let ratio = height / width
        let logoSize = Math.min(w / 3, 250) //screen width/4
        logo = new THREE.Sprite(material)
        logo.center.set(1, 1)
        logo.scale.set(logoSize, logoSize * ratio, 1)
        hudcamera.add(logo)
        logo.position.set(w / 2 - 16, -h / 2 + logoSize * ratio + 16, -1)

        // hud compass
        let compassSize = Math.min(w / 6, logoSize * (1 / 2))
        lilgrid = new THREE.Group()
        // top pink grid
        let a = new THREE.GridHelper(1, 5, colors.LOGO_PURPLE, colors.LOGO_PURPLE)
        // bottom blue grid
        let b = new THREE.GridHelper(1, 5, colors.LOGO_BLUE, colors.LOGO_BLUE)
        // middle black plane
        let p = new THREE.PlaneGeometry(1.05, 1.05)
        let pm = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
        let pl = new THREE.Mesh(p, pm)
        const lilsunGeometry = new THREE.CircleGeometry(0.25, 32);
        const lilsun = new THREE.Mesh(lilsunGeometry, sunMaterial)
        lilsun.position.z -= 0.65
        pl.rotateX(-Math.PI / 2)
        pl.position.y -= 0.01
        b.position.y -= 0.02
        lilgrid.add(a)
        lilgrid.add(pl)
        lilgrid.add(b)
        lilgrid.add(lilsun)
        lilgrid.position.set(w / 2 - logoSize / 2, h / 2 - compassSize * (3 / 4), -compassSize * 2)
        lilgrid.scale.set(compassSize, compassSize, compassSize)
        hudcamera.add(lilgrid)
        lilgrid.setRotationFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()).invert())
    }

    // setup cyberspace coordinate system readout
    ccs = document.createElement('div')
    ccs.classList.add('dom-ui')
    ccs.id = 'aug-ccs'
    ccs.setAttribute('data-augmented-ui', '')
    app = document.querySelector('#app')
    app.appendChild(ccs)

    // setup sector lines
    sectorLines = []
    sectorUI = new THREE.Group()
    for (const l in sectorLineData) {
        let a = new THREE.Vector3().fromArray(sectorLineData[l][0])
        let b = new THREE.Vector3().fromArray(sectorLineData[l][1])
        sectorLines.push(createLine(a, b, sectorUI, sectorLineMaterial))
    }
    scene.add(sectorUI)

    // setup speed lines
    speedLines = []
    speedLinesNearDist = 8,
        speedLinesFarDist = -10
    speedLineCount = 2
    let speedUIScale = 0.33 // 33% of screen
    let speedUISize = Math.min(w, h) * speedUIScale // width and height, it's square
    speedUI = new THREE.Group()
    let topVec = new THREE.Vector3()
    topVec.copy(camera.position)
    topVec.y += 0.2
    topVec.z = speedLinesFarDist
    let botVec = new THREE.Vector3()
    botVec.copy(camera.position)
    botVec.y -= 0.2
    botVec.z = speedLinesFarDist
    let speedLineHalf = speedLineCount / 2
    let speedLineOffsetStart = 0 - speedLineHalf
    let speedLineOffsetEnd = speedLineCount - speedLineHalf
    for (let i = speedLineOffsetStart; i <= speedLineOffsetEnd; i++) {
        let xoffset = -1
        if (i < 0) xoffset = -1
        if (i == 0) continue
        if (i > 0) xoffset = 1
        let t = new THREE.Vector3()
        t.copy(topVec)
        // t.x += i/10 + xoffset
        t.x = xoffset
        t.z += Math.abs(i / 1)
        let b = new THREE.Vector3()
        b.copy(botVec)
        // b.x += i/10 + xoffset
        b.x = xoffset
        b.z += Math.abs(i / 1)
        speedLines.push(createLine(t, b, speedUI))
    }
    camera.add(speedUI)


    // scene objects
    universe = new THREE.Group()
    scene.add(universe)

    // ambient light for whole scene
    const ambientLight = new THREE.AmbientLight(0x999999, 1)
    scene.add(ambientLight);

    // cyberpunk style left/right lights
    const environmentLightLeft = new THREE.DirectionalLight(colors.ENVIRONMENT_LEFT_COLOR, 0.8);
    environmentLightLeft.position.set(1, 1, 1);
    scene.add(environmentLightLeft);
    const environmentLightRight = new THREE.DirectionalLight(colors.ENVIRONMENT_RIGHT_COLOR, 0.8);
    environmentLightRight.position.set(-1, -1, -1);
    scene.add(environmentLightRight);

    // gridhelper
    const grid = new THREE.GridHelper(WORLD_SCALE, 100, colors.LOGO_PURPLE, colors.LOGO_PURPLE)
    grid.position.set(0, -(WORLD_SCALE) / 2, 0)
    scene.add(grid)

    const gridtop = new THREE.GridHelper(WORLD_SCALE, 100, colors.LOGO_BLUE, colors.LOGO_BLUE)
    gridtop.position.set(0, (WORLD_SCALE) / 2, 0)
    scene.add(gridtop)

    //sun
    const sunGeometry = new THREE.CircleGeometry(2000000, 64);
    const sun = new THREE.Mesh(sunGeometry, sunMaterial)
    sun.position.set(0, -1000, -10000000)
    scene.add(sun)

    // camera objects
    // operator light - attached to camera
    const OPERATOR_LAMP_STRENGTH = 0.65
    const operatorLampLeft = new THREE.PointLight(colors.LEFT_LAMP_COLOR, OPERATOR_LAMP_STRENGTH, 100, 1)
    const operatorLampCenter = new THREE.PointLight(colors.CENTER_LAMP_COLOR, OPERATOR_LAMP_STRENGTH, 500, 1)
    const operatorLampRight = new THREE.PointLight(colors.RIGHT_LAMP_COLOR, OPERATOR_LAMP_STRENGTH, 100, 1)
    operatorLampLeft.position.set(-5, 0, -2)
    operatorLampCenter.position.set(0, 0, -2)
    operatorLampRight.position.set(5, 0, -2)
    camera.add(operatorLampLeft)
    camera.add(operatorLampCenter)
    camera.add(operatorLampRight)

    // camera controls
    controls = new FirstPersonControls(camera, renderer.domElement)
    controls.mobile = layout == "mobile" ? true : false
    controls.accel = 1
    controls.lookSpeed = 0.25
    controls.rotateSpeed = 1.0
    controls.zoomSpeed = 1.2
    controls.panSpeed = 1.8

    loadedEvents = {}
    bookmarkedEvents = JSON.parse(localStorage.getItem('bookmarks')) || {}
    readEvents = {}
    pubkeys = {}

    nodeConnectors = []

    sector = getSector(camera.position.x, camera.position.y, camera.position.z)
    loadZone = [sector.address, ...getAdjacentSectors(sector.x, sector.y, sector.z)]

    /**
        prioritize synchronous tasks first because we have budget for them this frame
        'visualizeNote', // sync
        'visualizePresence', // sync
        'requestNote',// async cost
        'loadNote', // async cost
        'requestPresence', // async cost
        'loadPresence', // async cost
    */
    scanTasks = 'visualizeNote,visualizePresence,requestPresence,loadPresence,requestNote,loadNote'

    taskTimings = {
        scan: {},
        burst: {
            castVortex: 0,
            castBubble: 0,
            castDerezz: 0,
            generateArmor: 0,
            generateStealth: 0,
            respondPOWChallenge: 0,
        },
        drive: {
            generatePOW: [0, 0, 0], // Array for different leading zeroes, 0 index is 1 leading zero.
        },
    }

    scanTasks.split(',').forEach(t => taskTimings.scan[t] = 0 )
}

function animate() {
    requestAnimationFrame(animate)
    render()
}

function render() {
    frame++

    delta = clock.getDelta()
    // console.log(asyncTime)
    // console.log('requestNote',taskTimings.scan.requestNote)

    // set baseline for frame time used by necessary functions
    let time = performance.now()
    timeBudget = 0

    // process necessary functions

    controls.update(delta, pointer)

    sector = getSector(camera.position.x, camera.position.y, camera.position.z)

    drawUI()

    if (sector.address !== lastSector.address) {
        loadZone = [sector.address, ...getAdjacentSectors(sector.x, sector.y, sector.z)]
    }

    lastSector = sector

    controls.postUpdate()

    let elapsed = performance.now()

    // process optional funtions
    timeBudget = MAX_FRAME_TIME - (elapsed - time) - asyncTime

    // need UI to manage these values
    const SCAN_BUDGET = 0.40
    const BURST_BUDGET = 0.30
    const DRIVE_BUDGET = 0.30

    if (SCAN_BUDGET * timeBudget > 0){
         performScanTasks(SCAN_BUDGET * timeBudget)
    } else {
        console.log('noscan budget')
    }

    // if (updateSectorNow) updateSector(SCAN_BUDGET * time_budget)

    // must manually clear to do multiple cameras
    renderer.clear()
    renderer.render(scene, camera)
    renderer.clearDepth()
    renderer.render(hudscene, hudcamera)

    asyncTime = 0
}


/**
 * requestNote - set up subscription to relays, request kind1 events. Async callback will store the received note in IndexedDB.
 * loadNote - query IndexedDB for a note within the current loadZone (current sector and 26 adjacent sectors). Async callback will load that note into a loaded array in memory.
 * visualizeNote - convert notes loaded into memory array into meshes in the scene.
 */

/**
 * Cycle through and perform each scan task until the scan task time budget is expended.
 * @param {Number} budget milliseconds (can be decimal)
 */
function performScanTasks(budget) {
    console.log('scan budget',budget)
    // redeclare this each iteration so that we start with the same prioritized tasks each frame.
    let tasks = scanTasks.split(',')

    // we detect if a task did not get its time recorded; this indicates
    // that the task was not run. This may have been for 2 reasons:
    // we simply ran out of time, or the previous time the task was run
    // it took an unusually long amount of time and now the estimate is too
    // high! If a task time is not recorded by the end of this function, we
    // reduce the task time slightly so that anomalous task timings don't stay
    // permanent and stop running altogether.
    let taskTimeRecorded = {}
    tasks.forEach(t => taskTimeRecorded[t] = false )

    // take current time
    let start = performance.now()

    // loop through tasks as long as this function stays under our time budget;
    // previous timings on tasks inform as to whether we can fit it into what is left of our time budget each iteration.
    while (performance.now() - start + taskTimings.scan[tasks[0]] < budget) {
        const task = tasks[0]
        switch (task) {
            case 'requestNote':
                requestKind1Events(200)
                break;
            case 'loadNote':
                // TODO
                break;
            case 'visualizeNote':
                // TODO
                break;
            case 'requestPresence':
                // TODO
                break;
            case 'loadPresence':
                // TODO
                break;
            case 'visualizePresence':
                // TODO
                break;
            default:
                break;
        }

        // record timing
        taskTimings.scan[task] = performance.now() - start
        taskTimeRecorded[task] = true

        // loop to next task
        tasks.push(tasks.shift())
    }

    // adjust downward any task timings of tasks that did not get run
    for(const t in taskTimeRecorded){
        if (taskTimeRecorded[t]) continue
        taskTimings.scan[t] = Math.max(0, taskTimings.scan[t] - TASK_TIMING_REDUCE)
        // if(t === 'requestNote') console.log('requestNote 👇')
    }
}

function drawUI() {
    updateRaycast(controls)
    updateSelectedNote(controls)

    scaleNotes() // farther notes get larger. may not be necessary with new caching?
    animateReticle(delta)
    animateSelectedNote()
    animateSpeedLines(controls)

    // minimap
    lilgrid?.setRotationFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()).invert())

    animateSector(sector, controls)

    ccs.innerHTML = `<span>[</span>${Math.floor(camera.position.x)}x<span>][</span>${Math.floor(camera.position.y)}y<span>][</span>${Math.floor(camera.position.z)}z<span>]</span><br/><span>Sector ${sector.address}</span>`
}

/**
 * Draw the box around the current sector you are in.
 * @param {object} sector 
 */
function animateSector(sector, controls) {
    let { dx, dy, dz } = controls
    let speed = (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) / 3
    sectorLines.forEach(c => {
        c.material.opacity = Math.max(0, Math.min(1, 1 - (speed - 30) / 10))
    })
    let center = getSectorCenter(sector)
    let centerVec3 = new THREE.Vector3().fromArray(center)
    sectorUI.position.copy(centerVec3)
}

function getSectorCenter(sector) {
    const sectorSize = 4096
    let x = sector.x * sectorSize - 2 ** 19
    let y = sector.y * sectorSize - 2 ** 19
    let z = sector.z * sectorSize - 2 ** 19
    return [x, y, z]
}

function getAdjacentSectors(x, y, z) {
    const adjacentSectors = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dy === 0 && dz === 0) continue; // skip the current sector

                const newX = x + dx;
                const newY = y + dy;
                const newZ = z + dz;

                if (newX >= 0 && newX <= 255 && newY >= 0 && newY <= 255 && newZ >= 0 && newZ <= 255) {
                    adjacentSectors.push(`${newX}-${newY}-${newZ}`);
                }
            }
        }
    }
    return adjacentSectors;
}

/**
 * Update which sectors events should be loaded from. The current sector and the 26 adjacent sectors are valid (9 * 3); the rest should begin unloading events. This should be done gradually to avoid CPU spikes.
 * @param {object} sector 
 */
function updateSector() {
    let loadSectors = [sector.address, ...getAdjacentSectors(sector.x, sector.y, sector.z)]

    loadSectors.forEach(s => {
        (async () => {
            const sectorAddress = s
            let lastEventId;

            while (true) {
                const { events, lastEventId: newLastEventId } = await getEventsBySectorAddress(sectorAddress, lastEventId);
                if (events.length === 0) {
                    // console.log("No more events");
                    break;
                }

                events.forEach(e => visualizeNote(e, e.coords))

                lastEventId = newLastEventId;
            }
        })();
    })
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

    renderer.setSize(w, h)

    controls.handleResize()

}

function updateRaycast(controls) {
    normalizedPointer.x = (pointer.x / window.innerWidth) * 2 - 1;
    normalizedPointer.y = - (pointer.y / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(normalizedPointer, hudcamera);
    const hudintersects = raycaster.intersectObjects(hudcamera.children, false)

    raycaster.setFromCamera(normalizedPointer, camera);
    const intersects = raycaster.intersectObjects(universe.children, false)

    if (intersects.length > 0) {
        intersected = intersects[0]
    } else {
        intersected = null;
    }
}

function updateSelectedNote(controls) {
    if (controls.mouseUpThisFrame && intersected && selected?.intersected !== intersected) {
        // teardown current selection
        if (selected) {
            // teardown
            let mesh = selected.intersected.object
            // mesh.scale.set(1,1,1)
            mesh.rotation.y = 0
            mesh.rotation.x = 0
            mesh.material = bookmarkedEvents.hasOwnProperty(mesh.userData.event.id) ? bookmarkedMaterial : visitedMaterial
            nodeConnectors.forEach(n => {
                n.geometry.dispose()
                scene.remove(n)
            })
            nodeConnectors = []
        }

        // buildup new selection
        let mesh = intersected.object
        let event = mesh.userData?.event

        if (event) {
            // save cache of read events
            readEvents[event.id] = event.simhash

            augUIModal(event, mesh)
        }

        selected = {
            intersected,
        }

        // connect root notes to replies, or reply to the root note
        showThread(event)

    }
}

function updateUniverse(controls) {
    const scaleFactor = 0.1
    const scaleMin = 0.05
    const scaleMax = 10
    let scalar = null
    if (controls.cycle < 0) {
        scalar = 1 - scaleFactor
    }
    if (controls.cycle > 0) {
        scalar = 1 + scaleFactor
    }
    if (scalar) {
        let oldScale = universe.scale.x
        let newScale = oldScale * scalar
        if (newScale < scaleMin || newScale > scaleMax) return
        universe.scale.set(newScale, newScale, newScale)
        universe.children.forEach(c => c.scale.set(1 / newScale, 1 / newScale, 1 / newScale))
    }
}

function scaleNotes() {

    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

    const visibleObjects = []
    scene.traverse(node => {
        if (node.isMesh && node.parent === universe && (frustum.containsPoint(node.position) || frustum.intersectsObject(node))) {
            visibleObjects.push(node)
        }
    })

    // scale
    visibleObjects.forEach(mesh => {
        let dist = camera.position.distanceTo(mesh.position)
        let scale = 1
        if (dist > 2 ** 12) scale = dist ** 2 / 1_000_000_000
        mesh.scale.set(scale, scale, scale)
    })

}

function animateReticle(delta) {
    if (!reticle) return

    reticle.position.set(pointer.x - w / 2, h / 2 - pointer.y)

    if (intersected) {
        if (controls.mouseXdelta == 0 && controls.mouseYdelta == 0) {
            // spin
            reticle.material.rotation += 5 * delta
        }
        if (controls.dragging) {
            // scale reticle to indicate click
            // let scalenum = Math.min(1.5,reticle.scale.x * 1.01)
            // reticle.scale.set(scalenum, scalenum, scalenum)
        }
    } else {
        // unwind
        reticle.material.rotation *= 0.9
        if (Math.abs(reticle.material.rotation) < 0.0001) reticle.material.rotation = 0
    }
}

function animateSelectedNote() {
    // animate & fx for note data

    // highlight note block
    if (!selected?.intersected?.object) return

    let deg = Math.PI / 180
    let angle45 = deg * 45

    let mesh = selected.intersected.object

    // mesh.scale.set(2,2,2)
    mesh.rotation.y += 2 * delta
    mesh.rotation.x += 1 * delta
    mesh.material = bookmarkedEvents.hasOwnProperty(mesh.userData.event.id) ? expandedBookmarkedCubeMaterial : expandedCubeMaterial

}

function animateSpeedLines(controls) {
    let { dx, dy, dz } = controls
    let speed = dz
    speedLines.slice(0, 2).forEach(l => {
        l.material.opacity = Math.abs(speed) < 200 ? Math.min(Math.max(0.25 + Math.abs(speed / 10), 0.25), 1) : Math.min(1, Math.max(200 / Math.abs(speed), 0.15))
        l.position.z += -dz / 100
        if (l.position.z > speedLinesNearDist) {
            let rem = speedLinesNearDist - l.position.z
            l.position.z = speedLinesFarDist - rem
        }
        if (l.position.z < speedLinesFarDist) {
            let rem = speedLinesFarDist - l.position.z
            l.position.z = speedLinesNearDist - rem
        }
    })
}

/**
 * @param {THREE.Vector3} a - mesh 1 position
 * @param {THREE.Vector3} b - mesh 2 position
 */
function connectNotes(a, b, mat = connectToRoot) {
    let points = []
    points.push(a)
    points.push(b)
    let lineGeom = new THREE.BufferGeometry().setFromPoints(points)
    let line = new THREE.Line(lineGeom, mat)
    scene.add(line)
    nodeConnectors.push(line)
}


/**
 * @param {THREE.Vector3} a - mesh 1 position
 * @param {THREE.Vector3} b - mesh 2 position
 */
function createLine(a, b, group, mat = speedLineMaterial) {
    let points = []
    points.push(a)
    points.push(b)
    let lineGeom = new THREE.BufferGeometry().setFromPoints(points)
    let line = new THREE.Line(lineGeom, mat)
    if (group) group.add(line)
    return line
}


function showThread(event) {
    if (event) {
        let rootEvent = event.tags[0] && event.tags[0][0] === "e" && event.tags[0][1] ? event.tags[0][1] : false
        if (rootEvent && isLoaded(rootEvent)) {
            // connect activated event cube to root event
            connectNotes(selected.intersected.object.position, loadedEvents[rootEvent].noteMesh.position)
        }
        if (!rootEvent && (event.tags?.length == 0 || (event.tags[0] && event.tags[0][0] !== "e"))) {
            // see if there are replies
            let replies = Object.keys(loadedEvents).map(e => loadedEvents[e]).filter(e => e.tags[0] && e.tags[0][1] && e.tags[0][1] === event.id)
            replies.forEach(r => connectNotes(selected.intersected.object.position, r.noteMesh.position, connectToReplies))
        }
    }
}

function augUIModal(event, mesh) {
    let content = event.content;
    if (urlRegx.test(content)) {
        content = content.replace(urlRegx, (matchedUrl) => {
            if (matchedUrl && matchedUrl.startsWith('https')) {
                return `<a target="_blank" href="${matchedUrl}" rel="noopener noreferrer">${matchedUrl}</a>`;
            } else {
                return matchedUrl;
            }
        });
    }
    const id = event.id
    const pub = event.pubkey.trim()
    const unsafeMessage = `event:${id}\n\n${content}\n\npubkey:${pub}\n\n[${mesh.position.x}x]\n[${mesh.position.y}y]\n[${mesh.position.z}z]`
    teardownAugUIModal()
    modal = document.createElement('div')
    modal.classList.add('dom-ui')
    modal.id = 'aug-modal'
    modal.setAttribute('data-augmented-ui', '')
    let app = document.querySelector('#app')
    app.appendChild(modal)
    modalMessage = document.createElement('div')
    modalMessage.classList.add('message')
    modalMessage.innerHTML = purify.sanitize(unsafeMessage, {
        ADD_ATTR: ['target'],
    })
    modalMessage.addEventListener('wheel', function (e) {
        // mousewheel scrolling without a scrollbar for modal
        let scrollSpeed = 30
        let currentScroll = parseInt(modalMessage.dataset.scroll) || 0
        let scrollDirection = Math.sign(e.deltaY) * scrollSpeed
        let newScroll = currentScroll - scrollDirection
        let buffer = 100 //pixel buffer so we can see the whole message

        // don't allow us to scroll up farther than the content (backwards)
        if (newScroll > 0) return;

        // don't allow us to completely past the content (too far)
        let parent = document.getElementById('aug-modal')
        if (parent.clientHeight - newScroll > modalMessage.clientHeight + buffer) return;

        // update
        modalMessage.setAttribute('data-scroll', newScroll)
        modalMessage.style.transform = `translateY(${newScroll}px)`
        return false;
    }, { capture: true })
    modal.appendChild(modalMessage)
    let modalClose = document.createElement('div')
    modalClose.id = 'modal-close'
    modalClose.classList.add('button')
    modalClose.setAttribute('data-augmented-ui', 'tl-clip tr-clip br-clip bl-clip')
    modalClose.textContent = 'dismiss'
    modalClose.addEventListener('click', function () {
        teardownAugUIModal()
    })
    modal.appendChild(modalClose)

    // bookmark button
    bookmarkButton = document.createElement('div')
    // bookmarkButton.classList.add('dom-ui')
    bookmarkButton.id = 'bookmark'
    bookmarkButton.classList.add('button')
    if (isBookmarked(event.id)) bookmarkButton.classList.add('set')
    bookmarkButton.setAttribute('data-augmented-ui', '')
    bookmarkButton.addEventListener('click', function () {
        if (isBookmarked(event.id)) {
            removeBookmark(event.id)
            bookmarkButton.classList.remove('set')
        } else {
            addBookmark(event)
            bookmarkButton.classList.add('set')
        }
    })
    modal.appendChild(bookmarkButton)

}
function teardownAugUIModal() {
    let modal = document.querySelector('#aug-modal')
    if (modal) document.querySelector('#app').removeChild(modal)
}

function isLoaded(eventID) {
    return loadedEvents.hasOwnProperty(eventID)
}

function isBookmarked(eventID) {
    return bookmarkedEvents.hasOwnProperty(eventID)
}

function removeBookmark(eventID) {
    delete bookmarkedEvents[eventID]
    return updateBookmarkCache()
}

function addBookmark(event) {
    let eventCopy = Object.assign({}, event)
    delete eventCopy.noteMesh // we don't want to store this mesh data in localStorage
    bookmarkedEvents[event.id] = eventCopy
    return updateBookmarkCache()
}

function updateBookmarkCache() {
    let stored = JSON.stringify(bookmarkedEvents)
    try {
        localStorage.setItem('bookmarks', stored)
    } catch (e) {
        console.error(e)
        return false //failed to save
    }
    return true //success
}

function cacheEvent(event) {
    if (isLoaded(event.id)) {
        // event already exists. skip it.
        // noop
        return false
    } else {
        // event was new. cache it.
        loadedEvents[event.id] = event
        if (pubkeys.hasOwnProperty(event.pubkey)) {
            pubkeys[event.pubkey].push(event.id)
        } else {
            pubkeys[event.pubkey] = [event.id]
        }
        // go create event now
        return true
    }
}

export const visualizeNote = (event, coords) => {
    if (!cacheEvent(event)) return
    let mat = whiteMaterial
    if (isBookmarked(event.id)) {
        mat = bookmarkedMaterial
    }
    const noteMesh = new THREE.Mesh(noteGeometry, mat)
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

function getSector(x, y, z) {
    const sectorSize = 4096
    const halfSpaceSize = 2 ** 19
    const numSectors = 256

    const xSector = Math.floor((x + halfSpaceSize) / sectorSize)
    const ySector = Math.floor((y + halfSpaceSize) / sectorSize)
    const zSector = Math.floor((z + halfSpaceSize) / sectorSize)

    // Clamp the values to the range [0, 255]
    const clampedX = Math.max(0, Math.min(xSector, numSectors - 1))
    const clampedY = Math.max(0, Math.min(ySector, numSectors - 1))
    const clampedZ = Math.max(0, Math.min(zSector, numSectors - 1))

    return {
        address: `${clampedX}-${clampedY}-${clampedZ}`,
        x: clampedX,
        y: clampedY,
        z: clampedZ
    }
}

export async function storeEventBySectorAddress(event) {
    if (!db) {
        await initializeDB();
    }

    const [x, y, z] = event.coords;
    const sector = getSector(x, y, z);
    const sectorAddress = sector.address
    const storeEvent = { ...event, sectorAddress };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["events"], "readwrite");
        const objectStore = transaction.objectStore("events");
        const request = objectStore.put(storeEvent);

        request.onsuccess = () => {
            console.log('event cached')
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function getEventsBySectorAddress(sectorAddress, lastEventId, count = 10) {
    if (!db) {
        await initializeDB();
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["events"], "readonly");
        const objectStore = transaction.objectStore("events");
        const index = objectStore.index("sectorAddress");

        // Use a key range to filter events by sectorAddress
        const keyRange = IDBKeyRange.only(sectorAddress);

        const request = index.openCursor(keyRange, "next");
        const events = [];
        let lastSeenId;

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                // If we have already seen the lastEventId, start collecting events
                if (lastSeenId === lastEventId || lastEventId === undefined) {
                    events.push(cursor.value);

                    // If we have collected the desired number of events, resolve the promise
                    if (events.length >= count) {
                        resolve({ events, lastEventId: cursor.primaryKey });
                        return;
                    }
                } else if (cursor.primaryKey === lastEventId) {
                    // We have found the lastEventId, set the flag
                    lastSeenId = lastEventId;
                }

                // Move to the next event in the index
                cursor.continue();
            } else {
                // No more events in the index, resolve with the events found
                resolve({ events, lastEventId: lastSeenId });
            }
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

window.gebsa = getEventsBySectorAddress
window.db = db

function initializeDB() {
    return new Promise((resolve, reject) => {
        const openRequest = indexedDB.open("NostrEventsDB", 3);

        openRequest.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("events")) {
                const objectStore = db.createObjectStore("events", { keyPath: "id" });
                objectStore.createIndex("sectorAddress", "sectorAddress", { unique: false });
            }
        };

        openRequest.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        openRequest.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


// // Example usage:
// const exampleEvent = {
//   coords: [-100000, 0, 100000],
//   // other event properties...
// };

// storeEventBySectorAddress(exampleEvent)
//   .then(() => console.log("Event stored successfully"))
//   .catch((error) => console.error("Error storing event:", error));
