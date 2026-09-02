/*
 * The query layer, standing in for the app's ten ViewModels.
 *
 * Query keys mirror the engine's paths so an invalidation reads like the API it is
 * invalidating. Screens import hooks from here and never the transport, which is also
 * what lets them be tested without a running engine.
 *
 * Types come from the engine rather than being redeclared. That was the spike's clearest
 * single win: 247 lines of hand-written Swift Codable structs disappear, and with them a
 * whole class of drift. There is already a live example of the drift it prevents, since
 * the engine's `Pr` has had a `title` field for a while and `TodayLogic.linkedTitle` in
 * the Swift app still says "a PR carries no title of its own".
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { engine } from './engineClient'
import type { Pr, Project, Ticket, Todo, TodoPriority } from '../../engine/src/types.ts'
import type { TodayView } from '../../engine/src/todos.ts'
import type { PrDetailView } from './prDetailLogic'
import { isRunning, type PrReviewView } from './prReviewLogic'

export type { Pr, Project, Ticket, Todo, TodoPriority, TodayView }
export { EngineError } from './engineClient'

/*
 * The engine polls its sources every 15 minutes (POLL_INTERVAL_MS in
 * engine/src/config.ts), so a client polling faster than that mostly re-reads the same
 * SQLite rows. 30 seconds keeps the badge and the lists responsive to a manual refresh
 * without being silly about it.
 */
const POLL_MS = 30_000

export const keys = {
  today: ['/today'] as const,
  prs: ['/prs'] as const,
  pr: (id: number) => ['/prs', id] as const,
  prDetail: (id: number) => ['/prs', id, 'detail'] as const,
  prDiff: (id: number) => ['/prs', id, 'diff'] as const,
  prReview: (id: number) => ['/prs', id, 'review'] as const,
  prMessages: (id: number) => ['/prs', id, 'messages'] as const,
  projects: ['/projects'] as const,
  project: (id: number) => ['/projects', id] as const,
  projectMessages: (id: number) => ['/projects', id, 'messages'] as const,
  tickets: ['/tickets'] as const,
  ticket: (id: number) => ['/tickets', id] as const,
  todos: ['/todos'] as const,
  /** Distinct from `todos`: the Jira screen needs done ones too. See `useAllTodos`. */
  allTodos: ['/todos', 'any'] as const,
  todoMessages: (id: number) => ['/todos', id, 'messages'] as const,
  jiraSettings: ['/settings/jira'] as const,
}

/** A list query: polled, and its error surfaced rather than swallowed into an empty list. */
function list<T>(key: readonly unknown[], path: string, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => engine.get<T>(path),
    refetchInterval: POLL_MS,
    ...options,
  })
}

export const useToday = () => list<TodayView>(keys.today, '/today')
export const usePrs = () => list<Pr[]>(keys.prs, '/prs')
export const useProjects = () => list<Project[]>(keys.projects, '/projects')
export const useTickets = () => list<Ticket[]>(keys.tickets, '/tickets')

/**
 * All open todos, a different set from `today.todos`: `listTodayTodos` returns only manual
 * and pinned ones, while the sidebar's Jira count counts mirrored issues.
 */
export const useTodos = () => list<Todo[]>(keys.todos, '/todos')

/**
 * Everything the sidebar and the two list screens need, in one hook.
 *
 * `isLoading` is true only while nothing has arrived yet, so a poll in the background
 * never blanks a screen that already has data. `error` is the first failure across the
 * five, because five copies of "the engine is unreachable" is not five problems.
 */
export function useShellData() {
  const today = useToday()
  const prs = usePrs()
  const projects = useProjects()
  const tickets = useTickets()
  const todos = useTodos()

  const all = [today, prs, projects, tickets, todos]
  return {
    today: today.data,
    prs: prs.data ?? [],
    projects: projects.data ?? [],
    tickets: tickets.data ?? [],
    todos: todos.data ?? [],
    isLoading: all.some((query) => query.isLoading),
    error: all.find((query) => query.error)?.error ?? null,
  }
}

