import * as THREE from "three"
import { Decimal } from 'decimal.js'
import { decimalAlmostEqual } from "./Cyberspace"

Decimal.set({ precision: 100 })

export class DecimalVector3 {
  x: Decimal 
  y: Decimal
  z: Decimal

  constructor(x: number|Decimal = 0, y: number|Decimal = 0, z: number|Decimal = 0) {
    this.x = new Decimal(x)
    this.y = new Decimal(y)
    this.z = new Decimal(z)
  }

  clone(): DecimalVector3 {
    return new DecimalVector3(this.x, this.y, this.z)
  }

  fromArray(arr: (string|number|Decimal)[]): DecimalVector3 {
    if (arr.length !== 3) {
      throw new Error('Array must contain exactly three elements')
    }
    this.x = new Decimal(arr[0])
    this.y = new Decimal(arr[1])
    this.z = new Decimal(arr[2])
    return this
  }

  /**
   * 
   * @param fixed how many decimal places to round to
   * @returns 
   */
  toArray(fixed: number = 8): [string, string, string] {
    return [this.x.toFixed(fixed), this.y.toFixed(fixed), this.z.toFixed(fixed)]
  }

  applyQuaternion(q: THREE.Quaternion) {

    const x = this.x
    const y = this.y
    const z = this.z
    const qx = new Decimal(q.x)
    const qy = new Decimal(q.y)
    const qz = new Decimal(q.z)
    const qw = new Decimal(q.w)

    // calculate quat * vector
    const ix = qw.times(x).plus(qy.times(z)).minus(qz.times(y))
    const iy = qw.times(y).plus(qz.times(x)).minus(qx.times(z))
    const iz = qw.times(z).plus(qx.times(y)).minus(qy.times(x))
    const iw = qx.neg().times(x).minus(qy.times(y)).minus(qz.times(z))

    // calculate result * inverse quat
    this.x = ix.times(qw).plus(iw.times(qx.neg())).plus(iy.times(qz.neg())).minus(iz.times(qy.neg()))
    this.y = iy.times(qw).plus(iw.times(qy.neg())).plus(iz.times(qx.neg())).minus(ix.times(qz.neg()))
    this.z = iz.times(qw).plus(iw.times(qz.neg())).plus(ix.times(qy.neg())).minus(iy.times(qx.neg()))

    return this
  }

  add (v: DecimalVector3) {
    this.x = this.x.plus(v.x)
    this.y = this.y.plus(v.y)
    this.z = this.z.plus(v.z)
    return this
  }

  multiplyScalar (scalar: number|Decimal) {
    this.x = this.x.times(scalar)
    this.y = this.y.times(scalar)
    this.z = this.z.times(scalar)
    return this
  }

  divideScalar (scalar: number|Decimal) {
    this.x = this.x.div(scalar)
    this.y = this.y.div(scalar)
    this.z = this.z.div(scalar)
    return this
  }

  floor () {
    this.x = this.x.floor()
    this.y = this.y.floor()
    this.z = this.z.floor()
    return this
  }

  almostEqual (v: DecimalVector3): boolean {
    return decimalAlmostEqual(this.x, v.x) && decimalAlmostEqual(this.y, v.y) && decimalAlmostEqual(this.z, v.z)
  }

  toVector3(): THREE.Vector3 {
    return new THREE.Vector3(parseFloat(this.x.toFixed(8)), parseFloat(this.y.toFixed(8)), parseFloat(this.z.toFixed(8)))
  }
}
