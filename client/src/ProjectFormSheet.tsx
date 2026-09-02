/*
 * Port of app/Workbench/Views/ProjectFormSheet.swift and ProjectDraft.swift.
 *
 * The Browse… button is the one thing that cannot be ported as written: it opens an
 * NSOpenPanel, and a webview has no such thing. The Tauri dialog plugin is task 7.5, so
 * until then the field is typed into, and the button is not drawn at all rather than drawn
 * dead. A control that looks available and does nothing is worse than one that is absent.
 */

import { useState } from 'react'
import type { Project } from './queries'
import type { ProjectInput } from './queries'

export type ProjectSheetMode = { kind: 'create' } | { kind: 'edit'; project: Project }

type Draft = {
  name: string
  repoPath: string
  defaultBranch: string
  githubRepo: string
  jiraProjectKey: string
  sentryProjectSlug: string
  status: Project['status']
  blurb: string
}

const STATUSES: Project['status'][] = ['active', 'paused', 'planning']

const STATUS_LABEL: Record<Project['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  planning: 'Planning',
}

function emptyDraft(): Draft {
  return {
    name: '',
    repoPath: '',
    defaultBranch: 'main',
    githubRepo: '',
    jiraProjectKey: '',
    sentryProjectSlug: '',
    status: 'active',
    blurb: '',
  }
}

function draftOf(project: Project): Draft {
  return {
    name: project.name,
    repoPath: project.repoPath,
    defaultBranch: project.defaultBranch,
    githubRepo: project.githubRepo ?? '',
    jiraProjectKey: project.jiraProjectKey ?? '',
    sentryProjectSlug: project.sentryProjectSlug ?? '',
    status: project.status,
    blurb: project.blurb,
  }
}

/** An empty optional field is sent as null, never as an empty string. */
export function draftAsInput(draft: Draft): ProjectInput {
  return {
    name: draft.name,
    repoPath: draft.repoPath,
    defaultBranch: draft.defaultBranch,
    githubRepo: draft.githubRepo === '' ? null : draft.githubRepo,
    jiraProjectKey: draft.jiraProjectKey === '' ? null : draft.jiraProjectKey,
    sentryProjectSlug: draft.sentryProjectSlug === '' ? null : draft.sentryProjectSlug,
    status: draft.status,
    blurb: draft.blurb,
  }
}

function Label({ text }: { text: string }) {
  return (
    <span
      style={{
        fontSize: 'var(--wb-fs-label)',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: 'var(--wb-n600)',
      }}
    >
      {text}
    </span>
  )
}

function Field({
  title,
  value,
  onChange,
}: {
  title: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)' }}>
      <Label text={title} />
      <input
        data-field={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          padding: 'var(--wb-s2) var(--wb-s3)',
          fontFamily: 'inherit',
          fontSize: 'var(--wb-fs-body)',
          color: 'var(--wb-text)',
          background: 'var(--wb-surface)',
          borderRadius: 'var(--wb-radius-md)',
          border: '1px solid var(--wb-n800)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </label>
  )
}

export function ProjectFormSheet({
  mode,
  errorMessage,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: ProjectSheetMode
  errorMessage: string | null
  onSave: (input: ProjectInput) => void
  onDelete: (() => void) | null
  onCancel: () => void
}) {
  const isCreating = mode.kind === 'create'
  const [draft, setDraft] = useState<Draft>(() =>
    mode.kind === 'create' ? emptyDraft() : draftOf(mode.project),
  )

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  // The three the engine requires. It answers 400 on any of them missing, so the button is
  // disabled rather than the refusal shown afterwards.
  const canSave =
    draft.name.trim() !== '' && draft.repoPath.trim() !== '' && draft.defaultBranch.trim() !== ''

  return (
    <div
      id="project-sheet-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 45,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--wb-palette-backdrop)',
      }}
    >
      <div
        id="project-sheet"
        role="dialog"
        aria-label={isCreating ? 'Add project' : 'Edit project'}
        style={{
          width: 460,
          height: 560,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s6)',
          padding: 'var(--wb-s8)',
          background: 'var(--wb-bg)',
          borderRadius: 'var(--wb-radius-lg)',
          border: '1px solid var(--wb-n800)',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            fontSize: 'var(--wb-fs-screen-title)',
            fontWeight: 'var(--wb-weight-heading)',
            letterSpacing: -0.33,
            color: 'var(--wb-text)',
          }}
        >
          {isCreating ? 'Add project' : 'Edit project'}
        </span>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--wb-s4)',
          }}
        >
          <Field title="Name" value={draft.name} onChange={set('name')} />
          <Field title="Local repo path" value={draft.repoPath} onChange={set('repoPath')} />
          <Field title="Default branch" value={draft.defaultBranch} onChange={set('defaultBranch')} />
          <Field title="Blurb" value={draft.blurb} onChange={set('blurb')} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)' }}>
            <Label text="Status" />
            {/* `.pickerStyle(.segmented)`: one control, the options side by side. */}
            <div
              data-status-picker=""
              style={{
                display: 'flex',
                padding: 2,
                background: 'var(--wb-surface)',
                borderRadius: 'var(--wb-radius-md)',
                border: '1px solid var(--wb-n800)',
                boxSizing: 'border-box',
              }}
            >
              {STATUSES.map((status) => (
                <button
                  key={status}
                  data-status={status}
                  onClick={() => setDraft((current) => ({ ...current, status }))}
                  style={{
                    flex: 1,
                    padding: 'var(--wb-s2)',
                    fontFamily: 'inherit',
                    fontSize: 'var(--wb-fs-secondary)',
                    color: status === draft.status ? 'var(--wb-a200)' : 'var(--wb-n500)',
                    background: status === draft.status ? 'var(--wb-a900)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--wb-radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </div>

          <Field title="GitHub repo" value={draft.githubRepo} onChange={set('githubRepo')} />
          <Field
            title="Jira project key"
            value={draft.jiraProjectKey}
            onChange={set('jiraProjectKey')}
          />
          <Field
            title="Sentry project slug"
            value={draft.sentryProjectSlug}
            onChange={set('sentryProjectSlug')}
          />
        </div>

        {errorMessage !== null && (
          <span
            id="project-sheet-error"
            style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-negative)' }}
          >
            {errorMessage}
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          <button
            id="project-sheet-save"
            disabled={!canSave}
            onClick={() => onSave(draftAsInput(draft))}
            style={{
              padding: 'var(--wb-s2) var(--wb-s4)',
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-secondary)',
              color: canSave ? 'var(--wb-a100)' : 'var(--wb-n500)',
              background: canSave ? 'var(--wb-accent)' : 'var(--wb-n900)',
              border: 'none',
              borderRadius: 'var(--wb-radius-md)',
              cursor: canSave ? 'pointer' : 'default',
            }}
          >
            {isCreating ? 'Create' : 'Save'}
          </button>
          <button
            id="project-sheet-cancel"
            onClick={onCancel}
            style={{
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 'var(--wb-fs-secondary)',
              color: 'var(--wb-n400)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          {onDelete !== null && (
            <button
              id="project-sheet-delete"
              onClick={onDelete}
              style={{
                marginLeft: 'auto',
                padding: 0,
                fontFamily: 'inherit',
                fontSize: 'var(--wb-fs-secondary)',
                color: 'var(--wb-negative)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Remove project
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
