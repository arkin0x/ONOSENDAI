import { useEffect } from "react"
import { CYBERSPACE_SECTOR, CyberspaceCoordinateDimension, cyberspaceCoordinateFromHexString, cyberspaceEncodePartialToRaw, cyberspaceEncodeSectorPartialToRaw, CyberspaceLocalCoordinateDimension, CyberspacePlane, factoryCyberspaceLocalCoordinateVector } from "../libraries/Cyberspace"
import { useSectorStore } from "../store/SectorStore"

export function DebugLocal() {
  const { addHyperjump } = useSectorStore()

  useEffect( () => {
    addHyperjump("22493668282275767-30865482130737924-22684969844795303", 
      {
        "created_at": 1725657526,
        "content": "Block -1 TEST",
        "tags": [
          [
            "C",
            "e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d87e7dd105a"
          ],
          [
            "S",
            "22493668282275767-30865482130737924-22684969844795303"
          ],
          [
            "H",
            "0000000000000000000000000000000000000000000000000000000000000000"
          ],
          [
            "P",
            "0000000000000000000081730d842e2a0bbaa65d507713be09610d0494ae7349"
          ],
          [
            "N",
            "0000000000000000000000000000000000000000000000000000000000000000"
          ],
          [
            "B",
            "-1"
          ]
        ],
        "kind": 321,
        "pubkey": "811ccc1b997eb22662065700502169644e2d30b2944b56ee846a8874cc286d3f",
        "id": "6cdfd44606a473ad656a8933c71d757cab03386a89f0ccc2822f8eeaf4170e80",
        "sig": "ba7cc8ab8ecbbe612ee1f6cda1bf82e46a610d12df6333783353c7d16c7f0d32ed1f5adcc73b6fee1b6b29f88341a30295f3024694aab06d2dacdcd70596ca0c"
      }
    )
    addHyperjump("22493668282275767-30865482130737924-22684969844795302", 
      {
        "created_at": 1725657526,
        "content": "Block -2 TEST",
        "tags": [
          [
            "C",
            "e8ed3798c6ffebffa08501ac39e271662bfd160f608f94c45d692d8767dd345a"
          ],
          [
            "S",
            "22493668282275767-30865482130737924-22684969844795302"
          ],
          [
            "H",
            "0000000000000000000000000000000000000000000000000000000000000000"
          ],
          [
            "P",
            "0000000000000000000081730d842e2a0bbaa65d507713be09610d0494ae7349"
          ],
          [
            "N",
            "0000000000000000000000000000000000000000000000000000000000000000"
          ],
          [
            "B",
            "-1"
          ]
        ],
        "kind": 321,
        "pubkey": "811ccc1b997eb22662065700502169644e2d30b2944b56ee846a8874cc286d3f",
        "id": "6cdfd44606a473ad656a8933c71d757cab03386a89f0ccc2822f8eeaf4170e81",
        "sig": "ba7cc8ab8ecbbe612ee1f6cda1bf82e46a610d12df6333783353c7d16c7f0d32ed1f5adcc73b6fee1b6b29f88341a30295f3024694aab06d2dacdcd70596ca0c"
      }
    )
  }, [])

  /// TEST
  const _coord = cyberspaceCoordinateFromHexString("e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a")
  // console.log('spawn', _coord.local.vector.toVector3())
  _coord.local.vector.z = _coord.local.vector.z.add(1000) as CyberspaceLocalCoordinateDimension
  const _newVector = factoryCyberspaceLocalCoordinateVector(_coord.local.vector.x, _coord.local.vector.y, _coord.local.vector.z)
  const _newRaw = cyberspaceEncodeSectorPartialToRaw(_coord.sector.id, _newVector, CyberspacePlane.DSpace)
  const _sector = _coord.sector.id

  // TEST 2
  const _coord2 = cyberspaceCoordinateFromHexString("e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a")
  _coord2.vector.z = _coord2.vector.z.sub(CYBERSPACE_SECTOR) as CyberspaceCoordinateDimension
  const _newRaw2 = cyberspaceEncodePartialToRaw(_coord2.vector, _coord2.plane)


  /// END TEST

  return (
    <ul style={{marginTop: '4em'}}>
      <li>Debug Hyperjumps Active</li>
    </ul>
  )
}