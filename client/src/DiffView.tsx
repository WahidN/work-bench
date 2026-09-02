/*
 * Port of app/Workbench/Views/DiffView.swift.
 *
 * The raw renderer: a whole unified diff as text, coloured by the line's first character
 * and nothing else. It has no gutters and no threads, because the agent panel shows a
 * diff the user is talking about rather than one they are reviewing line by line.
 *
 * `+++` and `---` are excluded from the two prefix tests on purpose. They are the file
 * headers git puts above every hunk, and colouring them green and red would paint the two
 * loudest lines of every file as churn that is not there.
 */

import { DIFF_ADDITION, DIFF_CONTEXT, DIFF_DELETION, tint } from './diffTheme'

const isAddition = (line: string) => line.startsWith('+') && !line.startsWith('+++')
const isDeletion = (line: string) => line.startsWith('-') && !line.startsWith('---')

function foreground(line: string): string {
  if (isAddition(line)) return DIFF_ADDITION
  if (isDeletion(line)) return DIFF_DELETION
  return DIFF_CONTEXT
}

function background(line: string): string {
  if (isAddition(line)) return tint(DIFF_ADDITION, 12)
  if (isDeletion(line)) return tint(DIFF_DELETION, 12)
  return 'transparent'
}

export function DiffView({ diffText, maxHeight }: { diffText: string; maxHeight?: number }) {
  // `omittingEmptySubsequences: false` in the Swift, so a blank line inside the diff is a
  // line. JavaScript's split keeps them without being asked.
  const lines = diffText.split('\n')

  return (
    <div
      data-diff-view=""
      style={{
        overflow: 'auto',
        maxHeight,
        background: 'var(--wb-bg)',
        borderRadius: 8,
      }}
    >
      {lines.map((line, index) => (
        <div
          // The Swift keys on the enumerated offset, which is what makes duplicate lines
          // in a diff distinct rows rather than one.
          key={index}
          style={{
            // `.font(.system(.caption, design: .monospaced))`. On macOS the caption text
            // style is 10pt, so this is a measured value rather than a token: Theme's
            // ramp has no 10pt body size, only the 10pt tag size, which means something
            // else.
            fontSize: 10,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            whiteSpace: 'pre',
            padding: '0 8px',
            color: foreground(line),
            background: background(line),
          }}
        >
          {/* An empty line renders a space, so it keeps a row's height. */}
          {line === '' ? ' ' : line}
        </div>
      ))}
    </div>
  )
}
