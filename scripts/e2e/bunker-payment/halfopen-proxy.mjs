// A TCP proxy in front of the local relay that can play dead: existing connections
// stay open but forward nothing (a phone's half-open socket after suspend), while
// new connections work. Control over HTTP on CONTROL_PORT: /dead, /alive, /status.
import net from 'node:net'
import http from 'node:http'
const LISTEN = +process.argv[2] || 10548
const TARGET = +process.argv[3] || 10547
const CONTROL_PORT = +process.argv[4] || 10549
let generation = 0
let deadGenerations = new Set()
let opened = 0, forwarded = 0, dropped = 0
const server = net.createServer((client) => {
  const gen = generation
  opened++
  const upstream = net.connect(TARGET, '127.0.0.1')
  const alive = () => !deadGenerations.has(gen)
  client.on('data', (d) => { if (alive()) { forwarded++; upstream.write(d) } else dropped++ })
  upstream.on('data', (d) => { if (alive()) client.write(d); else dropped++ })
  const closeBoth = () => { try { client.destroy() } catch {} try { upstream.destroy() } catch {} }
  client.on('error', closeBoth); upstream.on('error', closeBoth)
  // A half-open socket must NOT close when the relay side closes: keep the client side up.
  upstream.on('close', () => { if (alive()) client.end() })
  client.on('close', () => upstream.destroy())
})
server.listen(LISTEN, '127.0.0.1', () => console.log(`proxy ${LISTEN} -> ${TARGET}`))
http.createServer((req, res) => {
  if (req.url === '/dead') { deadGenerations.add(generation); generation++; res.end(JSON.stringify({ deadUpTo: generation - 1 })); return }
  if (req.url === '/alive') { deadGenerations.clear(); res.end('ok'); return }
  res.end(JSON.stringify({ generation, dead: [...deadGenerations], opened, forwarded, dropped }))
}).listen(CONTROL_PORT, '127.0.0.1', () => console.log(`control ${CONTROL_PORT}`))
