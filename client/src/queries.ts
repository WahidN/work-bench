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
import type { Pr, Project, Ticket, Todo } from '../../engine/src/types.ts'
import type { TodayView } from '../../engine/src/todos.ts'

export type { Pr, Project, Ticket, Todo, TodayView }
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
