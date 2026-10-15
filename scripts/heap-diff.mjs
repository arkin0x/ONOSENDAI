/**
 * heap-diff.mjs: what grew between two V8 heap snapshots, by constructor
 * (2026-10-14). Counts and self sizes per node name, for the kinds of node
 * that hold memory (object, closure, array, native, hidden), sorted by the
 * growth in bytes.
 *
 * Usage: node scripts/heap-diff.mjs <start.heapsnapshot> <end.heapsnapshot> [top]
 */
import fs from 'node:fs'

const [a, b, topN = '30'] = process.argv.slice(2)

function summarize(file) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'))
  const f = snap.snapshot.meta.node_fields
  const types = snap.snapshot.meta.node_types[0]
  const n = f.length
  const iType = f.indexOf('type'), iName = f.indexOf('name'), iSize = f.indexOf('self_size')
  const by = new Map()
  for (let i = 0; i < snap.nodes.length; i += n) {
    const type = types[snap.nodes[i + iType]]
    if (!['object', 'closure', 'array', 'native', 'hidden', 'string', 'code'].includes(type)) continue
    const name = `${type}:${type === 'string' ? '(string)' : snap.strings[snap.nodes[i + iName]]}`
    const e = by.get(name) ?? { count: 0, size: 0 }
    e.count++
    e.size += snap.nodes[i + iSize]
    by.set(name, e)
  }
  return by
}

const s = summarize(a), e = summarize(b)
const rows = [...new Set([...s.keys(), ...e.keys()])].map((k) => {
  const x = s.get(k) ?? { count: 0, size: 0 }, y = e.get(k) ?? { count: 0, size: 0 }
  return { k, dCount: y.count - x.count, dSize: y.size - x.size, count: y.count, size: y.size }
}).sort((p, q) => q.dSize - p.dSize).slice(0, Number(topN))
for (const r of rows) console.log(`${String(Math.round(r.dSize / 1024)).padStart(9)} KB  ${String(r.dCount).padStart(8)}  now ${String(r.count).padStart(8)}  ${r.k.slice(0, 90)}`)
