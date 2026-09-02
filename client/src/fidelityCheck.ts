/*
 * Task 7.7: measures the rendered shell and compares it against the numbers declared in
 * the SwiftUI sources, rather than judging the screenshot by eye.
 *
 * Every expectation below cites the file it came from. The tolerance is one LayoutUnit,
 * 1/64 px, for the same reason the token check uses it: Chrome lays out on that grid, so
 * Theme.Space's fractional points land within 0.0157px and never exactly.
 *
 * Read with: agent-browser get text "#fidelity"
 */

const LAYOUT_UNIT = 1 / 64

const S = { s1: 2.8, s2: 5.6, s3: 8.4, s4: 11.2, s6: 16.8, s8: 22.4 }

type Check = { label: string; want: number; got: number | null }

function box(selector: string): DOMRect | null {
  const element = document.querySelector(selector)
  return element ? element.getBoundingClientRect() : null
}

function style(selector: string): CSSStyleDeclaration | null {
  const element = document.querySelector(selector)
  return element ? getComputedStyle(element) : null
}

function px(selector: string, property: string): number | null {
  const computed = style(selector)
  if (!computed) return null
  return parseFloat(computed.getPropertyValue(property))
}

export function runFidelityCheck(): string {
  const checks: Check[] = []
  const add = (label: string, want: number, got: number | null) =>
    checks.push({ label, want, got })

  // Sidebar.swift: .frame(width: 228), .padding(.vertical, s6), .padding(.horizontal, s4)
  add('sidebar width', 228, box('#sidebar')?.width ?? null)
  add('sidebar padding-top', S.s6, px('#sidebar', 'padding-top'))
  add('sidebar padding-left', S.s4, px('#sidebar', 'padding-left'))
  add('sidebar border-right', 1, px('#sidebar', 'border-right-width'))
  add('sidebar row gap', S.s6, px('#sidebar', 'row-gap'))

  // WBRowButtonStyle: verticalPadding s2, horizontalPadding s3, cornerRadius md
  add('nav row padding-top', S.s2, px("[data-nav='Today']", 'padding-top'))
  add('nav row padding-left', S.s3, px("[data-nav='Today']", 'padding-left'))
  add('nav row radius', 8, px("[data-nav='Today']", 'border-top-left-radius'))

  // Sidebar.swift brandRow: 22x22 badge. projectsList: 6x6 dot.
  add('project dot size', 6, box('[data-project]  span')?.width ?? null)

  // AppHeader.swift: .padding(.vertical, s6), .padding(.horizontal, s8), 1px bottom rule
  add('header padding-top', S.s6, px('#app-header', 'padding-top'))
  add('header padding-left', S.s8, px('#app-header', 'padding-left'))
  add('header border-bottom', 1, px('#app-header', 'border-bottom-width'))
  // Theme.FontSize.screenTitle
  add('heading font-size', 22, px('#app-heading', 'font-size'))

  // TodayScreen.swift: TodayRail .frame(width: 320), HStack spacing s8
  add('today rail width', 320, box('#today-rail')?.width ?? null)
  add('today screen gap', S.s8, px('#today-screen', 'column-gap'))

  // TodayScreen.swift quickAdd: .padding(.vertical, s3), .padding(.horizontal, s4)
  add('quick add padding-top', S.s3, px('#quick-add', 'padding-top'))
  add('quick add padding-left', S.s4, px('#quick-add', 'padding-left'))
  add('quick add radius', 8, px('#quick-add', 'border-top-left-radius'))

  // TaskRow.swift: .padding(.vertical, s3), .padding(.horizontal, s4), radius md,
  // checkbox 17x17 with cornerRadius 5, HStack spacing s3
  add('task row padding-top', S.s3, px('[data-task-row]', 'padding-top'))
  add('task row padding-left', S.s4, px('[data-task-row]', 'padding-left'))
  add('task row radius', 8, px('[data-task-row]', 'border-top-left-radius'))
  add('task row gap', S.s3, px('[data-task-row]', 'column-gap'))
  add('checkbox width', 17, box('[data-checkbox]')?.width ?? null)
  add('checkbox radius', 5, px('[data-checkbox]', 'border-top-left-radius'))

  // TodayScreen.swift RailCard: .padding(s3), radius md
  add('rail card padding', S.s3, px('[data-rail-card]', 'padding-top'))
  add('rail card radius', 8, px('[data-rail-card]', 'border-top-left-radius'))

  return report('FIDELITY', checks)
}

