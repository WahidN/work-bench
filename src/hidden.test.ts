import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadHiddenRepos, saveHiddenRepos } from './hidden'

const folder = () => mkdtempSync(join(tmpdir(), 'hidden-'))

describe('hidden repos', () => {
  it('reads an empty list when nothing was hidden yet', async () => {
    expect(await loadHiddenRepos(join(folder(), 'hidden-repos.json'))).toEqual([])
  })

  it('reads back what it saved, in a folder it makes', async () => {
    const file = join(folder(), 'workbench', 'hidden-repos.json')
    await saveHiddenRepos(['acme/web'], file)
    expect(await loadHiddenRepos(file)).toEqual(['acme/web'])
  })

  it('fails on a file that is not json', async () => {
    const file = join(folder(), 'hidden-repos.json')
    writeFileSync(file, 'acme/web')
    await expect(loadHiddenRepos(file)).rejects.toThrow()
  })
})
