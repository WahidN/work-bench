/*
 * The app shell: sidebar, header, the screens, and the tray badge feed.
 *
 * Stands in for ContentView.swift. Server state lives in the query layer rather than in
 * per-screen view models, so this holds only what is genuinely local: which section is
 * selected, and the last badge count pushed to the tray.
 */

import { useEffect, useRef, useState } from 'react'
import { AppHeader } from './AppHeader'
import { EngineDownBanner } from './EngineDownBanner'
import { PRsScreen } from './PRsScreen'
import { Sidebar } from './Sidebar'
import { TodayScreen } from './TodayScreen'
import { renderTrayIcon } from './trayBadge'
import { runFidelityCheck, runPrFidelityCheck } from './fidelityCheck'
import { useShellData } from './queries'
import type { SidebarSection } from './logic'

const IN_TAURI = '__TAURI_INTERNALS__' in window

/** The badge count is Today's `needsInput`, which is what the Swift app's badge counts. */
async function pushBadge(count: number): Promise<void> {
  if (!IN_TAURI) return
  const { invoke } = await import('@tauri-apps/api/core')
  const icon = await renderTrayIcon(count, 2)
  await invoke('set_tray_icon', {
    rgba: Array.from(icon.rgba),
    width: icon.width,
    height: icon.height,
    isTemplate: icon.isTemplate,
  })
}

export function Shell() {
  const [section, setSection] = useState<SidebarSection>('Today')
  const data = useShellData()
  const lastBadge = useRef<number | null>(null)

  // Only pushed when it changes: re-rasterising an identical icon every 30 seconds is
  // work for nothing.
  const badge = data.today?.needsInput.length ?? null
  useEffect(() => {
    if (badge === null || badge === lastBadge.current) return
    // The ref is set after the push succeeds, not before. Setting it first meant a failed
    // push was remembered as done, so the tray kept the stale count until the number
    // happened to change again.
    void pushBadge(badge)
      .then(() => {
        lastBadge.current = badge
      })
      .catch((error: unknown) => console.error('could not push the tray badge', error))
  }, [badge])

  /*
   * Re-measured after every render that changes the screen or the data, because the
   * checks read live geometry and a stale report would be worse than none.
   */
  const [fidelity, setFidelity] = useState('FIDELITY pending')
  useEffect(() => {
    // `isLoading` is in the guard and the dependencies on purpose. The five queries
    // resolve at different moments, and keying only off `today` measured the screen while
    // it was still showing "Loading…", reporting every element as missing and never
    // re-running because `today`'s identity had not changed since.
    if (data.isLoading || data.today === undefined) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (cancelled) return
      // A frame after the fonts land, so text-driven heights have settled.
      requestAnimationFrame(() => {
        if (cancelled) return
        setFidelity(section === 'Pull requests' ? runPrFidelityCheck() : runFidelityCheck())
      })
    })
    return () => {
      cancelled = true
    }
  }, [data.isLoading, data.today, section])

  const activeProjectCount = data.projects.filter((project) => project.status === 'active').length

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        selection={section}
        onSelect={setSection}
        todos={data.today?.todos ?? []}
        jiraTodos={data.todos}
        tickets={data.tickets}
        prs={data.prs}
        projects={data.projects}
      />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppHeader section={section} activeProjectCount={activeProjectCount} />

        {/*
          An engine that does not answer says so, rather than rendering empty lists. The
          install state and the start action are wired in task group 7; until then the
          banner reports the failure and points at Settings.
        */}
        {data.error && (
          <EngineDownBanner
            isAgentInstalled={false}
            errorMessage={String(data.error)}
            isBusy={false}
            onStart={() => {}}
            onOpenSettings={() => {}}
          />
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {data.isLoading ? (
            <p style={{ padding: 'var(--wb-s8)', color: 'var(--wb-n500)' }}>Loading…</p>
          ) : data.today === undefined ? null : section === 'Pull requests' ? (
            <PRsScreen prs={data.prs} projects={data.projects} />
          ) : section === 'Today' ? (
            <TodayScreen
              today={data.today}
              prs={data.prs}
              projects={data.projects}
              tickets={data.tickets}
            />
          ) : (
            <p style={{ padding: 'var(--wb-s8)', color: 'var(--wb-n500)' }}>
              Not ported yet. Task groups 4 to 7 cover this screen.
            </p>
          )}
        </div>
      </main>

      {/* Read by the checks rather than shown for its own sake. */}
      <pre
        id="shell-state"
        style={{ position: 'fixed', left: -9999, top: 0 }}
      >{`badge=${badge ?? -1} todos=${data.today?.todos.length ?? -1} allTodos=${data.todos.length} prs=${data.prs.length} projects=${data.projects.length} tickets=${data.tickets.length} error=${data.error ? String(data.error) : 'none'}`}</pre>
      <pre id="fidelity" style={{ position: 'fixed', left: -9999, top: 0 }}>
        {fidelity}
      </pre>
    </div>
  )
}
