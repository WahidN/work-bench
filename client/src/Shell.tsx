/*
 * The app shell: sidebar, header, the screens, and the tray badge feed.
 *
 * Stands in for ContentView.swift. Server state lives in the query layer rather than in
 * per-screen view models, so this holds only what is genuinely local: which section is
 * selected, and the last badge count pushed to the tray.
 */

import { useEffect, useRef, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { AppHeader } from './AppHeader'
import { EngineDownBanner } from './EngineDownBanner'
import { PrDetailScreen } from './PrDetailScreen'
import { PRsScreen } from './PRsScreen'
import { Sidebar } from './Sidebar'
import { TodayScreen } from './TodayScreen'
import { renderTrayIcon } from './trayBadge'
import { runFidelityCheck, runPrDetailFidelityCheck, runPrFidelityCheck } from './fidelityCheck'
import { useShellData } from './queries'
import { prListRef, type SidebarSection } from './logic'

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
  /*
   * Which pull request is open, standing in for ContentView.swift's `selectedPr`. Held as
   * an id rather than the row it was opened from, so a poll that refreshes the list feeds
   * the detail screen the new row instead of one frozen at the moment of the click.
   */
  const [openPrId, setOpenPrId] = useState<number | null>(null)
  const data = useShellData()
  const lastBadge = useRef<number | null>(null)

  // A pull request that left the list, merged or closed, closes its page rather than
  // leaving a screen backed by a row that no longer exists.
  const openPr = data.prs.find((pr) => pr.id === openPrId)
  const isDetailOpen = openPr !== undefined

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
  /*
   * Counts queries in flight anywhere, and going quiet is the signal to re-measure.
   *
   * Keying only off the shell's own five queries measured the pull request page while it
   * was still waiting on GitHub, and reported every file section as missing: the detail
   * query is owned by that screen, so nothing in this component's dependencies changed
   * when it answered. This catches any screen that loads something of its own, rather
   * than teaching the shell about each one.
   */
  const inFlight = useIsFetching()
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
        // Keyed on what is actually rendered, not on what was asked for. `openPrId` can
        // outlive the row it names, and then the list is on screen while a detail check
        // would be measuring elements that are not there.
        setFidelity(
          section !== 'Pull requests'
            ? runFidelityCheck()
            : isDetailOpen
              ? runPrDetailFidelityCheck()
              : runPrFidelityCheck(),
        )
      })
    })
    return () => {
      cancelled = true
    }
  }, [data.isLoading, data.today, data.prs, section, isDetailOpen, inFlight])

  const activeProjectCount = data.projects.filter((project) => project.status === 'active').length

  const openPrProject = data.projects.find((project) => project.id === openPr?.projectId)

  // ContentView.swift: while a pull request is open the header names it, so the kicker
  // carries the project and the heading is the ref. Both fall away when it is closed.
  const prHeaderKicker = openPrProject ? `GitHub · ${openPrProject.name}` : undefined
  const prHeaderHeading =
    openPr && prListRef(openPr, openPrProject) !== ''
      ? prListRef(openPr, openPrProject)
      : undefined

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        selection={section}
        /*
         * Clearing the detail route is not optional, and ContentView.swift's `navigate`
         * says why: it drives the PR detail screen, so leaving it set lands the user on a
         * stale detail screen instead of the list.
         */
        onSelect={(next) => {
          setSection(next)
          setOpenPrId(null)
        }}
        todos={data.today?.todos ?? []}
        jiraTodos={data.todos}
        tickets={data.tickets}
        prs={data.prs}
        projects={data.projects}
      />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppHeader
          section={section}
          activeProjectCount={activeProjectCount}
          kickerOverride={prHeaderKicker}
          headingOverride={prHeaderHeading}
        />

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
            /*
             * The detail screen lives inside this section rather than above the switch,
             * matching ContentView.swift, where only the `.pullRequests` case looks at
             * `selectedPr`. Hoisting it made every other section render the pull request
             * page instead of its own.
             */
            openPr !== undefined ? (
              <PrDetailScreen
                // Keyed on the id, as the Swift's `.id(pr.id)` is: opening a second pull
                // request has to reset the tab, the collapsed files and the edits, not
                // carry the first one's over.
                key={openPr.id}
                pr={openPr}
                onBack={() => setOpenPrId(null)}
                onOpenAgent={() => {}}
              />
            ) : (
              <PRsScreen
                prs={data.prs}
                projects={data.projects}
                onSelectPr={(pr) => setOpenPrId(pr.id)}
              />
            )
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