/* ------------------------------------------------------- One pull request */

/**
 * The GitHub-backed detail, standing in for `PrDetailViewModel.load`.
 *
 * Not polled. The route reaches GitHub behind a short-lived cache, and the Swift screen
 * loads it once in `.task`; a 30-second poll here would turn opening a page into a
 * standing cost against someone's API rate limit. It refetches when a mutation on this
 * pull request invalidates it, which is exactly when the Swift ViewModel reloads.
 */
export const usePrDetail = (id: number) =>
  useQuery<PrDetailView>({
    queryKey: keys.prDetail(id),
    queryFn: () => engine.get<PrDetailView>(`/prs/${id}/detail`),
  })

/**
 * The stored review, polled only while the engine says it is working.
 *
 * This is `PrReviewViewModel.followUntilFinished` expressed as a refetch interval: the
 * same 5 seconds, and it stops for the same reason, which is the engine no longer
 * reporting a running job. Doing it here rather than in a loop means two screens watching
 * one pull request share a single poll.
 *
 * `enabled` is what keeps the list screen from opening one of these per row. There it is
 * true only for a pull request the user actually started a review on, matching
 * `startedReviewIds` in PRsScreen.swift.
 */
export const usePrReview = (id: number, enabled = true) =>
  useQuery<PrReviewView>({
    queryKey: keys.prReview(id),
    queryFn: () => engine.get<PrReviewView>(`/prs/${id}/review`),
    enabled,
    refetchInterval: (query) => (isRunning(query.state.data) ? 5_000 : false),
  })

/**
 * The raw unified diff, for the agent panel's `DiffView`.
 *
 * `enabled` is not a nicety. The route opens and force-removes the pull request's worktree
 * under the PR job lock, so a fetch nobody asked for would contend with the fix pipeline
 * and with review itself, and answer 409 when it lost.
 *
 * A failure is not surfaced anywhere, matching `loadDiff`'s `try?`: a merged pull request
 * has no diff, and a 409 means another job holds the lock. Neither is worth interrupting a
 * conversation for.
 */
export const usePrDiff = (id: number, enabled: boolean) =>
  useQuery<{ diff: string }>({
    queryKey: keys.prDiff(id),
    queryFn: () => engine.get<{ diff: string }>(`/prs/${id}/diff`),
    enabled,
    // A worktree per refetch is too expensive to repeat on a window focus.
    staleTime: Infinity,
    retry: false,
  })

/* ------------------------------------------------------------ Agent chat */

export type ChatMessage = { id: number; role: 'user' | 'assistant'; content: string }

/**
 * One target's thread.
 *
 * The four shapes are not one hook with a switch, because they are four different paths
 * and two of them come wrapped in the target itself: `GET /tickets/:id` and `GET /prs/:id`
 * answer the record with its `messages` on it, which is also why `AgentChatViewModel`
 * refreshes its target from those two and not from the other two. A message can change a
 * ticket's status or a pull request's, and a chat cannot change a todo or a project.
 */
export const useProjectThread = (id: number, enabled: boolean) =>
  useQuery<ChatMessage[]>({
    queryKey: keys.projectMessages(id),
    queryFn: () => engine.get<ChatMessage[]>(`/projects/${id}/messages`),
    enabled,
  })

export const useTodoThread = (id: number, enabled: boolean) =>
  useQuery<ChatMessage[]>({
    queryKey: keys.todoMessages(id),
    queryFn: () => engine.get<ChatMessage[]>(`/todos/${id}/messages`),
    enabled,
  })

/** The ticket with its thread, so a status the agent changed comes back with it. */
export const useTicketThread = (id: number, enabled: boolean) =>
  useQuery<Ticket & { messages?: ChatMessage[] }>({
    queryKey: keys.ticket(id),
    queryFn: () => engine.get<Ticket & { messages?: ChatMessage[] }>(`/tickets/${id}`),
    enabled,
  })

