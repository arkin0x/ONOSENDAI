import { UnpublishedConstructType } from "../src/types/Construct"
import { decodeHexToCoordinates } from '../src/libraries/Constructs'
import { signEvent } from "../src/libraries/NIP-07"
import '../scss/UnpublishedConstruct.scss'
import { defaultRelays, getRelayList, pool } from "../src/libraries/Nostr"

type UnpublishedConstructProps = {
  construct: UnpublishedConstructType
  onClick: (construct: UnpublishedConstructType) => void
  selected: boolean,
  published: boolean
}

export const UnpublishedConstruct = ({ construct, onClick, selected, published }: UnpublishedConstructProps) => {

  const classNames = "construct" + (selected ? " selected" : "" ) + (published ? " published" : "")

  const coords = decodeHexToCoordinates(construct.id)

  const publish = async () => {
    console.log(construct)
    const signedEvent = await signEvent(construct.readyForSignature)

    if (signedEvent === null) {
      // TODO: notify user
      console.error("Failed to sign event.")
      return
    }

    const relayList = getRelayList(defaultRelays, ['write'])
    pool.publish(relayList, signedEvent)
  }

  return (
    <div className={classNames} key={construct.id} onClick={() => onClick(construct)}>
      <h2>{ construct.workCompleted } POW - {coords.plane}</h2>
      <p>
        x: { ((Number(coords.x) / Number(2n**85n)) * 100 ).toFixed(0) }%<br/>
        y: { ((Number(coords.y) / Number(2n**85n)) * 100 ).toFixed(0) }%<br/>
        z: { ((Number(coords.z) / Number(2n**85n)) * 100 ).toFixed(0) }%<br/>
      </p>
      <small className="id">{ construct.id }</small>
      <br/><br/>
      { published ? <button type="button" disabled>Published! ✅</button> : <><button type="button" onClick={publish}>Publish ✨</button>&nbsp;</>}
      {/* <button type="button" onClick={() => {
        // copy to clipboard
        navigator.clipboard.writeText(JSON.stringify(construct.readyForSignature))
      }}>Copy 📋</button> */}
    </div>
  )
}