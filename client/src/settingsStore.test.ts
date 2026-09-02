import { describe, expect, it } from 'vitest'
import { truncateHead } from './settingsStore'

/*
 * Head truncation is done in code rather than with `direction: rtl`, which does truncate at
 * the head but also reorders the neutral characters at the string's edges, so a POSIX path's
 * leading slash can end up printed at the end. These are what make the code version worth
 * the trade.
 */

describe('truncateHead', () => {
  it('leaves a short path alone', () => {
    expect(truncateHead('/tmp/engine', 48)).toBe('/tmp/engine')
  })

  it('keeps the tail, which is the part that identifies a folder', () => {
    // Every checkout under one directory shares its head, so the end is the useful end.
    const path = '/Users/someone/Documents/Projecten/workbench/engine'
    const shown = truncateHead(path, 20)
    // Exactly the budget: the ellipsis plus the last 19 characters.
    expect(shown).toBe('…en/workbench/engine')
    expect(shown).toHaveLength(20)
    expect(path.endsWith(shown.slice(1))).toBe(true)
  })

  it('never exceeds the budget it was given', () => {
    for (const max of [4, 10, 20, 48]) {
      expect(truncateHead('/a/very/long/path/that/keeps/going/onwards', max).length).toBeLessThanOrEqual(
        max,
      )
    }
  })

  it('leaves a path exactly at the limit alone', () => {
    const path = '0123456789'
    expect(truncateHead(path, 10)).toBe(path)
    expect(truncateHead(path, 9)).toBe('…23456789')
  })
})
