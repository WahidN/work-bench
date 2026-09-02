/* Port of app/Workbench/Views/AppHeader.swift. */

import { Icon } from './Icon'
import { headerKicker, todayDateString, type SidebarSection } from './logic'

function HeaderActionButton({ title, symbol }: { title: string; symbol: string }) {
  return (
    <button
      data-action={title}
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
}: {
  section: SidebarSection
  activeProjectCount: number
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
          {headerKicker(section, activeProjectCount, todayDateString(new Date()))}
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
          {section}
        </h1>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--wb-s4)' }}>
        <HeaderActionButton title="Refresh" symbol="arrow-clockwise" />
        <HeaderActionButton
          title={section === 'Projects' ? 'Add project' : 'Agent'}
          symbol={section === 'Projects' ? 'plus' : 'sparkles'}
        />
      </div>
    </header>
  )
}
