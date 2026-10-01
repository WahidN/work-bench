import { describe, expect, it } from 'vitest'

import { claudeArgs, diffLines, failedRunOutput, readFindings } from './review'

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

const DIFF = `diff --git a/src/limits.ts b/src/limits.ts
index 1111111..2222222 100644
--- a/src/limits.ts
+++ b/src/limits.ts
@@ -10,4 +10,5 @@ export function limit() {
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5
@@ -40,2 +41,2 @@
 keep()
+++ b/other.ts
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-gone()
`

describe('diffLines', () => {
  it('keeps the new line numbers of added and unchanged lines', () => {
    expect([...diffLines(DIFF).get('src/limits.ts')!]).toEqual([10, 11, 12, 13, 41, 42])
  })

  it('reads an added line that starts with ++ as a line, not a file', () => {
    expect(diffLines(DIFF).has('other.ts')).toBe(false)
  })

  it('has no lines for a deleted file', () => {
    expect([...diffLines(DIFF).keys()]).toEqual(['src/limits.ts'])
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
