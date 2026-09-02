/*
 * Compares the rendered swatch page against the values in
 * app/Workbench/Views/Theme.swift.
 *
 * This lives in the page rather than in a browser eval snippet for two reasons: this
 * session's sandbox refuses `agent-browser eval`, and a check that ships with the
 * page can be re-read at any time with `agent-browser get text #token-check`.
 */

/** Expected values, transcribed from Theme.swift. */
const COLORS: Record<string, string> = {
  n100: 'rgb(243, 245, 254)',
  n500: 'rgb(147, 151, 171)',
  n900: 'rgb(41, 43, 49)',
  a400: 'rgb(181, 171, 252)',
  a900: 'rgb(43, 39, 65)',
  'status-needs-review': 'rgb(181, 171, 252)',
  'status-changes-requested': 'rgb(196, 154, 176)',
  'status-approved': 'rgb(143, 191, 159)',
  'status-blocked': 'rgb(196, 177, 138)',
  'status-draft': 'rgb(147, 151, 171)',
  negative: 'rgb(196, 154, 154)',
  bg: 'rgb(22, 24, 38)',
  surface: 'rgb(35, 37, 50)',
  'sidebar-gradient-top': 'rgb(26, 28, 43)',
  'palette-surface': 'rgb(28, 30, 44)',
  accent: 'rgb(145, 132, 217)',
  'dot-0': 'rgb(145, 132, 217)',
  'dot-3': 'rgb(143, 191, 159)',
  'dot-7': 'rgb(196, 154, 154)',
}

const SPACE: Record<string, number> = { s1: 2.8, s2: 5.6, s3: 8.4, s4: 11.2, s6: 16.8, s8: 22.4 }
const RADIUS: Record<string, number> = { 'radius-sm': 4, 'radius-md': 8, 'radius-lg': 14 }
const FONT_SIZE: Record<string, number> = {
  'fs-screen-title': 22,
  'fs-card-title': 15,
  'fs-body': 14,
  'fs-secondary': 13,
  'fs-table-meta': 12,
  'fs-label': 11,
  'fs-tag': 10,
}

export type TokenCheckResult = {
  checked: number
  passed: number
  failures: string[]
  fonts: Record<string, string>
}

export function runTokenCheck(): TokenCheckResult {
  const failures: string[] = []
  let checked = 0

  const compare = (label: string, want: string | number, got: string | number, ok: boolean) => {
    checked += 1
    if (!ok) failures.push(`${label}: want ${want}, got ${got}`)
  }

  for (const [token, want] of Object.entries(COLORS)) {
    const el = document.getElementById(`swatch-${token}`)
    if (!el) {
      checked += 1
      failures.push(`${token}: element missing`)
      continue
    }
    const got = getComputedStyle(el).backgroundColor
    compare(token, want, got, got === want)
  }

  // Measured width, not the declared value, so a fractional point that the browser
  // rounds away shows up here rather than passing silently.
  //
  // The tolerance is one LayoutUnit, 1/64 px, because that is the grid Chrome
  // actually lays out on: Theme.Space.s4 is 11.2, and 11.2 * 64 = 716.8, which
  // quantizes to 716/64 = 11.1875. All six space tokens land on that grid. So CSS
  // cannot hold SwiftUI's exact fractional points, it holds them to within
  // 0.0157px, and the largest error across the ramp is s4's 0.0125px.
  const LAYOUT_UNIT = 1 / 64

  for (const [token, want] of Object.entries(SPACE)) {
    const bar = document.getElementById(`space-${token}`)?.firstElementChild
    if (!bar) {
      checked += 1
      failures.push(`${token}: element missing`)
      continue
    }
    const got = bar.getBoundingClientRect().width
    compare(token, `${want}px`, `${got.toFixed(4)}px`, Math.abs(got - want) <= LAYOUT_UNIT)
  }

  /*
   * A missing element is reported, never asserted away. These used to be non-null
   * assertions, which threw instead of failing: the caller runs inside a
   * `requestAnimationFrame` with no `try`, so one missing element crashed silently and
   * left the report stuck on "pending" rather than saying what was wrong. Reporting it is
   * the entire job of this file.
   */
  const styleOf = (id: string): CSSStyleDeclaration | null => {
    const el = document.getElementById(id)
    return el === null ? null : getComputedStyle(el)
  }

  for (const [token, want] of Object.entries(RADIUS)) {
    const computed = styleOf(`radius-${token}`)
    if (computed === null) {
      checked += 1
      failures.push(`${token}: element missing`)
      continue
    }
    const got = parseFloat(computed.borderTopLeftRadius)
    compare(token, want, got, got === want)
  }

  for (const [token, want] of Object.entries(FONT_SIZE)) {
    const computed = styleOf(`font-${token}`)
    if (computed === null) {
      checked += 1
      failures.push(`${token}: element missing`)
      continue
    }
    const got = parseFloat(computed.fontSize)
    compare(token, want, got, got === want)
  }

  const heading = styleOf('face-heading')
  const body = styleOf('face-body')
  if (heading === null || body === null) {
    checked += 1
    failures.push('font faces: element missing')
  }

  return {
    checked,
    passed: checked - failures.length,
    failures,
    fonts: {
      family: heading?.fontFamily.split(',')[0].replace(/["']/g, '') ?? 'missing',
      headingWeight: heading?.fontWeight ?? 'missing',
      bodyWeight: body?.fontWeight ?? 'missing',
      interMediumLoaded: String(document.fonts.check('500 15px Inter')),
      interRegularLoaded: String(document.fonts.check('400 15px Inter')),
    },
  }
}

export function formatTokenCheck(r: TokenCheckResult): string {
  const lines = [
    `TOKEN CHECK ${r.failures.length === 0 ? 'PASS' : 'FAIL'} ${r.passed}/${r.checked}`,
    `fonts family=${r.fonts.family} heading=${r.fonts.headingWeight} body=${r.fonts.bodyWeight} ` +
      `interMedium=${r.fonts.interMediumLoaded} interRegular=${r.fonts.interRegularLoaded}`,
  ]
  for (const f of r.failures) lines.push(`FAILURE ${f}`)
  return lines.join('\n')
}
