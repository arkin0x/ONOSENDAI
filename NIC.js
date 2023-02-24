import { SimplePool } from 'nostr-tools'

const relays = [
 'wss://eden.nostr.land',
 'wss://nostr.fmt.wiz.biz',
 'wss://relay.damus.io',
 'wss://nostr-pub.wellorder.net',
 'wss://relay.nostr.info',
 'wss://offchain.pub',
 'wss://nos.lol',
 'wss://brb.io',
 'wss://relay.snort.social',
 'wss://relay.current.fyi',
 'wss://nostr.relayer.se',
]

export function NIC() {
 const pool = new SimplePool() 
 return {
  pool,
  relays,
 }
}