import { describe, expect, it } from 'vitest'
import { coordToHex } from 'cyberspace-core'
import { landfallCoord, landfallCoordApprox, coordToLatLon, gpsToDataspaceXyz } from './landfall'

// DECK-0001 v3 §1.2 golden vectors (mainnet block hashes).
const VECTORS: Array<[number, string, string, number, number]> = [
  [398, '000000002f7d702a27ccd65158740198f79d4ba1ddea8ab14b56b63a6289fe89', '56db6db6db6db6db6db6db3e27c436f9d3b79fb5fc6457798936b3e749e38f56', 31.63, -98.85],
  [100399, '000000000003cb256436f213199e7047e187ab99e6d3176262bfb9be49d2a31a', '3b6db6db6db6db6db6db6d1eb09e85e5f572906af5a025a39ae284dd83278b72', -54.83, 129.06],
  [300399, '0000000000000000212f189879294318528669d239d5fbd30e6ffcc6015ced21', 'c492492492492492492492c7807ba8ecefd0a48a7b41dfbb50da5947b489ed8c', 57.04, -60.77],
  [363199, '000000000000000001e65a8804c7d97ee1fd52394632bdebdaf402935dcddeec', 'a9249249249249249249258087f30451bd8dd013357959fe2b07fa052488980c', -39.03, 5.7],
  [500399, '000000000000000000521f92387f9f43258f62465e9f88b19ecad2c30e44d7ff', '3b6db6db6db6db6db6db6d312f699ee9f35318557d9ee813b46f229215524a30', -65.92, 134.98],
  [700398, '00000000000000000005608e4c1ff53901186e766df5eaa87c636857ed814fa9', '56db6db6db6db6db6db6dbfdb284c1592e0d02ffd65f9d6c12d48a2b483d7da0', 86.47, -109.22],
  [900399, '00000000000000000001e412795ed39b18e56338e9b3c20d91edf59d20e020c9', 'c4924924924924924924920c53c81e9d260623340e5c3a75b6de6e4715cd1724', 6.07, -75.88],
  [950399, '00000000000000000001f081b994866dc3beb2c3ecd5976e9bda474e54e027c1', 'e000000000000000000000618f9c2d172da11fc0701996d4a89df1f60aecf732', 3.86, 63.9],
]

describe('landfall derivation (DECK-0001 v3 §1.2)', () => {
  it('reproduces the golden vectors exactly', () => {
    for (const [, hash, expected] of VECTORS) {
      expect(coordToHex(landfallCoord(hash))).toBe(expected)
    }
  })

  it('lands on the ellipsoid at the expected lat/lon', () => {
    for (const [, hash, , lat, lon] of VECTORS) {
      const ll = coordToLatLon(landfallCoord(hash))
      expect(Math.abs(ll.lat - lat)).toBeLessThan(0.02)
      expect(Math.abs(ll.lon - lon)).toBeLessThan(0.02)
      expect(Math.abs(ll.altM)).toBeLessThan(1)
    }
  })

  it('float64 approximation agrees with the exact derivation to within a few meters', () => {
    for (const [, hash] of VECTORS) {
      const exact = landfallCoord(hash)
      const approx = landfallCoordApprox(hash)
      const a = coordToLatLon(exact)
      const b = coordToLatLon(approx)
      expect(Math.abs(a.lat - b.lat)).toBeLessThan(1e-4)
      expect(Math.abs(a.lon - b.lon)).toBeLessThan(1e-4)
      expect(Math.abs(a.altM - b.altM)).toBeLessThan(5)
    }
  })
})

describe('gpsToDataspaceXyz', () => {
  // Produced by cyberspace-cli's canonical gps_to_dataspace_xyz (Decimal,
  // precision 96, ROUND_HALF_EVEN), spec version 2026-03-16-h34-corrected.
  const REFERENCE: Array<[number, number, string, string, string]> = [
    [0, 0, '19342813168621846444113920', '19342813113834066795298816', '19342813113834066795298816'],
    [51.5007, -0.1246, '19342813148009793067356437', '19342813156512391784587309', '19342813113759745401253303'],
    [-33.8568, 151.2153, '19342813073916910149282436', '19342813083483533274093808', '19342813135764830547981565'],
    [37.7749, -122.4194, '19342813090588201868394006', '19342813147212194597068734', '19342813077231844489621127'],
    [89.9999, 179.9999, '19342813113833970850900943', '19342813168438153392125810', '19342813113834066795466271'],
  ]

  it('matches the CLI to the gibson at five places, poles and antimeridian included', () => {
    for (const [lat, lon, x, y, z] of REFERENCE) {
      expect(gpsToDataspaceXyz(lat, lon)).toEqual({ x: BigInt(x), y: BigInt(y), z: BigInt(z) })
    }
  })

  it('clamps latitude and wraps longitude as the CLI does', () => {
    expect(gpsToDataspaceXyz(95, 0)).toEqual(gpsToDataspaceXyz(90, 0))
    expect(gpsToDataspaceXyz(0, 180)).toEqual(gpsToDataspaceXyz(0, -180))
    expect(gpsToDataspaceXyz(0, 540)).toEqual(gpsToDataspaceXyz(0, 180))
  })
})
