import { test } from "nostr-tools/nip21"
import { CYBERSPACE_DOWNSCALE, getVector3FromCyberspaceCoordinate } from "../libraries/Cyberspace"

console.log(CYBERSPACE_DOWNSCALE.toFixed())

export const Testing = () => {

  const getTestCoord = ( coord: string ) => {
    const testcoord = getVector3FromCyberspaceCoordinate(coord)

    // const testvector = testcoord.divideScalar(CYBERSPACE_DOWNSCALE).toVector3()
    // const testx = testvector.x
    // const testy = testvector.y
    // const testz = testvector.z

    const testx = testcoord.x.toFixed()
    const testy = testcoord.y.toFixed()
    const testz = testcoord.z.toFixed()

    return (
      <pre>
        { testx } <br/>
        { testy } <br/>
        { testz } <br/>
        <br/>
      </pre>
    )
  }

  return (
    <div style={{color: '#ccc', padding: '2rem', fontSize: '20px', fontWeight: 100}}>
      { getTestCoord('0a9bbb6c236c10ef0b166c29fa1dc22af30629c7ac12ba51765b87aa388617fa') }
      { getTestCoord('0a9bbb6c236c10ef0b166c29fa1dc22af30629c7ac12ba5176c9565a655e3732') }
    </div>
  ) 
}