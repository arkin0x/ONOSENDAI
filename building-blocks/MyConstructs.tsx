import { useContext, useEffect } from 'react'
import { Filter } from "nostr-tools"
import { IdentityContextType } from "../src/types/IdentityType"
import { IdentityContext } from "../src/providers/IdentityProvider"
import { defaultRelays, getRelayList, pool } from '../src/libraries/Nostr'
import { PublishedConstructsReducerAction, PublishedConstructsReducerState, PublishedConstructType } from '../src/types/Construct'
import { sortPublishedConstructsPOW } from '../src/libraries/Constructs'

type MyConstructsProps = {
  constructs: PublishedConstructsReducerState
  updatePublishedConstructs: React.Dispatch<PublishedConstructsReducerAction>
}

const MyConstructs = ({constructs, updatePublishedConstructs}: MyConstructsProps) => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  // const [ foundNone, setFoundNone ] = useState<boolean>(false)

  useEffect(() => {
    const relayList = getRelayList(defaultRelays, ['write'])
    const filter: Filter = {kinds: [331], authors: [identity.pubkey]}
    const sub = pool.sub(relayList, [filter])
    const loadMyConstructs = async () => {
      sub.on('event', event => {
        console.log('found construct', event)
        updatePublishedConstructs({type: 'add', construct: event as PublishedConstructType})
      })
    }
    loadMyConstructs()
    return () => {
      pool.close(relayList)
    }
  }, [identity.pubkey]) // @todo add some kind of dependency for when new constructs are published

  const constructsArray = Object.values(constructs).sort(sortPublishedConstructsPOW)

  return (
    <div id="my-constructs">
      <h1>Published Constructs</h1>
      { constructsArray.length ? constructsArray.map((construct) => <div>{construct.id}</div>) : 'no constructs found.' }
    </div>
  )

}

export default MyConstructs