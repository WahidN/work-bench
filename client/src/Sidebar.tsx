/*
 * Port of app/Workbench/Views/Sidebar.swift.
 *
 * Everything here is live: the rows, the project list, the search button and the gear.
 */

import type { Pr, Project, Ticket, Todo } from './queries'
import { Icon } from './Icon'
import { SettingsButton } from './SettingsSheet'
import {
  SECTIONS,
  SECTION_SYMBOL,
  accountInitials,
  navCount,
  projectDotColor,
  projectOpenCount,
  type SidebarSection,
} from './logic'

const WIDTH = 228

export function Sidebar({
  selection,
  onSelect,
  onOpenPalette,
  onOpenSettings,
  accountName,
  selectedProjectId,
  onSelectProject,
  todos,
  jiraTodos,
  tickets,
  prs,
  projects,
}: {
  selection: SidebarSection
  onSelect: (section: SidebarSection) => void
  onOpenPalette: () => void
  onOpenSettings: () => void
  /**
   * From Rust, because `ProcessInfo.processInfo.fullUserName` is not something a webview
   * can see. Empty until it answers, and in a browser always.
   */
  accountName: string
  /** SidebarLogic.isProjectSelected is `project.id == selectedProject?.id`, so an id is enough. */
  selectedProjectId: number | null
  onSelectProject: (project: Project) => void
  todos: Todo[]
  jiraTodos: Todo[]
  tickets: Ticket[]
  prs: Pr[]
  projects: Project[]
}) {
  const shownName = accountName === '' ? UNKNOWN_ACCOUNT : accountName

  return (
    <div
      id="sidebar"
      style={{
        width: WIDTH,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s6)',
        padding: 'var(--wb-s6) var(--wb-s4)',
        boxSizing: 'border-box',
        background: 'linear-gradient(to bottom, var(--wb-sidebar-gradient-top), var(--wb-bg))',
        borderRight: '1px solid var(--wb-n900)',
        height: '100%',
      }}
    >
      {/* brandRow */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--wb-s3)',
          padding: '0 var(--wb-s2)',
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            flex: 'none',
            borderRadius: 6,
            border: '1px solid var(--wb-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--wb-accent)',
          }}
        >
          <Icon name="wrench-and-screwdriver" size={12} />
        </div>
        <span
          style={{
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: -0.15,
            color: 'var(--wb-text)',
          }}
        >
          Workbench
        </span>
      </div>

      {/* SearchButton */}
      <button
        id="sidebar-search"
        onClick={onOpenPalette}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: 'var(--wb-s2)',
          padding: 'var(--wb-s2) 10.08px',
          background: 'transparent',
          border: '1px solid var(--wb-n800)',
          borderRadius: 'var(--wb-radius-md)',
          color: 'var(--wb-n400)',
          fontFamily: 'inherit',
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <Icon name="magnifyingglass" size={14} />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Search or add</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>
          ⌘K
        </span>
      </button>

      {/* navRows */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECTIONS.map((section) => {
          const isSelected = section === selection
          return (
            <button
              key={section}
              data-nav={section}
              onClick={() => onSelect(section)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--wb-s3)',
                // WBRowButtonStyle: the row's own padding and radius.
                padding: 'var(--wb-s2) var(--wb-s3)',
                borderRadius: 'var(--wb-radius-md)',
                border: 'none',
                background: isSelected ? 'var(--wb-a900)' : 'transparent',
                color: isSelected ? 'var(--wb-a200)' : 'var(--wb-n400)',
                font: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon name={SECTION_SYMBOL[section]} size={16} />
              <span style={{ fontSize: 'var(--wb-fs-body)' }}>{section}</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--wb-fs-label)',
                  color: 'var(--wb-n600)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {navCount(section, { todos, jiraTodos, tickets, prs, projects })}
              </span>
            </button>
          )
        })}
      </nav>

      {/* projectsList */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)', flex: 1, minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 var(--wb-s3)',
            fontSize: 'var(--wb-fs-label)',
          }}
        >
          <span style={{ letterSpacing: 0.8, color: 'var(--wb-n600)' }}>PROJECTS</span>
          <span style={{ marginLeft: 'auto', color: 'var(--wb-n700)' }}>{projects.length}</span>
        </div>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {projects.map((project, index) => {
            const isSelected = project.id === selectedProjectId
            return (
            <button
              key={project.id}
              data-project={project.id}
              onClick={() => onSelectProject(project)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--wb-s3)',
                padding: 'var(--wb-s2) var(--wb-s3)',
                borderRadius: 'var(--wb-radius-md)',
                border: 'none',
                // WBRowButtonStyle with `selectedBackground: Theme.Neutral.n900`, which is
                // a different selected tone from the nav rows above.
                background: isSelected ? 'var(--wb-n900)' : 'transparent',
                color: isSelected ? 'var(--wb-text)' : 'var(--wb-n500)',
                font: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  flex: 'none',
                  borderRadius: '50%',
                  background: projectDotColor(index),
                }}
              />
              <span
                style={{
                  fontSize: 'var(--wb-fs-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {project.name}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--wb-fs-label)',
                  color: 'var(--wb-n600)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {projectOpenCount(project, todos)}
              </span>
            </button>
            )
          })}
        </div>
      </div>

      {/* footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--wb-s3)',
          padding: 'var(--wb-s2) var(--wb-s3)',
          borderTop: '1px solid var(--wb-n900)',
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            flex: 'none',
            borderRadius: '50%',
            background: 'var(--wb-a800)',
            color: 'var(--wb-a200)',
            fontSize: 'var(--wb-fs-tag)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {accountInitials(shownName)}
        </span>
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n400)' }}>
          {shownName}
        </span>
        <span style={{ marginLeft: 'auto', padding: 'var(--wb-s2)' }}>
          <SettingsButton onClick={onOpenSettings} />
        </span>
      </div>
    </div>
  )
}

/**
 * What the footer says before Rust has answered, and always in a browser.
 *
 * Not a name: an empty footer with no initials reads as broken, and inventing one would be
 * worse than saying there is none.
 */
const UNKNOWN_ACCOUNT = 'Not signed in'
