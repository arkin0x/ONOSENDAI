import * as THREE from "three"
import { Decimal } from 'decimal.js'

export class DecimalVector3 {
  x: Decimal 
  y: Decimal
  z: Decimal

  constructor(x: number|Decimal = 0, y: number|Decimal = 0, z: number|Decimal = 0) {
    this.x = new Decimal(x)
    this.y = new Decimal(y)
    this.z = new Decimal(z)
  }

  fromArray(arr: (number|Decimal)[]): DecimalVector3 {
    if (arr.length !== 3) {
      throw new Error('Array must contain exactly three elements')
    }
    this.x = new Decimal(arr[0])
    this.y = new Decimal(arr[1])
    this.z = new Decimal(arr[2])
    return this
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

    // const ix = qw * x + qy * z - qz * y
    // const iy = qw * y + qz * x - qx * z
    // const iz = qw * z + qx * y - qy * x
    // const iw = -qx * x - qy * y - qz * z

    // calculate result * inverse quat
    this.x = ix.times(qw).plus(iw.times(qx.neg())).plus(iy.times(qz.neg())).minus(iz.times(qy.neg()))
    this.y = iy.times(qw).plus(iw.times(qy.neg())).plus(iz.times(qx.neg())).minus(ix.times(qz.neg()))
    this.x = iz.times(qw).plus(iw.times(qz.neg())).plus(ix.times(qy.neg())).minus(iy.times(qx.neg()))

    // this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy
    // this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz
    // this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx

    return this

  }
}