export const usePrThread = (id: number, enabled: boolean) =>
  useQuery<Pr & { messages?: ChatMessage[] }>({
    queryKey: keys.pr(id),
    queryFn: () => engine.get<Pr & { messages?: ChatMessage[] }>(`/prs/${id}`),
    enabled,
  })

/*
 * Sending a message runs a headless Claude session, so these requests are held open for
 * minutes. There is no polling to do and nothing to time out against: the engine answers
 * when the agent has answered, which is what `AgentChatViewModel.send` awaits.
 */
export const useSendProjectMessage = (id: number) =>
  useEngineMutation(
    (args: { text: string }) => engine.post<unknown>(`/projects/${id}/messages`, args),
    [keys.projectMessages(id), keys.projects],
  )

export const useSendTicketMessage = (id: number) =>
  useEngineMutation(
    (args: { text: string }) => engine.post<unknown>(`/tickets/${id}/messages`, args),
    [keys.ticket(id), keys.tickets, keys.today],
  )

export const useSendTodoMessage = (id: number) =>
  useEngineMutation(
    (args: { text: string }) => engine.post<unknown>(`/todos/${id}/messages`, args),
    [keys.todoMessages(id), keys.todos, keys.allTodos, keys.today],
  )

export const useSendPrMessage = (id: number) =>
  useEngineMutation(
    (args: { text: string }) => engine.post<PrChatResult>(`/prs/${id}/messages`, args),
    [keys.pr(id), keys.prs, keys.today],
  )

/* ------------------------------------------------------------- Mutations */

/**
 * A mutation that refetches what it changed, which is the job the ViewModels do by hand.
 *
 * No optimistic updates: the Swift app awaits the call and then reloads, and adding
 * optimism here would be an improvement rather than a port, which would make a port bug
 * indistinguishable from a race the app never had.
 */
export function useEngineMutation<TArgs, TResult>(
  run: (args: TArgs) => Promise<TResult>,
  invalidates: readonly (readonly unknown[])[],
) {
  const client = useQueryClient()
  return useMutation<TResult, Error, TArgs>({
    mutationFn: run,
    onSuccess: () => {
      for (const key of invalidates) {
        void client.invalidateQueries({ queryKey: key })
      }
    },
  })
}

/*
 * Which keys each mutation invalidates is copied from what the matching ViewModel
 * reloads, not from what looks tidy. `TodayViewModel.togglePin` says it plainly:
 * unpinning a Jira todo removes it from Today's list entirely, so the whole list is
 * reloaded rather than the row patched in place.
 */
const TODO_KEYS = [keys.today, keys.todos, keys.allTodos] as const
/** A promote turns a todo into a ticket, so both lists move. */
const PROMOTE_KEYS = [keys.today, keys.todos, keys.allTodos, keys.tickets] as const

export const useCreateTodo = () =>
  useEngineMutation(
    (args: { text: string; projectId?: number }) =>
      engine.post<Todo>('/todos', {
        text: args.text,
        ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
      }),
    TODO_KEYS,
  )

export const useSetTodoDone = () =>
  useEngineMutation(
    (args: { id: number; done: boolean }) =>
      engine.patch<Todo>(`/todos/${args.id}`, { done: args.done }),
    TODO_KEYS,
  )

export const useSetTodoPriority = () =>
  useEngineMutation(
    (args: { id: number; priority: TodoPriority }) =>
      engine.patch<Todo>(`/todos/${args.id}`, { priority: args.priority }),
    TODO_KEYS,
  )

export const useSetTodoPinned = () =>
  useEngineMutation(
    (args: { id: number; pinned: boolean }) =>
      engine.patch<Todo>(`/todos/${args.id}/pin`, { pinned: args.pinned }),
    TODO_KEYS,
  )

export const useDeleteTodo = () =>
  useEngineMutation((args: { id: number }) => engine.delete<void>(`/todos/${args.id}`), TODO_KEYS)

export const usePromoteTodo = () =>
  useEngineMutation(
    (args: { id: number }) => engine.post<Ticket>(`/todos/${args.id}/promote`),
    PROMOTE_KEYS,
  )

