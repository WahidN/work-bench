import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SECTION_SYMBOL } from './logic'
import { paletteCommands } from './commandPaletteLogic'
import { targetSymbol } from './agentChatLogic'

/*
 * Task 8.5, as a check rather than a claim.
 *
 * An icon whose PNG is missing fails silently: `mask-image` on a URL that 404s renders an
 * empty box the size of the icon, so the layout is right and the glyph is simply absent.
 * Nothing throws, no test goes red, and the fidelity harness measures the box and passes.
 * Scanning the source for the names is the only way to catch it.
 */

const SOURCE = join(import.meta.dirname, '.')
const ICONS = join(import.meta.dirname, '..', 'public', 'icons')

function exportedIcons(): Set<string> {
  return new Set(
    readdirSync(ICONS)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace(/\.png$/, '')),
  )
}

/**
 * Every `name="..."` on an Icon, and every string literal fed to one through a table.
 *
 * The regex takes the JSX form and the object-property form, which is how the row models
 * carry a symbol. It cannot see a name built at runtime, which is what the three tables
 * below are asserted separately for.
 */
function referencedIcons(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(SOURCE)) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
    // Both extensions: a fixture in a component test naming a made-up symbol would
    // otherwise fail this and send the reader looking for a PNG no screen asks for.
    if (file.includes('.test.')) continue
    const text = readFileSync(join(SOURCE, file), 'utf8')
    for (const match of text.matchAll(/<Icon\s+name="([a-z0-9-]+)"/g)) names.add(match[1])
    for (const match of text.matchAll(/(?:symbol|refSymbol):\s*'([a-z0-9-]+)'/g)) names.add(match[1])
    for (const match of text.matchAll(/(?:SYMBOL|_SYMBOL)\s*=\s*'([a-z0-9-]+)'/g)) names.add(match[1])
  }
  return names
}

describe('exported SF Symbols', () => {
  it('cover every name the source hands to an Icon', () => {
    const have = exportedIcons()
    const missing = [...referencedIcons()].filter((name) => !have.has(name))
    expect(missing).toEqual([])
  })

  it('cover the sidebar sections, which the palette borrows too', () => {
    const have = exportedIcons()
    for (const symbol of Object.values(SECTION_SYMBOL)) {
      expect(have.has(symbol), symbol).toBe(true)
    }
    for (const row of paletteCommands) {
      expect(have.has(row.symbol), row.symbol).toBe(true)
    }
  })

  it('cover every agent panel target, including no target at all', () => {
    const have = exportedIcons()
    // `targetSymbol(null)` is the folder, which is a name nothing else asks for.
    expect(have.has(targetSymbol(null)), targetSymbol(null)).toBe(true)
  })

  it('finds icons at all, so a broken scan cannot pass by finding nothing', () => {
    expect(referencedIcons().size).toBeGreaterThan(10)
    expect(exportedIcons().size).toBeGreaterThan(20)
  })
})