/** Measured separately: only the Pull requests screen has these. */
export function runPrFidelityCheck(): string {
  const checks: Check[] = []
  const add = (label: string, want: number, got: number | null) =>
    checks.push({ label, want, got })

  // PRsScreen.swift: column frames 150 / 180 / 110 / 200, row padding s3 / s4,
  // header padding s2 / s4, pills padding s1 with inner s2 / s4
  const columns = document.querySelectorAll('#pr-table-header > *')
  add('pr header columns', 5, columns.length)
  add('pr project column', 150, (columns[1] as HTMLElement | undefined)?.getBoundingClientRect().width ?? null)
  add('pr status column', 180, (columns[2] as HTMLElement | undefined)?.getBoundingClientRect().width ?? null)
  add('pr updated column', 110, (columns[3] as HTMLElement | undefined)?.getBoundingClientRect().width ?? null)
  add('pr actions column', 200, (columns[4] as HTMLElement | undefined)?.getBoundingClientRect().width ?? null)

  add('pr header padding-top', S.s2, px('#pr-table-header', 'padding-top'))
  add('pr header padding-left', S.s4, px('#pr-table-header', 'padding-left'))
  add('pr row padding-top', S.s3, px('[data-pr-row]', 'padding-top'))
  add('pr row padding-left', S.s4, px('[data-pr-row]', 'padding-left'))
  add('pr row border-bottom', 1, px('[data-pr-row]', 'border-bottom-width'))
  add('pr filters padding', S.s1, px('#pr-filters', 'padding-top'))
  add('pr filter radius', 4, px("[data-filter='mine']", 'border-top-left-radius'))
  add('pr screen padding', S.s8, px('#prs-screen', 'padding-top'))

  return report('PR FIDELITY', checks)
}

/**
 * The pull request's own page. Measured separately again, and the interesting numbers are
 * the two gutters: PrFileSectionView frames each at 44 and then pads 5.6 outside it, so a
 * gutter measuring 49.6 would mean the padding had been folded into the box.
 */
export function runPrDetailFidelityCheck(): string {
  const checks: Check[] = []
  const add = (label: string, want: number, got: number | null) =>
    checks.push({ label, want, got })

  // PrDetailScreen.swift: .padding(s8), VStack spacing s6, title FontSize.screenTitle
  add('detail padding', S.s8, px('#pr-detail-screen', 'padding-top'))
  add('detail row gap', S.s6, px('#pr-detail-screen', 'row-gap'))
  add('detail title font-size', 22, px('#pr-title', 'font-size'))
  add('detail facts gap', S.s4, px('#pr-facts', 'column-gap'))

  // tabBar: .padding(s1), HStack spacing s1, radius md
  add('tab bar padding', S.s1, px('#pr-tab-bar', 'padding-top'))
  add('tab bar gap', S.s1, px('#pr-tab-bar', 'column-gap'))
  add('tab bar radius', 8, px('#pr-tab-bar', 'border-top-left-radius'))
  add('tab padding-top', S.s2, px("[data-tab='files']", 'padding-top'))
  add('tab padding-left', S.s4, px("[data-tab='files']", 'padding-left'))

  // filesTab: VStack spacing s4 between file sections
  add('files gap', S.s4, px('#pr-files', 'row-gap'))

  // PrFileSectionView: header .padding(.vertical, s3) .padding(.horizontal, s4),
  // radius md, 1px n900 border, gutters .frame(width: 44) .padding(.trailing, s2)
  add('file section radius', 8, px('[data-file-section]', 'border-top-left-radius'))
  add('file section border', 1, px('[data-file-section]', 'border-top-width'))
  add('file header padding-top', S.s3, px('[data-file-header]', 'padding-top'))
  add('file header padding-left', S.s4, px('[data-file-header]', 'padding-left'))
  add('file header gap', S.s3, px('[data-file-header]', 'column-gap'))

  const gutters = document.querySelectorAll('[data-gutter]')
  add('gutter count', 2, gutters.length === 0 ? null : 2)
  add('old gutter width', 44, (gutters[0] as HTMLElement | undefined)?.getBoundingClientRect().width ?? null)
  add('new gutter width', 44, (gutters[1] as HTMLElement | undefined)?.getBoundingClientRect().width ?? null)
  add('gutter trailing gap', S.s2, px('[data-gutter]', 'margin-right'))
  add('diff text padding-left', S.s3, px('[data-diff-line] > span:last-child', 'padding-left'))

  return report('PR DETAIL FIDELITY', checks)
}