/**
 * Every todo, done ones included.
 *
 * `JiraViewModel.load` asks for completed todos too, and says why: promoting sets done = 1,
 * and a promoted issue must keep its place in the list with its pipeline state. So this is
 * a different query from `useTodos`, not the same one with a flag.
 *
 * Not polled, which is the one place a list query here differs from the rest. This is the
 * largest payload the app has, 695 rows against 4 projects and 14 pull requests, and the
 * Swift loads it once from ContentView's `.task` and then only after a mutation or a
 * manual refresh. Re-reading it every 30 seconds would be the port inventing a cost the
 * app does not pay. The mutations that change it invalidate it by name.
 */
export const useAllTodos = () =>
  list<Todo[]>(keys.allTodos, '/todos?done=any', { refetchInterval: false })

/* ------------------------------------------------------------- Settings */

export type JiraSite = { id: string; url: string; name: string }

export type JiraConnection = {
  hasClientCredentials: boolean
  connected: boolean
  siteUrl: string | null
  siteName: string | null
  /** Non-empty only while a site still has to be chosen. */
  availableSites: JiraSite[]
  /** The exact value to paste into the Atlassian console. */
  callbackUrl: string
}

/**
 * The Jira connection.
 *
 * `refetchInterval` is a parameter because the connect flow polls: the user is sent to
 * Atlassian in a browser, and the only way back is asking the engine whether the callback
 * has landed. `SettingsViewModel.pollUntilConnected` does the same at 2 seconds, and stops
 * on either end of the trip, connected or a site to choose.
 */
export const useJiraConnection = (pollMs: number | false) =>
  useQuery<JiraConnection>({
    queryKey: keys.jiraSettings,
    queryFn: () => engine.get<JiraConnection>('/settings/jira'),
    refetchInterval: pollMs,
  })

const JIRA_KEYS = [keys.jiraSettings] as const

export const useSaveJiraClient = () =>
  useEngineMutation(
    (args: { clientId: string; clientSecret: string }) =>
      engine.put<{ ok: boolean }>('/settings/jira/client', args),
    JIRA_KEYS,
  )

/** Answers the URL to open. Opening a browser is the caller's job. */
export const useAuthorizeJira = () =>
  useEngineMutation(() => engine.post<{ url: string }>('/settings/jira/authorize'), JIRA_KEYS)

export const useChooseJiraSite = () =>
  useEngineMutation(
    (args: { cloudId: string }) => engine.post<{ ok: boolean }>('/settings/jira/site', args),
    // A site choice is what makes the mirrored issues appear, so the lists move with it.
    [keys.jiraSettings, keys.todos, keys.allTodos, keys.today] as const,
  )

export const useDisconnectJira = () =>
  useEngineMutation(() => engine.delete<{ ok: boolean }>('/settings/jira'), JIRA_KEYS)

/* ------------------------------------------------------------- Projects */

const PROJECT_KEYS = [keys.projects] as const

export type ProjectInput = {
  name: string
  repoPath: string
  defaultBranch: string
  githubRepo: string | null
  jiraProjectKey: string | null
  sentryProjectSlug: string | null
  status: Project['status']
  blurb: string
}

export const useCreateProject = () =>
  useEngineMutation(
    (input: ProjectInput) => engine.post<Project>('/projects', input),
    PROJECT_KEYS,
  )

export const useUpdateProject = () =>
  useEngineMutation(
    (args: { id: number; input: ProjectInput }) =>
      engine.patch<Project>(`/projects/${args.id}`, args.input),
    PROJECT_KEYS,
  )

export const useDeleteProject = () =>
  useEngineMutation(
    (args: { id: number }) => engine.delete<void>(`/projects/${args.id}`),
    // Deleting a project changes every count the sidebar and Today draw, so this
    // invalidates more than the list it removed a row from.
    [keys.projects, keys.today, keys.todos, keys.allTodos, keys.tickets, keys.prs] as const,
  )

/**
 * Notes, as a bare call rather than a hook.
 *
 * `ProjectNotesSaver` owns when a write happens, and it is not a component: the debounce,
 * the chaining and the id checks are its job precisely because a hook cannot express them.
 * So this hands it a function and lets it decide.
 */
