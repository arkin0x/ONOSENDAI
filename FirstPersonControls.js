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

		this.movementSpeed = 1.0;
		this.lookSpeed = 0.005;

		this.lookVertical = true;
		this.autoForward = false;

		this.activeLook = false;

		this.heightSpeed = false;
		this.heightCoef = 1.0;
		this.heightMin = 0.0;
		this.heightMax = 1.0;

		this.constrainVertical = false;
		this.verticalMin = 0;
		this.verticalMax = Math.PI;

		this.mouseDragOn = false;

		// internals

		this.autoSpeedFactor = 0.0;

		// this.pointer is used to provide mouse coords outside this object
		this.pointer = new Vector2(0,0)

		this.pointerDownThisFrame = false
		this.pointerUpThisFrame = false

		this.pointerX = 0;
		this.pointerY = 0;
  this.pointerXlast = 0
  this.pointerYlast = 0
  this.pointerXdelta = 0
  this.pointerYdelta = 0
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

		this.handleResize = function () {

			if ( this.domElement === document ) {

				this.viewHalfX = window.innerWidth / 2;
				this.viewHalfY = window.innerHeight / 2;

			} else {

				this.viewHalfX = this.domElement.offsetWidth / 2;
				this.viewHalfY = this.domElement.offsetHeight / 2;

			}

		};

		this.onPointerDown = function ( event ) {

			this.pointerDownThisFrame = true

			if ( this.domElement !== document ) {

				this.domElement.focus();

			}

			if ( this.activeLook ) {

				switch ( event.button ) {

					case 0: this.moveForward = true; break;
					case 2: this.moveBackward = true; break;

				}

			}

			this.mouseDragOn = true;

   this.pointerXlast = this.pointerX = event.pageX
   this.pointerYlast = this.pointerY = event.pageY
   this.pointerXdelta = this.pointerYdelta = 0
			this.activeLook = true


		};

		this.onPointerUp = function ( event ) {

		if(Math.abs(this.pointerXdelta) < NON_DRAG_DISTANCE && Math.abs(this.pointerYdelta) < NON_DRAG_DISTANCE){
			this.pointerUpThisFrame = true
		}

			if ( this.activeLook ) {

				switch ( event.button ) {

					case 0: this.moveForward = false; break;
					case 2: this.moveBackward = false; break;

				}

			}

			this.mouseDragOn = false;

   this.pointerXlast = this.pointerX = 0
   this.pointerYlast = this.pointerY = 0
   this.pointerXdelta = this.pointerYdelta = 0

			this.activeLook = false
		};

		this.onPointerMove = function ( event ) {

			this.pointer.x = event.pageX
			this.pointer.y = event.pageY

   if (!this.mouseDragOn) return

   this.pointerX = event.pageX
   this.pointerY = event.pageY
   this.pointerXdelta = this.pointerX - this.pointerXlast
   this.pointerYdelta = this.pointerY - this.pointerYlast

		};

		this.onFingerDown = function ( event ) {

			if ( this.domElement !== document ) {

				this.domElement.focus();

			}

			if ( this.activeLook ) {

				switch ( event.button ) {

					case 0: this.moveForward = true; break;
					case 2: this.moveBackward = true; break;

				}

			}

			this.mouseDragOn = true;

   this.pointerXlast = this.pointerX = event.changedTouches[0].pageX
   this.pointerYlast = this.pointerY = event.changedTouches[0].pageY
   this.pointerXdelta = this.pointerYdelta = 0

		};

		this.onFingerUp = function ( event ) {

			if ( this.activeLook ) {

				switch ( event.button ) {

					case 0: this.moveForward = false; break;
					case 2: this.moveBackward = false; break;

				}

			}

			this.mouseDragOn = false;

   this.pointerXlast = this.pointerX = 0
   this.pointerYlast = this.pointerY = 0
   this.pointerXdelta = this.pointerYdelta = 0

		};

		this.onFingerMove = function ( event ) {

   this.pointerX = event.changedTouches[0].pageX
   this.pointerY = event.changedTouches[0].pageY
   this.pointerXdelta = this.pointerX - this.pointerXlast
   this.pointerYdelta = this.pointerY - this.pointerYlast

   // console.log('touch',this.pointerXdelta)
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

			this.pointerDownThisFrame = false
			this.pointerUpThisFrame = false

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

				const actualMoveSpeed = delta * this.movementSpeed;

				if ( this.moveForward || ( this.autoForward && ! this.moveBackward ) ) this.object.translateZ( - ( actualMoveSpeed + this.autoSpeedFactor ) );
				if ( this.moveBackward ) this.object.translateZ( actualMoveSpeed );

				if ( this.moveLeft ) this.object.translateX( - actualMoveSpeed );
				if ( this.moveRight ) this.object.translateX( actualMoveSpeed );

				if ( this.moveUp ) this.object.translateY( actualMoveSpeed );
				if ( this.moveDown ) this.object.translateY( - actualMoveSpeed );

				let actualLookSpeed = delta * this.lookSpeed;

				let verticalLookRatio = 1;

				if ( this.constrainVertical ) {

					verticalLookRatio = Math.PI / ( this.verticalMax - this.verticalMin );

				}

					lon -= this.pointerXdelta * this.deltaScalar * actualLookSpeed;
					if ( this.lookVertical ) lat -= this.pointerYdelta * this.deltaScalar * actualLookSpeed * verticalLookRatio;

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
		this.domElement.removeEventListener( 'pointerdown', _onPointerDown );
		this.domElement.removeEventListener( 'pointermove', _onPointerMove );
		this.domElement.removeEventListener( 'pointerup', _onPointerUp );

		this.domElement.removeEventListener( 'touchstart', _onFingerDown );
		this.domElement.removeEventListener( 'touchmove', _onFingerMove );
		this.domElement.removeEventListener( 'touchend', _onFingerUp );

			window.removeEventListener( 'keydown', _onKeyDown );
			window.removeEventListener( 'keyup', _onKeyUp );

		};

		const _onPointerMove = this.onPointerMove.bind( this );
		const _onPointerDown = this.onPointerDown.bind( this );
		const _onPointerUp = this.onPointerUp.bind( this );
		const _onFingerMove = this.onFingerMove.bind( this );
		const _onFingerDown = this.onFingerDown.bind( this );
		const _onFingerUp = this.onFingerUp.bind( this );
		const _onKeyDown = this.onKeyDown.bind( this );
		const _onKeyUp = this.onKeyUp.bind( this );

		this.domElement.addEventListener( 'contextmenu', contextmenu );
		this.domElement.addEventListener( 'pointerdown', _onPointerDown );
		this.domElement.addEventListener( 'pointermove', _onPointerMove );
		this.domElement.addEventListener( 'pointerup', _onPointerUp );

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
