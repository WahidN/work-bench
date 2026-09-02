/*
 * Port of app/Workbench/ViewModels/ProjectDetailViewModel.swift.
 *
 * Deliberately not a hook. The rules here are a small state machine about writes racing
 * each other, and the Swift's own comments are mostly about the two states that look
 * identical from outside. Keeping it framework-free is what lets those rules be tested
 * with a fake clock instead of by typing into a box and hoping.
 *
 * A Swift `Task` is cancellable and a Promise is not, so cancellation is a flag the
 * cancelled work checks after it wakes. Everything else is a direct translation:
 * `pendingTimer` is the debounce, `inFlightWrite` is the chain, and a write only ever
 * stamps state that still belongs to the project it was aimed at.
 */

import type { Project } from './queries'

export const NOTES_DEBOUNCE_MS = 1500

export type NotesApi = {
  updateProjectNotes: (id: number, notes: string) => Promise<Project>
}

type Timer = { cancelled: boolean; handle: ReturnType<typeof setTimeout> }

export class ProjectNotesSaver {
  draft = ''
  saveError: string | null = null

  private projectId: number | null = null
  private savedValue = ''

  /**
   * True once THIS instance has itself confirmed a write for the current project.
   *
   * It tells apart two same-id, draft-equals-savedValue states that look identical
   * otherwise: a fresh instance that has only ever copied `project.notes` verbatim, which
   * should adopt a later value, and an instance whose `savedValue` was just set by its own
   * successful write, where the server already has that exact text and an older, stale
   * `project.notes` must not overwrite it.
   */
  private hasSavedSinceStart = false

  private pendingTimer: Timer | null = null

  /**
   * The most recent save attempt, chained behind whatever came before it. It may complete
   * without writing at all, because the dirty check runs only after its predecessor has
   * landed, but it is always awaited and never cancelled, so a write that does reach the
   * server is never abandoned by a later keystroke or tab switch.
   */
  private inFlightWrite: Promise<void> = Promise.resolve()

  constructor(
    private readonly api: NotesApi,
    private readonly onChange: () => void,
    private readonly debounceMs: number = NOTES_DEBOUNCE_MS,
  ) {}

  /**
   * Called when the screen appears and whenever the open project's notes change.
   *
   * Notes are written by exactly one place, this class, so once a project is loaded there
   * is no external change to pick up, except for a save that landed after this instance
   * already read a stale copy. A reload of the same project adopts the incoming notes only
   * when there is nothing unsaved AND this instance has not itself already confirmed a
   * write. A different project id is a real switch.
   */
  start(project: Project): void {
    if (this.projectId === project.id) {
      if (
        this.draft === this.savedValue &&
        project.notes !== this.savedValue &&
        !this.hasSavedSinceStart
      ) {
        this.savedValue = project.notes
        this.draft = project.notes
        this.onChange()
      }
      return
    }

    this.cancelTimer()

    /*
     * Switching project must not drop an unsaved draft, so the old project's text goes out
     * in its own write rather than being discarded. It is chained into `inFlightWrite`
     * rather than parked in the timer slot, so a keystroke on the new project cannot
     * cancel it, and so a write already heading to the server for that same project is not
     * raced by this one: two PUTs could land in either order and leave the server holding
     * older text than the model believes it saved.
     */
    if (this.projectId !== null && this.draft !== this.savedValue) {
      const previousId = this.projectId
      const text = this.draft
      const previous = this.inFlightWrite
      this.inFlightWrite = previous.then(() => this.write(previousId, text))
    }

    this.projectId = project.id
    this.savedValue = project.notes
    this.draft = project.notes
    this.saveError = null
    this.hasSavedSinceStart = false
    this.onChange()
  }

  edited(text: string): void {
    this.draft = text
    this.onChange()
    this.cancelTimer()
    const timer: Timer = {
      cancelled: false,
      handle: setTimeout(() => {
        if (timer.cancelled) return
        void this.save()
      }, this.debounceMs),
    }
    this.pendingTimer = timer
  }

  /**
   * Save now if there is anything unsaved. Called on tab switch, on project change and on
   * unmount, so closing the screen a keystroke after typing cannot lose the text. Only the
   * timer is cancelled here: `save` chains behind any write already in flight rather than
   * abandoning it, so this needs no wait of its own.
   */
  async flush(): Promise<void> {
    this.cancelTimer()
    await this.save()
  }

  /**
   * Chains the new attempt behind whatever is already in `inFlightWrite` instead of racing
   * it. Two overlapping callers, and a tab switch and an unmount can both flush, would
   * otherwise both pass the dirty check while the first write is still in flight and send
   * two PUTs for the same project. Assigning the slot before the first await means a
   * second caller always finds this one already there and chains behind it, which is why
   * the dirty check runs AFTER `previous` lands: only then does `savedValue` reflect what
   * the first write actually saved, so the second caller sees a clean draft and writes
   * nothing.
   */
  private async save(): Promise<void> {
    const previous = this.inFlightWrite
    const task = previous.then(async () => {
      if (this.projectId === null || this.draft === this.savedValue) return
      await this.write(this.projectId, this.draft)
    })
    this.inFlightWrite = task
    await task
  }

  /**
   * `projectId` is this write's OWN target, captured when it was created. It may no longer
   * equal `this.projectId` by the time it lands, either because `start` switched projects
   * or because a write that was current when it began went stale mid-flight. Either way,
   * only a write whose target still matches the project on screen may stamp `savedValue`
   * or `saveError`; one that does not must touch neither, since those fields by then
   * describe a different project.
   */
  private async write(projectId: number, notes: string): Promise<void> {
    try {
      const project = await this.api.updateProjectNotes(projectId, notes)
      if (projectId === this.projectId) {
        this.savedValue = project.notes
        this.saveError = null
        this.hasSavedSinceStart = true
        this.onChange()
      }
    } catch (error) {
      if (projectId === this.projectId) {
        this.saveError = String(error)
        this.onChange()
      }
    }
  }

  private cancelTimer(): void {
    if (this.pendingTimer === null) return
    this.pendingTimer.cancelled = true
    clearTimeout(this.pendingTimer.handle)
    this.pendingTimer = null
  }
}
