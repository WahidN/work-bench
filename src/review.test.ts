import { describe, expect, it } from 'vitest'

import { claudeArgs, readFindings } from './review'

const FINDING = { path: 'web/fade.ts', line: 19, body: 'Deze fade schrijft diepte.' }

function result(fields: object) {
  return { type: 'result', subtype: 'success', is_error: false, ...fields }
}

describe('readFindings', () => {
  it('reads the findings from the result message', () => {
    const stdout = JSON.stringify(result({ structured_output: { findings: [FINDING] } }))

    expect(readFindings(stdout)).toEqual([FINDING])
  })

  it('finds the result among every message when claude is verbose', () => {
    const stdout = JSON.stringify([
      { type: 'system', subtype: 'init' },
      result({ structured_output: { findings: [FINDING] } }),
    ])

    expect(readFindings(stdout)).toEqual([FINDING])
  })

  it('turns a failed run into its message', () => {
    const stdout = JSON.stringify(result({ is_error: true, result: 'The model does not exist' }))

    expect(() => readFindings(stdout)).toThrow('The model does not exist')
  })

  it('fails when the answer has no remarks list', () => {
    const stdout = JSON.stringify(result({ result: 'Looks fine to me' }))

    expect(() => readFindings(stdout)).toThrow('no remarks list')
  })
})

describe('claudeArgs', () => {
  it('gives claude no tools', () => {
    const args = claudeArgs('Review this')

    expect(args[args.indexOf('--tools') + 1]).toBe('')
  })
})