export const updateProjectNotes = (id: number, notes: string) =>
  engine.put<Project>(`/projects/${id}/notes`, { notes })

/* ------------------------------------------------------------- Tickets */

/**
 * Creates the pull request for an analysed issue.
 *
 * Invalidates the pull request list as well as the tickets: the whole point is that a new
 * pull request now exists.
 */
export const useCreatePr = () =>
  useEngineMutation(
    (args: { ticketId: number }) => engine.post<unknown>(`/tickets/${args.ticketId}/create-pr`),
    [keys.tickets, keys.prs, keys.today] as const,
  )

export const useSetTicketPinned = () =>
  useEngineMutation(
    (args: { id: number; pinned: boolean }) =>
      engine.patch<Ticket>(`/tickets/${args.id}/pin`, { pinned: args.pinned }),
    // Today too: a pinned ticket is a row on it.
    [keys.tickets, keys.today] as const,
  )

export const useSetPrPinned = () =>
  useEngineMutation(
    (args: { id: number; pinned: boolean }) =>
      engine.patch<Pr>(`/prs/${args.id}/pin`, { pinned: args.pinned }),
    [keys.prs, keys.today] as const,
  )

/* ---------------------------------------------------- Pull request review */

/**
 * Starts a background review. Answers 202 and nothing useful, so the caller learns it
 * began from the review query starting to report a running job.
 */
export const useStartPrReview = (id: number) =>
  useEngineMutation(() => engine.post<{ started: boolean }>(`/prs/${id}/review`), [
    keys.prReview(id),
  ])

/**
 * Posts one finding to GitHub.
 *
 * The body travels with the request because the user may have edited it on screen, which
 * is the same reason the route accepts one.
 */
export const usePostPrFinding = (id: number) =>
  useEngineMutation(
    (args: { findingId: number; body: string }) =>
      engine.post<{ posted: boolean }>(`/prs/${id}/review/findings/${args.findingId}`, {
        body: args.body,
      }),
    [keys.prReview(id), keys.prDetail(id)],
  )

export const useDiscardPrFinding = (id: number) =>
  useEngineMutation(
    (args: { findingId: number }) =>
      engine.delete<void>(`/prs/${id}/review/findings/${args.findingId}`),
    [keys.prReview(id)],
  )

/* ------------------------------------------ Pull request detail mutations */

export const usePostReviewReply = (id: number) =>
  useEngineMutation(
    (args: { commentId: number; text: string }) =>
      engine.post<unknown>(`/prs/${id}/review-comments/${args.commentId}/reply`, {
        text: args.text,
      }),
    [keys.prDetail(id)],
  )

export type PrChatResult = { action: 'revised' | 'merged' | 'refused'; reply: string }

/**
 * Merges, last and behind an explicit click.
 *
 * The engine answers a refusal with 200 and an action, so a refusal has to be read off
 * the result rather than caught as an error. `PrDetailViewModel.merge` reloads only when
 * the merge was not refused, so the invalidation is conditional here too rather than
 * hung off `useEngineMutation`: a refused merge changed nothing on GitHub, and refetching
 * the detail would spend a request proving it.
 */
export function useMergePr(id: number) {
  const client = useQueryClient()
  return useMutation<PrChatResult, Error, void>({
    mutationFn: () => engine.post<PrChatResult>(`/prs/${id}/merge`),
    onSuccess: (result) => {
      /*
       * The thread refreshes whatever the answer was, because a refusal is itself a
       * message: `sendPrMessage` records the reply before returning it. That is why
       * `AgentChatViewModel.merge` reloads unconditionally while `PrDetailViewModel.merge`
       * reloads only on a merge that happened, and both are right for what they show.
       */
      void client.invalidateQueries({ queryKey: keys.pr(id) })
      if (result.action === 'refused') return
      for (const key of [keys.prDetail(id), keys.prs, keys.today]) {
        void client.invalidateQueries({ queryKey: key })
      }
    },
  })
}
