import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which materials wear the world's headlamp (scene/headlamp.ts), read from
 * the source as singlePass.test.ts reads it: the world's unlit faces, lines
 * and point discs do; the bench, the thumbnails and the turning previews,
 * which draw `lit` under ShardLights, never do. A dropped or misplaced
 * spread would otherwise go unnoticed, since nothing fails without it.
 */
const read = (p: string): string => readFileSync(p, 'utf8')
const mesh = read('src/scene/ShardMesh.tsx')

/** Each JSX element of this tag, from its "<" to its "/>". */
function elements(src: string, tag: string): string[] {
  const out: string[] = []
  for (let at = src.indexOf(`<${tag}`); at >= 0; at = src.indexOf(`<${tag}`, at + 1)) out.push(src.slice(at, src.indexOf('/>', at) + 2))
  return out
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p)
    return /\.tsx$/.test(d.name) ? [p] : []
  })
}

describe('the headlamp is worn by the world, and only there', () => {
  it('is on for a world shard unless asked otherwise, and goes down to its placed parts', () => {
    expect(mesh).toMatch(/world = false, headlamp = world,/)
    expect(mesh).toMatch(/<Placements [^>]*headlamp=\{headlamp\}/)
    expect(mesh).toMatch(/<ShardMesh shard=\{model\} [^>]*headlamp=\{headlamp\}/)
  })

  it('patches the unlit faces, never the lit ones', () => {
    const basic = elements(mesh, 'meshBasicMaterial')
    expect(basic).toHaveLength(1)
    expect(basic[0]).toContain('{...lampFaces}')
    for (const lit of elements(mesh, 'meshLambertMaterial')) expect(lit).not.toContain('lamp')
    expect(mesh).toContain('const lampFaces = headlamp ? HEADLAMP_FACES : {}')
  })

  it('patches the shard\'s own lines and points, off the bench, and not the placeholder cube', () => {
    expect(mesh).toContain('const lampLines = headlamp && !lit ? HEADLAMP_LINES : {}')
    const lines = elements(mesh, 'lineBasicMaterial')
    expect(lines.filter((l) => l.includes('vertexColors'))).toHaveLength(1)
    expect(lines.find((l) => l.includes('vertexColors'))).toContain('{...lampLines}')
    for (const l of lines.filter((x) => !x.includes('vertexColors'))) expect(l).not.toContain('lamp')
    expect(mesh).toMatch(/if \(headlamp && !lit\) Object\.assign\(m, HEADLAMP_LINES\)/)
    expect(mesh).toMatch(/createDiscMaterial\([^)]*, headlamp && !lit\)/)
  })

  it('is asked for by the world\'s callers: placed shards, avatars, item models and the placing ghost', () => {
    expect(read('src/scene/WorldShards.tsx')).toMatch(/<ShardMesh [^>]*\bworld\b/)
    expect(read('src/scene/AvatarShape.tsx')).toMatch(/<ShardMesh [^>]*\bworld\b/)
    expect(read('src/scene/ItemModel.tsx')).toMatch(/<ShardMesh [^>]*world=\{!lit\}/)
    expect(read('src/scene/ShardGhost.tsx')).toMatch(/<ShardMesh [^>]*\bghost headlamp\b/)
  })

  it('is never asked for on the bench, the thumbnails or the turning previews', () => {
    const offWorld = [...files('src/workshop'), 'src/scene/ThumbStage.tsx', 'src/scene/ShardSpin.tsx']
    for (const f of offWorld) {
      for (const el of elements(read(f), 'ShardMesh ')) {
        expect(el, f).not.toMatch(/\bheadlamp\b/)
        expect(el, f).not.toMatch(/\bworld\b/)
      }
    }
  })
})
