// Read-only fetch of public events to seed the smoke test's offline relay.
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import fs from 'node:fs'
const sk = generateSecretKey()
const A = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const X = 'd4e4c079ad8e2f84af0da56f95c161431226934398e78c7a3c244e2547f6f3d4'
const relay = await Relay.connect('wss://cyberspace.nostr1.com')
await new Promise((r) => setTimeout(r, 1500))
if (relay.challenge) await relay.auth((t) => finalizeEvent(t, sk))
const filters = [
  { kinds: [3333], authors: [A], limit: 3000 }, { kinds: [3333], authors: [X], limit: 3000 },
  { kinds: [0, 11333, 10050], authors: [A, X] }, { kinds: [33330], authors: [A, X], limit: 3000 },
  { kinds: [33331], limit: 400 },
]
const out = new Map()
// Paged with until: a relay may cap one answer below the asked limit, and a
// chain missing its spawn reads as "no chain" to the app.
for (const f of filters) {
  let until
  for (let page = 0; page < 20; page++) {
    let got = 0, fresh = 0, oldest = Infinity
    await new Promise((done) => {
      const sub = relay.subscribe([{ ...f, ...(until ? { until } : {}) }], {
        onevent: (e) => { got++; if (!out.has(e.id)) fresh++; oldest = Math.min(oldest, e.created_at); out.set(e.id, e) },
        oneose: () => { sub.close(); done() },
      })
      setTimeout(done, 30000)
    })
    // Inclusive until: WALK signs several moves in one second.
    if (fresh === 0 || !f.limit || oldest === Infinity || f.kinds.includes(33331)) break
    until = oldest
  }
  console.log(JSON.stringify(f).slice(0, 60), out.size)
}
fs.writeFileSync(process.argv[2], JSON.stringify([...out.values()]))
relay.close(); process.exit(0)
