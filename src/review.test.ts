import { describe, expect, it } from 'vitest'

import { claudeArgs, failedRunOutput, readFindings } from './review'

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

  it('turns a failed run without a result text into its errors', () => {
    const stdout = JSON.stringify(
      result({
        subtype: 'error_max_structured_output_retries',
        is_error: true,
        errors: ['Failed to provide valid structured output after maximum retries'],
      }),
    )

    expect(() => readFindings(stdout)).toThrow('Failed to provide valid structured output')
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

describe('failedRunOutput', () => {
  const failure = (fields: object) => Object.assign(new Error('Command failed: claude -p You are reviewing'), fields)

  it('says the review took too long when the timeout stopped claude', () => {
    expect(() => failedRunOutput(failure({ killed: true, stdout: '' }))).toThrow('within 15 minutes')
  })

  it('shows stderr instead of the command line when claude printed nothing', () => {
    const run = () => failedRunOutput(failure({ stdout: '', stderr: "error: unknown option '--json-schema'\n" }))

    expect(run).toThrow("error: unknown option '--json-schema'")
    expect(run).not.toThrow('Command failed')
  })

  it('keeps the output of a failed run that printed its result', () => {
    expect(failedRunOutput(failure({ stdout: '{"type":"result"}' }))).toBe('{"type":"result"}')
  })
})
