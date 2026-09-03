/*
 * The app shell: sidebar, header, the screens, and the tray badge feed.
 *
 * Stands in for ContentView.swift. Server state lives in the query layer rather than in
 * per-screen view models, so this holds only what is genuinely local: which section is
 * selected, and the last badge count pushed to the tray.
 */

import { useEffect, useRef, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { AgentChatPanel } from './AgentChatPanel'
import { chatTargetForTodo, targetProjectId, type AgentChatTarget } from './agentChatLogic'
import { AppHeader } from './AppHeader'
import { CommandPalette } from './CommandPalette'
import type { PaletteAction } from './commandPaletteLogic'
import { EngineDownBanner } from './EngineDownBanner'
import { ErrorAlert } from './ErrorAlert'
import { JiraScreen } from './JiraScreen'
import { PrDetailScreen } from './PrDetailScreen'
import { PRsScreen } from './PRsScreen'
import { ProjectDetailScreen } from './ProjectDetailScreen'
import { ProjectFormSheet, type ProjectSheetMode } from './ProjectFormSheet'
import { ProjectsScreen } from './ProjectsScreen'
import { SettingsSheet } from './SettingsSheet'
import { Sidebar } from './Sidebar'
import { TodayScreen } from './TodayScreen'
import { renderTrayIcon } from './trayBadge'
import {
  runFidelityCheck,
  runPrDetailFidelityCheck,
  runAgentPanelFidelityCheck,
  runJiraFidelityCheck,
  runPrFidelityCheck,
  runProjectsFidelityCheck,
} from './fidelityCheck'
import {
  useAllTodos,
  useCreateProject,
  useCreateTodo,
  useDeleteProject,
  useDeleteTodo,
  useRefresh,
  useSetTodoDone,
  useSetTodoPinned,
  useShellData,
  useUpdateProject,
  fetchCommentFixes,
  fetchPrReview,
} from './queries'
import {
  UNKNOWN_AGENT,
  agentStart,
  agentState,
  canManageAgent,
  type AgentState,
} from './engineAgent'
import { accountName, notify, requestNotificationPermission } from './native'
import {
  REVIEW_TITLE,
  fixBody,
  fixTitle,
  fixesToAnnounce,
  itemKey,
  needsInputTitle,
  newlyAppeared,
  reviewBody,
  reviewsToAnnounce,
  unpostedCount,
} from './notificationLogic'
import type { PrReviewView } from './prReviewLogic'
import { projectCards } from './projectsLogic'
import { prListRef, type SidebarSection, type TaskRow as TaskRowModel } from './logic'
import { isTypingIn, matchShortcut, shortcutForMenuId, type Shortcut } from './shortcuts'

const IN_TAURI = '__TAURI_INTERNALS__' in window

/**
 * How often the review notification looks again.
 *
 * The Swift's loop is 15 seconds and reloads Today in the same turn; here that reload is
 * the query layer's own 30-second poll, so this matches it. Half a minute late for a review
 * that took minutes is not a difference anyone feels.
 */
const REVIEW_BEAT_MS = 30_000

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
  /** ContentView.swift's `openProjectId`, held for the same reason `openPrId` is. */
  const [openProjectId, setOpenProjectId] = useState<number | null>(null)
  const [sheet, setSheet] = useState<ProjectSheetMode | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  /** `AgentChatViewModel.target`: null is closed, which is what `isOpen` reads. */
  const [chatTarget, setChatTarget] = useState<AgentChatTarget | null>(null)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  /*
   * The agent's state, held here rather than in the sheet because the unreachable banner
   * shows it too. `EngineViewModel` is one type on purpose, so the Settings sheet and the
   * banner cannot disagree about whether the engine is up.
   */
  const [agent, setAgent] = useState<AgentState>(UNKNOWN_AGENT)
  const [isStartingAgent, setIsStartingAgent] = useState(false)
  const [account, setAccount] = useState('')
  const data = useShellData()
  /*
   * Every todo, done ones included, read by three surfaces: the sidebar's Jira count, the
   * project cards, and the Jira screen. ContentView.swift loads it once at that level for
   * the same three, rather than per screen.
   */
  const allTodos = useAllTodos()
  const everyTodo = allTodos.data ?? []
  const lastBadge = useRef<number | null>(null)

  const createTodo = useCreateTodo()
  const deleteTodo = useDeleteTodo()
  const setTodoDone = useSetTodoDone()
  const setTodoPinned = useSetTodoPinned()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const refresh = useRefresh()

  const onError = (error: Error) => setAlert(String(error))

  // A pull request that left the list, merged or closed, closes its page rather than
  // leaving a screen backed by a row that no longer exists. Same for a deleted project.
  const openPr = data.prs.find((pr) => pr.id === openPrId)
  const openProject = data.projects.find((project) => project.id === openProjectId)
  const isDetailOpen = openPr !== undefined
  const isProjectOpen = openProject !== undefined
  const isChatOpen = chatTarget !== null

  /*
   * `today.todos`, not `/todos`, which is what ContentView.swift hands the project screen.
   *
   * The engine's `listTodayTodos` is `(source = 'manual' OR pinned = 1) AND (done = 0 OR
   * done_at = today)`, so it carries the tasks finished today; `/todos` carries only open
   * ones. Reading the wrong list made a task vanish from a project's Tasks tab the moment
   * it was ticked, with no way to untick it, which is also why `projectTaskRows` bothers
   * to sort the done ones last.
   */
  const projectTodos = data.today?.todos ?? []

  /*
   * The project the open chat belongs to, and for a pull request the issue that supplies
   * its title. Both are looked up here rather than carried on the target, so a poll that
   * refreshes the lists feeds the panel the current record.
   */
  const chatProject =
    chatTarget === null
      ? undefined
      : data.projects.find((candidate) => candidate.id === targetProjectId(chatTarget))
  const chatLinkedTicket =
    chatTarget?.kind === 'pullRequest'
      ? data.tickets.find((candidate) => candidate.id === chatTarget.pr.ticketId)
      : undefined

  /*
   * `navigate(to:)` in ContentView, which clears both detail routes: they drive the PR
   * detail and project detail screens, so leaving them set lands the user on a stale
   * detail screen instead of the list.
   */
  function navigate(next: SidebarSection) {
    setSection(next)
    setOpenPrId(null)
    setOpenProjectId(null)
  }

  /**
   * `openProjectChat` in ContentView: the header's Agent button and ⌘J are project-scoped,
   * and fall back to the first project when none is selected, so a fresh window still has
   * something to ask about.
   */
  function openProjectChat() {
    const project = openProject ?? data.projects[0]
    if (project) setChatTarget({ kind: 'project', project })
  }

  function runShortcut(shortcut: Shortcut) {
    switch (shortcut.kind) {
      case 'palette':
        setIsPaletteOpen(true)
        return
      case 'navigate':
        navigate(shortcut.section)
        return
      case 'askAgent':
        openProjectChat()
        return
    }
  }

  function runPaletteAction(action: PaletteAction) {
    switch (action.kind) {
      case 'navigate':
        navigate(action.section)
        return
      case 'askAgent':
        openProjectChat()
        return
      case 'openProject':
        navigate('Projects')
        setOpenProjectId(action.project.id)
        return
      case 'addTask':
        /*
         * And then go to Today, which `runPaletteRow` does after the create lands. Without
         * it, typing a task into the palette from Pull requests closes the palette and
         * shows nothing: the task exists, on a screen the user is not looking at.
         *
         * On success only, so a failed create does not move anyone for nothing.
         */
        createTodo.mutate(
          { text: action.text },
          { onSuccess: () => navigate('Today'), onError },
        )
        return
    }
  }

  /*
   * The Go menu, as a window key handler. AppKit would route these through the menu bar
   * and give a focused field first refusal; a webview has neither, so `isTypingIn` is what
   * stops ⌘1 navigating away in the middle of a sentence. See shortcuts.ts.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = matchShortcut(event, isTypingIn(document.activeElement))
      if (shortcut === null) return
      event.preventDefault()
      runShortcut(shortcut)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // Deliberately no dependency array: the handler closes over the open project and the
    // project list, and re-registering one listener per render is cheaper than the ref
    // dance that would keep a single registration's closure current.
  })

  /*
   * The same actions from the native Go menu, which is the half of AppCommands.swift a
   * window key handler cannot be: a menu is where a macOS user looks to find out what an
   * app can do. See src-tauri/src/menu.rs.
   */
  useEffect(() => {
    if (!IN_TAURI) return
    let stop: (() => void) | undefined
    let cancelled = false
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('go-menu', (event) => {
        const shortcut = shortcutForMenuId(event.payload)
        if (shortcut !== null) runShortcut(shortcut)
      }).then((unlisten) => {
        // The listener is async to register, so an unmount can beat it here.
        if (cancelled) unlisten()
        else stop = unlisten
      }),
    )
    return () => {
      cancelled = true
      stop?.()
    }
  })

  /*
   * Read once at launch, so the banner can offer Start rather than only pointing at
   * Settings. Unreachable in a browser, where it stays at UNKNOWN_AGENT and the banner
   * falls back to the Settings link.
   */
  useEffect(() => {
    if (!canManageAgent) return
    void agentState()
      .then(setAgent)
      .catch((error: unknown) => console.error('could not read the agent state', error))
  }, [])

  function startAgent() {
    setIsStartingAgent(true)
    void agentStart()
      .then(setAgent)
      .catch((error: unknown) => setAlert(String(error)))
      .finally(() => setIsStartingAgent(false))
  }

  /*
   * The account name and the notification permission, both once at launch.
   *
   * Asking for permission here rather than at the first notification is what
   * `applicationDidFinishLaunching` does, and for the reason it matters: the macOS prompt
   * appearing at the moment something happened would cover the thing that happened, and
   * the notification would be dropped while the user read the prompt.
   */
  useEffect(() => {
    void accountName().then(setAccount).catch(() => setAccount(''))
    void requestNotificationPermission()
  }, [])

  /*
   * Notifies for what appeared in `needsInput` since the last look, and for a review that
   * finished with something to post. Two signals on purpose; see notificationLogic.ts.
   *
   * `seenKeys` starts null rather than empty, which is `isFirstCycle`: on launch every item
   * is new, and a notification per open ticket is not a welcome.
   */
  const seenKeys = useRef<Set<string> | null>(null)
  const items = data.today?.needsInput
  useEffect(() => {
    if (items === undefined) return
    const current = new Set(items.map(itemKey))
    const previous = seenKeys.current
    seenKeys.current = current
    if (previous === null) return
    for (const item of newlyAppeared(items, previous)) {
      void notify(needsInputTitle(item), item.title)
    }
  }, [items])

  /*
   * A finished review, announced once per pull request.
   *
   * Fetched rather than read out of the query cache, which is what `announceFinishedReviews`
   * does and for the reason it has to: `usePrReview` only holds a pull request whose page was
   * opened or whose Review button was pressed, and `ReviewStarter` stops the moment the user
   * leaves the list. Reading the cache meant the one case this exists for, a review finishing
   * while the user is elsewhere, was exactly the case it missed.
   *
   * The cost is what the Swift accepts, and its comment says why it is small: a pull request
   * whose review is already announced needs no fetching, and one that has never been reviewed
   * answers with an empty list. `announcedReviews` is a ref, so a re-render cannot reannounce
   * and cannot refetch what has been said.
   */
  const client = useQueryClient()
  const announcedReviews = useRef<Set<number>>(new Set())
  const announcedFixes = useRef<Set<number>>(new Set())
  const sessionStart = useRef(new Date().toISOString())
  /*
   * The pull requests, in a ref, so the interval below can read the current list without
   * being torn down and restarted every time a poll hands back a new array.
   */
  const currentPrs = useRef(data.prs)
  currentPrs.current = data.prs

  useEffect(() => {
    let cancelled = false

    async function look() {
      const reviews = new Map<number, PrReviewView>()
      for (const pr of currentPrs.current) {
        if (announcedReviews.current.has(pr.id)) continue
        try {
          reviews.set(pr.id, await fetchPrReview(client, pr.id, REVIEW_BEAT_MS - 5_000))
        } catch {
          // One pull request the engine will not answer for is no reason to stop looking
          // at the rest, and not something to interrupt anyone about.
        }
      }
      if (cancelled) return

      for (const prId of reviewsToAnnounce(reviews, announcedReviews.current)) {
        const pr = currentPrs.current.find((candidate) => candidate.id === prId)
        const review = reviews.get(prId)
        if (pr === undefined || review === undefined) continue
        void notify(REVIEW_TITLE, reviewBody(pr.title, unpostedCount(review)))
        announcedReviews.current.add(prId)
      }
    }

    /*
     * A finished fix, announced once each. Read on the same beat as the review and for
     * the same reason: the thread that started it is usually not on screen when it ends,
     * and after a restart the engine has already failed what was running.
     */
    async function lookAtFixes() {
      for (const pr of currentPrs.current) {
        let fixes
        try {
          fixes = (await fetchCommentFixes(client, pr.id, REVIEW_BEAT_MS - 5_000)).fixes
        } catch {
          continue
        }
        if (cancelled) return
        for (const fix of fixesToAnnounce(fixes, announcedFixes.current, sessionStart.current)) {
          void notify(fixTitle(fix.state), fixBody(pr.title, fix.state))
          announcedFixes.current.add(fix.id)
        }
      }
    }

    // An interval rather than a dependency, because a review finishing changes nothing
    // this component renders: the pull request list is identical, so an effect keyed on it
    // would never look again. `announceFinishedReviews` runs on its own loop for the same
    // reason.
    const timer = setInterval(() => {
      void look()
      void lookAtFixes()
    }, REVIEW_BEAT_MS)
    void look()
    void lookAtFixes()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client])

  /** The Tasks tab's checkbox routes exactly as Today's does: complete, or unpin. */
  function toggleProjectTask(row: TaskRowModel) {
    const id = Number(row.id.split('-')[1])
    if (row.source === 'pinnedTodo') {
      setTodoPinned.mutate({ id, pinned: false }, { onError })
      return
    }
    const todo = projectTodos.find((candidate) => candidate.id === id)
    if (todo) setTodoDone.mutate({ id, done: !todo.done }, { onError })
  }

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
        /*
         * The panel wins when it is open, because it is the thing that just changed. Every
         * section otherwise gets its own check: Today's used to be the fallback for all of
         * them, so opening Jira reported nine of Today's elements as missing.
         */
        setFidelity(
          isChatOpen
            ? runAgentPanelFidelityCheck()
            : section === 'Pull requests'
              ? isDetailOpen
                ? runPrDetailFidelityCheck()
                : runPrFidelityCheck()
              : section === 'Projects'
                ? runProjectsFidelityCheck()
                : section === 'Jira'
                  ? runJiraFidelityCheck()
                  : runFidelityCheck(),
        )
      })
    })
    return () => {
      cancelled = true
    }
    // `isProjectOpen`, not `openProjectId`: opening a project fires no query, so nothing
    // else in this list changes and the check would keep reporting the list screen.
  }, [
    data.isLoading,
    data.today,
    data.prs,
    section,
    isDetailOpen,
    isProjectOpen,
    isChatOpen,
    inFlight,
  ])

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
        onSelect={navigate}
        onOpenPalette={() => setIsPaletteOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        accountName={account}
        /* `openProject` opens the project's page rather than only selecting the row. */
        selectedProjectId={openProjectId}
        onSelectProject={(project) => {
          setSection('Projects')
          setOpenPrId(null)
          setOpenProjectId(project.id)
        }}
        todos={data.today?.todos ?? []}
        jiraTodos={everyTodo}
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
          isRefreshing={refresh.isPending}
          onRefresh={() => {
            if (refresh.isPending) return
            refresh.mutate(undefined, {
              /*
               * A poll that reported source errors is still a success, and
               * `RefreshViewModel` says why: the sources that did work have new data, and
               * the errors are surfaced separately rather than discarding the rest. So the
               * lists reload either way, through the mutation's own invalidation, and this
               * only says what went wrong.
               *
               * The engine logs these to its own console and nowhere else, so this alert is
               * the app's single window onto something like a stale Jira token.
               */
              onSuccess: (summary) => {
                if (summary.sourceErrors.length > 0) setAlert(summary.sourceErrors.join('\n'))
              },
              onError,
            })
          }}
          onAddProject={() => setSheet({ kind: 'create' })}
          /*
           * The header's Agent button is project-scoped, unlike the one on a pull
           * request's own page. `openProjectChat` in ContentView falls back to the first
           * project when none is selected, so a fresh window still has something to ask
           * about.
           */
          onOpenAgent={openProjectChat}
        />

        {/*
          An engine that does not answer says so, rather than rendering empty lists. Sits
          between the header and the content, so it is visible on every screen.
        */}
        {data.error && (
          <EngineDownBanner
            isAgentInstalled={agent.isInstalled}
            errorMessage={String(data.error)}
            isBusy={isStartingAgent}
            onStart={startAgent}
            onOpenSettings={() => setIsSettingsOpen(true)}
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
              />
            ) : (
              <PRsScreen
                prs={data.prs}
                projects={data.projects}
                onSelectPr={(pr) => setOpenPrId(pr.id)}
                onOpenAgent={(pr) => setChatTarget({ kind: 'pullRequest', pr })}
              />
            )
          ) : section === 'Today' ? (
            <TodayScreen
              today={data.today}
              prs={data.prs}
              projects={data.projects}
              tickets={data.tickets}
              onOpenAgent={setChatTarget}
            />
          ) : section === 'Projects' ? (
            openProject !== undefined ? (
              <ProjectDetailScreen
                // Keyed on the id for the same reason the pull request page is: the notes
                // saver, the open tab and the quick-add draft all belong to one project.
                key={openProject.id}
                project={openProject}
                projects={data.projects}
                todos={projectTodos}
                tickets={data.tickets}
                prs={data.prs}
                onBack={() => setOpenProjectId(null)}
                onEdit={() => setSheet({ kind: 'edit', project: openProject })}
                onAddTask={(text) =>
                  createTodo.mutate({ text, projectId: openProject.id }, { onError })
                }
                onToggleTask={(row) => toggleProjectTask(row)}
                onDeleteTodo={(todo) => deleteTodo.mutate({ id: todo.id }, { onError })}
                onChatTodo={(todo) => setChatTarget(chatTargetForTodo(todo, data.tickets))}
                onChatWork={(item) => {
                  // `chatTarget(for:)` in ContentView: an open work row is a pull request
                  // or a ticket, and the panel takes whichever it is.
                  if (item.kind === 'pullRequest') {
                    const pr = data.prs.find((candidate) => candidate.id === item.targetId)
                    if (pr) setChatTarget({ kind: 'pullRequest', pr })
                  } else {
                    const ticket = data.tickets.find((candidate) => candidate.id === item.targetId)
                    if (ticket) setChatTarget({ kind: 'ticket', ticket })
                  }
                }}
                onOpenWork={(item) => {
                  // A pull request opens its own page; an issue has no page of its own, so
                  // the Swift's ticket case navigates to the Jira screen.
                  if (item.kind === 'pullRequest') {
                    setSection('Pull requests')
                    setOpenPrId(item.targetId)
                  } else {
                    setSection('Jira')
                  }
                  setOpenProjectId(null)
                }}
              />
            ) : (
              <ProjectsScreen
                cards={projectCards({
                  projects: data.projects,
                  // ProjectsLogic.cards is fed `jiraViewModel.todos` in the Swift, so the
                  // full list. It matters for `activityText`, which reads every todo's
                  // createdAt: leaving the done ones out made a project's last activity
                  // read older than it was.
                  todos: everyTodo,
                  tickets: data.tickets,
                  prs: data.prs,
                  now: new Date(),
                })}
                onSelect={(card) => setOpenProjectId(card.id)}
              />
            )
          ) : (
            <JiraScreen
              todos={everyTodo}
              projects={data.projects}
              tickets={data.tickets}
              onChat={(todo) => setChatTarget(chatTargetForTodo(todo, data.tickets))}
            />
          )}
        </div>
      </main>

      {/*
        A sibling of `main`, so the panel takes width from the content rather than covering
        it. ContentView.swift attaches it as an `.overlay(alignment: .trailing)` on the
        content column, and on a 1440 window either reads the same; a narrow window is
        where they differ, and pushing beats hiding what the user is looking at.
      */}
      {chatTarget !== null && (
        <AgentChatPanel
          // Keyed on the target, so switching from one issue to another resets the draft
          // and the transcript instead of showing the previous thread under a new title.
          // That is what `loadToken` guards in the ViewModel.
          key={`${chatTarget.kind}-${
            chatTarget.kind === 'project'
              ? chatTarget.project.id
              : chatTarget.kind === 'ticket'
                ? chatTarget.ticket.id
                : chatTarget.kind === 'pullRequest'
                  ? chatTarget.pr.id
                  : chatTarget.todo.id
          }`}
          target={chatTarget}
          project={chatProject}
          linkedTicket={chatLinkedTicket}
          onClose={() => setChatTarget(null)}
          onBackToProject={(project) => {
            setChatTarget(null)
            setSection('Projects')
            setOpenPrId(null)
            setOpenProjectId(project.id)
          }}
        />
      )}

      {sheet !== null && (
        <ProjectFormSheet
          mode={sheet}
          errorMessage={null}
          onCancel={() => setSheet(null)}
          onSave={(input) => {
            const done = { onSuccess: () => setSheet(null), onError }
            if (sheet.kind === 'create') createProject.mutate(input, done)
            else updateProject.mutate({ id: sheet.project.id, input }, done)
          }}
          /* Only an existing project can be removed, so create offers nothing. */
          onDelete={
            sheet.kind === 'edit'
              ? () => {
                  const id = sheet.project.id
                  deleteProject.mutate(
                    { id },
                    {
                      onSuccess: () => {
                        setSheet(null)
                        // The page it was opened from is gone with it.
                        setOpenProjectId((current) => (current === id ? null : current))
                      },
                      onError,
                    },
                  )
                }
              : null
          }
        />
      )}

      {isSettingsOpen && (
        <SettingsSheet
          isEngineDown={data.error !== null}
          agent={agent}
          onAgentChange={setAgent}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {isPaletteOpen && (
        <CommandPalette
          projects={data.projects}
          onRun={runPaletteAction}
          onClose={() => setIsPaletteOpen(false)}
        />
      )}

      {alert !== null && <ErrorAlert message={alert} onDismiss={() => setAlert(null)} />}

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
