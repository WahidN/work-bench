/* Port of app/Workbench/Views/AppHeader.swift. */

import { Icon } from './Icon'
import { headerKicker, todayDateString, type SidebarSection } from './logic'

function HeaderActionButton({
  title,
  symbol,
  onClick,
}: {
  title: string
  symbol: string
  onClick?: () => void
}) {
  return (
    <button
      data-action={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--wb-s2)',
        padding: 'var(--wb-s2) 10.08px',
        background: 'transparent',
        color: 'var(--wb-accent)',
        border: '1px solid var(--wb-accent)',
        borderRadius: 'var(--wb-radius-md)',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <Icon name={symbol} size={14} />
      <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
    </button>
  )
}

export function AppHeader({
  section,
  activeProjectCount,
  kickerOverride,
  headingOverride,
  onAddProject,
}: {
  section: SidebarSection
  activeProjectCount: number
  /*
   * ContentView.swift passes these while a pull request or a project is open, so the
   * header names what is on screen rather than the section it lives under. Overrides
   * rather than a separate header, because everything else about it stays the same.
   */
  kickerOverride?: string
  headingOverride?: string
  /*
   * On Projects the second action is Add project rather than Agent, which is a different
   * action and not the same one relabelled. Refresh and Agent are task groups 6 and 5.
   */
  onAddProject?: () => void
}) {
  return (
    <header
      id="app-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--wb-s4)',
        padding: 'var(--wb-s6) var(--wb-s8)',
        borderBottom: '1px solid var(--wb-n900)',
        flex: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 'var(--wb-fs-label)',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: 'var(--wb-n600)',
          }}
        >
          {kickerOverride ?? headerKicker(section, activeProjectCount, todayDateString(new Date()))}
        </span>
        <h1
          id="app-heading"
          style={{
            margin: 0,
            fontSize: 'var(--wb-fs-screen-title)',
            fontWeight: 500,
            letterSpacing: -0.33,
            color: 'var(--wb-text)',
          }}
        >
          {headingOverride ?? section}
        </h1>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--wb-s4)' }}>
        <HeaderActionButton title="Refresh" symbol="arrow-clockwise" />
        <HeaderActionButton
          title={section === 'Projects' ? 'Add project' : 'Agent'}
          symbol={section === 'Projects' ? 'plus' : 'sparkles'}
          onClick={section === 'Projects' ? onAddProject : undefined}
        />
      </div>
    </header>
  )
}
