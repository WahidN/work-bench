import { describe, expect, it, vi } from 'vitest'
import { ProjectNotesSaver, type NotesApi } from './projectNotesSaver'
import type { Project } from './queries'

/*
 * Mirrors WorkbenchTests/ViewModels/ProjectDetailViewModelTests.swift.
 *
 * Every case here is about two states that look identical from outside: a draft equal to
 * the saved value because nothing was typed, versus one equal because a write just landed.
 * Confusing them either loses the user's text or resurrects text they replaced.
 */

function project(id: number, notes: string): Project {
  return {
    id,
    name: `Project ${id}`,
    repoPath: '/tmp/repo',
    defaultBranch: 'main',
    githubRepo: null,
    jiraProjectKey: null,
    sentryProjectSlug: null,
    status: 'active',
    blurb: '',
    notes,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Project
}

/** Records every write, and lets a test hold one open to create the overlap it needs. */
function fakeApi() {
  const calls: { id: number; notes: string }[] = []
  let gate: (() => void) | null = null
  const api: NotesApi = {
    updateProjectNotes: async (id, notes) => {
      calls.push({ id, notes })
      if (gate !== null) {
        // Holds this write open until the test releases it.
        await new Promise<void>((resolve) => {
          const previous = gate
          gate = () => {
            previous?.()
            resolve()
          }
        })
      }
      return project(id, notes)
    },
  }
  return {
    api,
    calls,
    hold: () => {
      gate = () => {}
    },
    release: () => {
      const current = gate
      gate = null
      current?.()
    },
  }
}

const noop = () => {}

describe('start', () => {
  it('copies the project notes into the draft', () => {
    const { api } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop)
    saver.start(project(1, 'hello'))
    expect(saver.draft).toBe('hello')
  })

  it('adopts a later value for the same project when nothing is unsaved', () => {
    // A fresh instance can start from an array the parent has not refreshed yet, and the
    // refresh arrives as a same-id call. With nothing typed, the newer text wins.
    const { api } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop)
    saver.start(project(1, 'stale'))
    saver.start(project(1, 'fresher'))
    expect(saver.draft).toBe('fresher')
  })

  it('never overwrites an unsaved draft with an incoming value', () => {
    const { api } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop)
    saver.start(project(1, 'stale'))
    saver.edited('typing')
    saver.start(project(1, 'fresher'))
    expect(saver.draft).toBe('typing')
  })

  it('does not let a stale project overwrite what this instance just saved', async () => {
    /*
     * The case `hasSavedSinceStart` exists for. After a successful write the draft equals
     * the saved value again, exactly as it does for an untouched instance. Adopting the
     * older `project.notes` that a slow refresh then delivers would put back the text the
     * user had just replaced.
     */
    const { api, calls } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop, 0)
    saver.start(project(1, 'old'))
    saver.edited('new')
    await saver.flush()
    expect(calls).toEqual([{ id: 1, notes: 'new' }])

    saver.start(project(1, 'old'))
    expect(saver.draft).toBe('new')
  })
})

describe('flush', () => {
  it('writes nothing when the draft matches what was saved', async () => {
    const { api, calls } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop, 0)
    saver.start(project(1, 'unchanged'))
    await saver.flush()
    expect(calls).toEqual([])
  })

  it('sends one write, not two, when two callers flush at once', async () => {
    /*
     * A tab switch and an unmount can both flush. Chaining rather than racing is what
     * makes the second caller find a clean draft and write nothing.
     */
    const { api, calls } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop, 0)
    saver.start(project(1, 'old'))
    saver.edited('new')
    await Promise.all([saver.flush(), saver.flush()])
    expect(calls).toEqual([{ id: 1, notes: 'new' }])
  })

  it('reports a failed write on saveError', async () => {
    const saver = new ProjectNotesSaver(
      { updateProjectNotes: async () => Promise.reject(new Error('engine unreachable')) },
      noop,
      0,
    )
    saver.start(project(1, 'old'))
    saver.edited('new')
    await saver.flush()
    expect(saver.saveError).toContain('engine unreachable')
  })
})

describe('switching project', () => {
  it('sends the departing draft rather than dropping it', async () => {
    const { api, calls } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop, 0)
    saver.start(project(1, 'one'))
    saver.edited('one edited')
    saver.start(project(2, 'two'))

    // The departing write is chained, not awaited by `start`, so let it land.
    await saver.flush()
    expect(calls).toContainEqual({ id: 1, notes: 'one edited' })
    expect(saver.draft).toBe('two')
  })

  it('does not let a departing write stamp the project now on screen', async () => {
    /*
     * The write's own id check. Without it the old project's confirmation would set
     * `savedValue` and `hasSavedSinceStart` for the project now on screen, which is wrong
     * in both directions: the new project's own notes would look unsaved and be written
     * back for no reason, and a later refresh of it would no longer be adopted.
     *
     * Both of those are asserted, because the obvious assertion, that the two writes are
     * for the right ids, passes with the check removed as well.
     */
    const { api, calls, hold, release } = fakeApi()
    const saver = new ProjectNotesSaver(api, noop, 0)
    saver.start(project(1, 'one'))
    saver.edited('one edited')

    hold()
    saver.start(project(2, 'two'))
    release()
    await saver.flush()

    // Project 2 has nothing unsaved, so only the departing write went out.
    expect(calls).toEqual([{ id: 1, notes: 'one edited' }])

    // And this instance has confirmed nothing for project 2, so a fresher copy is adopted.
    saver.start(project(2, 'fresher'))
    expect(saver.draft).toBe('fresher')
  })

  it('leaves saveError alone when a write for an old project fails', async () => {
    let attempt = 0
    const saver = new ProjectNotesSaver(
      {
        updateProjectNotes: async (id, notes) => {
          attempt += 1
          if (attempt === 1) throw new Error('the old project blew up')
          return project(id, notes)
        },
      },
      noop,
      0,
    )
    saver.start(project(1, 'one'))
    saver.edited('one edited')
    saver.start(project(2, 'two'))
    await saver.flush()

    // The failure belongs to a project that is no longer on screen, so the screen says
    // nothing about it.
    expect(saver.saveError).toBeNull()
  })
})

describe('debounce', () => {
  it('writes once after the pause, not once per keystroke', async () => {
    vi.useFakeTimers()
    try {
      const { api, calls } = fakeApi()
      const saver = new ProjectNotesSaver(api, noop, 1500)
      saver.start(project(1, ''))

      saver.edited('a')
      await vi.advanceTimersByTimeAsync(1400)
      saver.edited('ab')
      await vi.advanceTimersByTimeAsync(1400)
      // Still nothing: every keystroke replaced the pending timer.
      expect(calls).toEqual([])

      saver.edited('abc')
      await vi.advanceTimersByTimeAsync(1500)
      expect(calls).toEqual([{ id: 1, notes: 'abc' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire a timer that a flush already satisfied', async () => {
    vi.useFakeTimers()
    try {
      const { api, calls } = fakeApi()
      const saver = new ProjectNotesSaver(api, noop, 1500)
      saver.start(project(1, ''))
      saver.edited('typed')
      await saver.flush()
      await vi.advanceTimersByTimeAsync(3000)
      expect(calls).toEqual([{ id: 1, notes: 'typed' }])
    } finally {
      vi.useRealTimers()
    }
  })
})
