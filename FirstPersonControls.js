// I stole this from Three.js and overrode it to make it work nicer.

import {
	MathUtils,
	Spherical,
	Vector3,
	Vector2
} from 'three';

const _lookDirection = new Vector3();
const _spherical = new Spherical();
const _target = new Vector3();
const NON_DRAG_DISTANCE = 5

class FirstPersonControls {

	constructor( object, domElement ) {

		this.object = object;
		this.domElement = domElement;

		// API

		this.enabled = true;

		// base acceleration
		this.accel = 1
		// increases while a button is held down
		this.accelMultiplier = 0
		this.decel = 0.90
		this.minx = 0.1
		this.dx = 0
		this.dy = 0
		this.dz = 0

		this.lookSpeed = 0.005;

		this.lookVertical = true;

		this.heightSpeed = false;
		this.heightCoef = 1.0;
		this.heightMin = 0.0;
		this.heightMax = 1.0;

		this.constrainVertical = false;
		this.verticalMin = 0;
		this.verticalMax = Math.PI;

		// internals

		this.autoSpeedFactor = 0.0;

		// touches
		let touchPoints = 0 // incremented or decremented on touchstart/touchend

		// this.mouse is used to provide mouse coords outside this object
		this.mouse = new Vector2(0,0)

		this.mouseDownThisFrame = false
		this.mouseDown = false
		this.dragging = false;
		this.mouseUpThisFrame = false

  this.mouseXinitial = 0
  this.mouseYinitial = 0
  this.mouseXdelta = 0
  this.mouseYdelta = 0
  this.deltaScalar = 1

		this.moveForward = false;
		this.moveBackward = false;
		this.moveLeft = false;
		this.moveRight = false;

		this.viewHalfX = 0;
		this.viewHalfY = 0;

		this.cycle = 0
		this.resetCycle = false

		// private variables

		let lat = 0;
		let lon = 0;

		//

		function logToPanel(data){
			let ccs = document.getElementById('aug-ccs')
			ccs.textContent = data
		}


		this.handleResize = function () {

			if ( this.domElement === document ) {

				this.viewHalfX = window.innerWidth / 2;
				this.viewHalfY = window.innerHeight / 2;

			} else {

				this.viewHalfX = this.domElement.offsetWidth / 2;
				this.viewHalfY = this.domElement.offsetHeight / 2;

			}

		};

		this.relativeCenter = function (x,y){
			let xy = {
				x: x - this.viewHalfX,
				y: y - this.viewHalfY,
			}
			return xy
		}

		this.onMouseDown = function ( event ) {
			if ( this.domElement !== document ) {
				this.domElement.focus();
			}

			this.mouseDownThisFrame = true
			this.mouseDown = true

			let {x,y} = this.relativeCenter(event.pageX, event.pageY)

			this.startDrag(x,y)

		};

		this.startDrag = function(x,y){
   this.mouseXinitial = x
   this.mouseYinitial = y
   this.mouseXdelta = this.mouseYdelta = 0
		}

		this.onMouseUp = function ( event ) {

			this.mouseUpThisFrame = true
			this.mouseDown = false

			this.endDrag()

		};

		this.endDrag = function(){
   this.mouseXinitial = 0
   this.mouseYinitial = 0
   this.mouseXdelta = this.mouseYdelta = 0

			this.dragging = false
		}

		this.onMouseMove = function ( event ) {

			// touches override so we don't conflict on devices that treat touches as mouse
			if( touchPoints ) return

			// report mouse for external use
			this.mouse.x = event.pageX
			this.mouse.y = event.pageY

			if( this.mouseDown ){
				let {x,y} = this.relativeCenter(event.pageX, event.pageY)

				this.drag(x,y)
			}

		};

		this.drag = function(x,y){
			if(Math.abs(this.mouseXinitial - x) < NON_DRAG_DISTANCE && Math.abs(this.mouseYinitial - y) < NON_DRAG_DISTANCE){
				return
			}
			this.dragging = true
   this.mouseXdelta = x - this.mouseXinitial
   this.mouseYdelta = y - this.mouseYinitial
		}

		this.onFingerDown = function ( event ) {

			touchPoints++

			if( touchPoints === 1 ){
				let tx = event.touches[0].pageX
				let ty = event.touches[0].pageY

				// report mouse for external use
				this.mouse.x = tx
				this.mouse.y = ty

				let {x,y} = this.relativeCenter(tx,ty)

				this.startDrag(x,y)
			}

		};

		this.onFingerUp = function ( event ) {

			touchPoints--

			if( touchPoints === 0 ) this.endDrag()

		};

		this.onFingerMove = function ( event ) {

			console.log(event)

			let touches = event.touches
			// let avgx = 0
			// let avgy = 0
			// for(let i = 0; i < touches.length; i++){
			// 	avgx += touches[i].pageX
			// 	avgy += touches[i].pageY
			// }
			// avgx /= touches.length
			// avgy /= touches.length

			let tx = touches[0].pageX
			let ty = touches[0].pageY

			this.mouse.x = tx 
			this.mouse.y = ty

			let {x,y} = this.relativeCenter(tx,ty)

			this.drag(x,y)

		};

		this.onKeyDown = function ( event ) {

			switch ( event.code ) {

				case 'ArrowUp':
				case 'KeyW': this.moveForward = true; break;

				case 'ArrowLeft':
				case 'KeyA': this.moveLeft = true; break;

				case 'ArrowDown':
				case 'KeyS': this.moveBackward = true; break;

				case 'ArrowRight':
				case 'KeyD': this.moveRight = true; break;

				case 'KeyR': this.moveUp = true; break;
				case 'KeyF': this.moveDown = true; break;

				case 'KeyE': this.cycle = 1; break;
				case 'KeyQ': this.cycle = -1; break;

				case 'Space': this.space = true; break;

			}

		};

		this.onKeyUp = function ( event ) {

			switch ( event.code ) {

				case 'ArrowUp':
				case 'KeyW': this.moveForward = false; break;

				case 'ArrowLeft':
				case 'KeyA': this.moveLeft = false; break;

				case 'ArrowDown':
				case 'KeyS': this.moveBackward = false; break;

				case 'ArrowRight':
				case 'KeyD': this.moveRight = false; break;

				case 'KeyR': this.moveUp = false; break;
				case 'KeyF': this.moveDown = false; break;

				case 'Space': this.space = false; break;
			}

		};

		this.lookAt = function ( x, y, z ) {

			if ( x.isVector3 ) {

				_target.copy( x );

			} else {

				_target.set( x, y, z );

			}

			this.object.lookAt( _target );

			setOrientation( this );

			return this;

		};

		this.postUpdate = function () {

			if(this.resetCycle) {
				this.cycle = 0
				this.resetCycle = false
			}

			this.mouseDownThisFrame = false
			this.mouseUpThisFrame = false

			if (this.cycle !== 0){
				this.resetCycle = true
			}

		}

		this.update = function () {

			const targetPosition = new Vector3();

			return function update( delta ) {

				if ( this.enabled === false ) return;

				if ( this.heightSpeed ) {

					const y = MathUtils.clamp( this.object.position.y, this.heightMin, this.heightMax );
					const heightDelta = y - this.heightMin;

					this.autoSpeedFactor = delta * ( heightDelta * this.heightCoef );

				} else {

					this.autoSpeedFactor = 0.0;

				}

				logToPanel(touchPoints)

				// handle touch controls
				if(touchPoints === 2){
					this.moveForward = true
					this.moveBackward = false
					console.log('👆')
				} else if(touchPoints === 3){
					this.moveBackward = true
					this.moveForward = false
				} else if(touchPoints === 0){
					this.moveBackward = false
					this.moveForward = false
				}


				// increase accel if key continues to be held down.
				if( this.moveForward || this.moveBackward || this.moveLeft || this.moveRight || this.moveUp || this.moveDown ){
					this.accelMultiplier++
				} else {
					this.accelMultiplier--
					if(this.accelMultiplier < 0) this.accelMultiplier = 0
				}

				let acc = this.accel// + this.accelMultiplier / 100

				if( this.moveRight ){
					this.dx += acc
				} else if( this.moveLeft ){
					this.dx -= acc
				}
				else this.dx *= this.decel
				if(Math.abs(this.dx) < this.minx) this.dx = 0
				this.object.translateX( this.dx )

				if( this.moveUp ){
					this.dy += acc
				} else if( this.moveDown ){
					this.dy -= acc
				}
				else this.dy *= this.decel
				if(Math.abs(this.dy) < this.minx) this.dy = 0
				this.object.translateY( this.dy )

				if( this.moveForward){
					this.dz -= acc
				} else if( this.moveBackward ){
					this.dz += acc
				}
				else this.dz *= this.decel
				if(Math.abs(this.dz) < this.minx) this.dz = 0
				this.object.translateZ( this.dz )

				// console.log('accel',this.dz, this.dy, this.dx)

				// if ( this.moveForward || ( this.autoForward && ! this.moveBackward ) ) this.object.translateZ( - ( actualMoveSpeed + this.autoSpeedFactor ) );
				// if ( this.moveBackward ) this.object.translateZ( actualMoveSpeed );

				// if ( this.moveLeft ) this.object.translateX( - actualMoveSpeed );
				// if ( this.moveRight ) this.object.translateX( actualMoveSpeed );

				// if ( this.moveUp ) this.object.translateY( actualMoveSpeed );
				// if ( this.moveDown ) this.object.translateY( - actualMoveSpeed );

				let actualLookSpeed = delta * this.lookSpeed;

				let verticalLookRatio = 1;

				if ( this.constrainVertical ) {

					verticalLookRatio = Math.PI / ( this.verticalMax - this.verticalMin );

				}

					lon -= this.mouseXdelta * this.deltaScalar * actualLookSpeed;
					if ( this.lookVertical ) lat -= this.mouseYdelta * this.deltaScalar * actualLookSpeed * verticalLookRatio;

					lat = Math.max( - 85, Math.min( 85, lat ) );

					let phi = MathUtils.degToRad( 90 - lat );
					const theta = MathUtils.degToRad( lon );

					if ( this.constrainVertical ) {

						phi = MathUtils.mapLinear( phi, 0, Math.PI, this.verticalMin, this.verticalMax );

					}

					const position = this.object.position;

					targetPosition.setFromSphericalCoords( 1, phi, theta ).add( position );

					this.object.lookAt( targetPosition );

			};

		}();

		this.dispose = function () {

		this.domElement.removeEventListener( 'contextmenu', contextmenu );
		this.domElement.removeEventListener( 'mousedown', _onMouseDown );
		this.domElement.removeEventListener( 'mousemove', _onMouseMove );
		this.domElement.removeEventListener( 'mouseup', _onMouseUp );

		this.domElement.removeEventListener( 'touchstart', _onFingerDown );
		this.domElement.removeEventListener( 'touchmove', _onFingerMove );
		this.domElement.removeEventListener( 'touchend', _onFingerUp );

			window.removeEventListener( 'keydown', _onKeyDown );
			window.removeEventListener( 'keyup', _onKeyUp );

		};

		const _onMouseMove = this.onMouseMove.bind( this );
		const _onMouseDown = this.onMouseDown.bind( this );
		const _onMouseUp = this.onMouseUp.bind( this );
		const _onFingerMove = this.onFingerMove.bind( this );
		const _onFingerDown = this.onFingerDown.bind( this );
		const _onFingerUp = this.onFingerUp.bind( this );
		const _onKeyDown = this.onKeyDown.bind( this );
		const _onKeyUp = this.onKeyUp.bind( this );

		this.domElement.addEventListener( 'contextmenu', contextmenu );
		this.domElement.addEventListener( 'mousedown', _onMouseDown );
		this.domElement.addEventListener( 'mousemove', _onMouseMove );
		this.domElement.addEventListener( 'mouseup', _onMouseUp );

		this.domElement.addEventListener( 'touchstart', _onFingerDown );
		this.domElement.addEventListener( 'touchmove', _onFingerMove );
		this.domElement.addEventListener( 'touchend', _onFingerUp );

		window.addEventListener( 'keydown', _onKeyDown );
		window.addEventListener( 'keyup', _onKeyUp );

		function setOrientation( controls ) {

			const quaternion = controls.object.quaternion;

			_lookDirection.set( 0, 0, - 1 ).applyQuaternion( quaternion );
			_spherical.setFromVector3( _lookDirection );

			lat = 90 - MathUtils.radToDeg( _spherical.phi );
			lon = MathUtils.radToDeg( _spherical.theta );

		}

		this.handleResize();

		setOrientation( this );

	}

}

function contextmenu( event ) {

	event.preventDefault();

}

export { FirstPersonControls };
