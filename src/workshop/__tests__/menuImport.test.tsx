/**
 * menuImport.test.tsx - IMPORT in the redesigned workshop (2026-11-16): MENU,
 * the first place on the top bar, has IMPORT on its first row beside + NEW
 * SHARD and PASTE; a tap asks the workshop for its file picker, which takes
 * PLY among the rest; while a file is read it says READING and takes no
 * second tap; and MENU's EXPLAIN says what IMPORT does and which way up a
 * PLY is read (a Blender PLY standing with the default export, since
 * sno-core 0.1.33).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mount, textOf, type Host } from '../../test/elementRoot'

// Thumbnails draw through a shared WebGL stage; nothing here to draw on, and nothing to see.
vi.mock('../../hud/ShardThumb', () => ({ ShardThumb: () => null }))
// The dock switch is a Radix switch, which wants a DOM; it is not what these look at.
vi.mock('../../hud/ui/Switch', () => ({ Field: ({ children }: { children?: unknown }) => children ?? null, Switch: () => null }))

const { MenuBody } = await import('../sheets/MenuSheet')
const { useWorkshop } = await import('../../store/useWorkshop')
const { IMPORT_PICKER_ACCEPT } = await import('../../lib/shardZip')
const { AREAS } = await import('../shell/TopBar')
const workshopSrc = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

const menuSrc = readFileSync(join(__dirname, '..', 'sheets', 'MenuSheet.tsx'), 'utf8')

async function menu(importing: boolean) {
  useWorkshop.setState({ shards: [{ id: 'oak', name: 'oak tree', vertices: [], faces: [], mode: 'solid', unit: 0, extent: 8, updatedAt: 1 }] as never, currentId: 'oak' })
  const onImport = vi.fn()
  const m = await mount(<MenuBody currentId="oak" onOpen={() => {}} onImport={onImport} importing={importing} paste={{ open: false, text: '' }} setPaste={() => {}} />)
  const buttons = m.all().filter((h) => h.type === 'button')
  const button = (label: string): Host | undefined => buttons.find((h) => textOf(h).trim() === label)
  return { m, onImport, buttons, button }
}

describe('IMPORT in the workshop MENU', () => {
  it('is on MENU\'s first row, after + NEW SHARD and PASTE, and a tap asks the workshop for its file picker', async () => {
    const { onImport, buttons, button } = await menu(false)
    const labels = buttons.map((h) => textOf(h).trim())
    expect(labels.slice(0, 3)).toEqual(['+ NEW SHARD', 'PASTE', 'IMPORT'])
    const imp = button('IMPORT')!
    expect(imp.props.disabled).toBe(false)
    expect(String(imp.props.title)).toContain('PLY')
    ;(imp.props.onClick as () => void)()
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it('says READING and takes no tap while a file is read', async () => {
    const { button } = await menu(true)
    expect(button('IMPORT')).toBeUndefined()
    expect(button('READING')!.props.disabled).toBe(true)
  })

  it('the picker offers a .ply, and MENU is the first area on the top bar', () => {
    expect(IMPORT_PICKER_ACCEPT.split(',')).toContain('.ply')
    // The first area the top bar lists, right after the way out.
    expect(AREAS[0].area).toBe('menu')
    // MENU's IMPORT is the workshop's own picker, kept mounted.
    expect(workshopSrc).toContain('onImport={() => fileInput.current?.click()}')
  })

  it('EXPLAIN says what IMPORT does, that a Blender PLY comes in standing with the default export, and a quarter turn for one exported Up Y', () => {
    const start = menuSrc.indexOf('<Explanation>')
    const explain = menuSrc.slice(start, menuSrc.indexOf('</Explanation>', start)).replace(/\s+/g, ' ')
    expect(explain).toContain('IMPORT, at the top of this sheet, brings a 3D file ({IMPORT_FORMATS_LABEL}) into this shard')
    expect(explain).toContain("A PLY from Blender comes in standing with Blender's default export settings")
    expect(explain).toContain('if you exported it with Up set to Y, it comes in on its back and a quarter turn stands it up')
    expect(explain).toContain('Any other PLY is read Y up')
    // The old advice, export with Up Y, now lays a Blender PLY on its back.
    expect(explain).not.toContain('Forward to -Z')
    expect(explain).not.toContain('—')
  })
})
