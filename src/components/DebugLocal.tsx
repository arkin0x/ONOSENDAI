import { useEffect } from "react"
import { cyberspaceCoordinateFromHexString, cyberspaceEncodeSectorPartialToRaw, CyberspaceLocalCoordinateDimension, CyberspacePlane, factoryCyberspaceLocalCoordinateVector } from "../libraries/Cyberspace"
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
            "0000000000000000000000000000000000000000000000000000000000000001"
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
    addHyperjump("22302181039602187-34090414272272904-1411266363892683", 
      {
        "created_at": 1725657526,
        "content": "Block -2 TEST",
        "tags": [
          [
            "C",
            "c96b3813657d123d701173466b1a1fd761c920716eae7abb625cabe07a299f2e"
          ],
          [
            "S",
            "22302181039602187-34090414272272904-1411266363892683"
          ],
          [
            "H",
            "0000000000000000000000000000000000000000000000000000000000000001"
          ],
          [
            "P",
            "0000000000000000000081730d842e2a0bbaa65d507713be09610d0494ae7349"
          ],
          [
            "N",
            "0000000000000000000000000000000000000000000000000000000000000002"
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
    addHyperjump("35777443461358763-24870783318878850-26600430141198110", 
      {
        "created_at": 1725657526,
        "content": "Block -2 TEST",
        "tags": [
          [
            "C",
            "f3fb614361b3f5a8687b2618b6c812f83ace10d3e7e0ecc8e5e8f9c850710e3e"
          ],
          [
            "S",
            "35777443461358763-24870783318878850-26600430141198110"
          ],
          [
            "H",
            "0000000000000000000000000000000000000000000000000000000000000002"
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
  }, [addHyperjump])

  /// TEST HYPERJUMPS
  const hj0 = cyberspaceCoordinateFromHexString("e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a")
  // console.log('spawn', _coord.local.vector.toVector3())
  hj0.local.vector.z = hj0.local.vector.z.add(1000) as CyberspaceLocalCoordinateDimension
  const hj0_vector = factoryCyberspaceLocalCoordinateVector(hj0.local.vector.x, hj0.local.vector.y, hj0.local.vector.z)
  const hj0_raw = cyberspaceEncodeSectorPartialToRaw(hj0.sector.id, hj0_vector, CyberspacePlane.DSpace)

  // TEST 2
  const hj1 = cyberspaceCoordinateFromHexString("c96b3813657d123d701173466b1a1fd761c920716eae7abb625cabe07a299f2e")

  // TEST 2
  const hj2 = cyberspaceCoordinateFromHexString("f3fb614361b3f5a8687b2618b6c812f83ace10d3e7e0ecc8e5e8f9c850710e3e")

  /// END TEST

  return (
    <>
    <ul style={{marginTop: '4em'}}>
      <li>Debug Hyperjumps Active</li>
    </ul>
    <p style={{whiteSpace: "pre-wrap"}}>
      test hyperjump 0<br/>
      {hj0_raw}<br/>
      {hj0.sector.id}<br/>
      <br/><br/>
      test hyperjump 1<br/>
      {hj1.raw}<br/>
      {hj1.sector.id}<br/>
      <br/><br/>
      test hyperjump 2<br/>
      {hj2.raw}<br/>
      {hj2.sector.id}<br/>
    </p>
    </>
  )
}