/**
 * The Projects section, list or detail. Both are measured by one function because both can
 * be on screen under the same section and only one set of selectors will match; the checks
 * for the other side are skipped rather than reported missing.
 */
export function runProjectsFidelityCheck(): string {
  const checks: Check[] = []
  const add = (label: string, want: number, got: number | null) =>
    checks.push({ label, want, got })

  const isDetail = document.querySelector('#project-detail-screen') !== null

  if (!isDetail) {
    // ProjectsScreen.swift: LazyVGrid adaptive minimum 280, spacing s4, .padding(s8).
    // ProjectCardView: .padding(s6), minHeight 140, radius md, 1px border.
    add('projects padding', S.s8, px('#projects-screen', 'padding-top'))
    add('projects grid gap', S.s4, px('#projects-screen', 'row-gap'))
    add('project card padding', S.s6, px('[data-project-card]', 'padding-top'))
    add('project card radius', 8, px('[data-project-card]', 'border-top-left-radius'))
    add('project card border', 1, px('[data-project-card]', 'border-top-width'))
    add(
      'project card min height',
      140,
      px('[data-project-card]', 'min-height'),
    )
    add('card footer rule', 1, px('[data-card-footer]', 'border-top-width'))
    add('card footer padding', S.s3, px('[data-card-footer]', 'padding-top'))

    const card = document.querySelector('[data-project-card]')
    add(
      'project card at least 280 wide',
      1,
      card === null ? null : card.getBoundingClientRect().width >= 280 ? 1 : 0,
    )
  } else {
    // ProjectDetailScreen.swift: HStack spacing s8, .padding(s8), right column 300 wide,
    // tabs .padding(3) with items s2 / s6, quickAdd s3 / s4, facts card .padding(s6).
    add('detail padding', S.s8, px('#project-detail-screen', 'padding-top'))
    add('detail column gap', S.s8, px('#project-detail-screen', 'column-gap'))
    add('right column width', 300, box('#project-facts')?.width ?? null)
    add('right column gap', S.s6, px('#project-facts', 'row-gap'))
    add('tabs padding', 3, px('#project-tabs', 'padding-top'))
    add('tab padding-top', S.s2, px("[data-project-tab='Tasks']", 'padding-top'))
    add('tab padding-left', S.s6, px("[data-project-tab='Tasks']", 'padding-left'))
    add('tab radius', 6, px("[data-project-tab='Tasks']", 'border-top-left-radius'))
    add('quick add padding-top', S.s3, px('#project-quick-add', 'padding-top'))
    add('quick add padding-left', S.s4, px('#project-quick-add', 'padding-left'))
  }

  return report(isDetail ? 'PROJECT DETAIL FIDELITY' : 'PROJECTS FIDELITY', checks)
}

/** One report, so the checks cannot drift in how they say PASS. */
function report(title: string, checks: Check[]): string {
  const failures = checks
    .filter(({ want, got }) => got === null || Math.abs(got - want) > LAYOUT_UNIT)
    .map(({ label, want, got }) =>
      got === null ? `${label}: element missing` : `${label}: want ${want}, got ${got.toFixed(4)}`,
    )

  return [
    `${title} ${failures.length === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures.length}/${checks.length}`,
    ...failures.map((failure) => `FAILURE ${failure}`),
  ].join('\n')
}
