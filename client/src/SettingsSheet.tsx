/*
 * Port of app/Workbench/Views/SettingsSheet.swift.
 *
 * Two sections that share nothing: the engine's launchd agent, which goes through Rust, and
 * the Jira connection, which goes through the engine. The Jira half is a small state
 * machine and the order of its branches is load-bearing, so it is copied rather than
 * rearranged: connected, then a site still to choose, then waiting on the browser, then
 * credentials saved, then the form.
 */

import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import {
  UNKNOWN_AGENT,
  agentInstall,
  agentRemove,
  agentState,
  canManageAgent,
  chooseEngineDirectory,
  type AgentState,
} from './engineAgent'
import {
  useAuthorizeJira,
  useChooseJiraSite,
  useDisconnectJira,
  useJiraConnection,
  useSaveJiraClient,
  type JiraConnection,
  type JiraSite,
} from './queries'

/** Two seconds, matching `pollUntilConnected`, and 90 attempts before giving up. */
const POLL_MS = 2_000
const POLL_ATTEMPTS = 90

function SectionTitle({ text }: { text: string }) {
  return (
    <span
      style={{
        fontSize: 'var(--wb-fs-label)',
        letterSpacing: 0.8,
        color: 'var(--wb-n600)',
      }}
    >
      {text}
    </span>
  )
}

function Button({
  label,
  onClick,
  disabled,
  tone = 'normal',
  id,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'normal' | 'accent' | 'negative'
  id?: string
}) {
  const color =
    tone === 'accent'
      ? 'var(--wb-accent)'
      : tone === 'negative'
        ? 'var(--wb-negative)'
        : 'var(--wb-n300)'
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: 'var(--wb-s2) var(--wb-s3)',
        fontFamily: 'inherit',
        fontSize: 'var(--wb-fs-secondary)',
        color: disabled ? 'var(--wb-n700)' : color,
        background: 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: `1px solid ${disabled ? 'var(--wb-n900)' : 'var(--wb-n800)'}`,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function Field({
  title,
  value,
  onChange,
  secret,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  secret?: boolean
}) {
  return (
    <input
      data-settings-field={title}
      type={secret ? 'password' : 'text'}
      value={value}
      placeholder={title}
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
  )
}

function Mono({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: 'var(--wb-fs-table-meta)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: muted ? 'var(--wb-n600)' : 'var(--wb-text)',
        overflow: 'hidden',
        // `.truncationMode(.head)`: the tail of a path is the part that identifies it.
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        direction: 'rtl',
        textAlign: 'left',
      }}
    >
      {text}
    </span>
  )
}

/* ------------------------------------------------------------ engine */

function EngineSection({
  isEngineDown,
  onError,
}: {
  isEngineDown: boolean
  onError: (message: string) => void
}) {
  const [agent, setAgent] = useState<AgentState>(UNKNOWN_AGENT)
  const [directory, setDirectory] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    if (!canManageAgent) return
    void agentState()
      .then(setAgent)
      .catch((error: unknown) => onError(String(error)))
    // Read once when the sheet opens, as `.task` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function run(action: () => Promise<AgentState>) {
    setIsBusy(true)
    void action()
      .then(setAgent)
      .catch((error: unknown) => onError(String(error)))
      .finally(() => setIsBusy(false))
  }

  return (
    <section
      id="settings-engine"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
        <SectionTitle text="ENGINE" />
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isEngineDown ? 'var(--wb-negative)' : 'var(--wb-status-approved)',
          }}
        />
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n500)' }}>
          {isEngineDown ? 'Not reachable' : 'Running'}
        </span>
      </div>

      {!canManageAgent ? (
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
          The login agent can only be managed from the app. A browser cannot reach launchd.
        </span>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s2)' }}>
            <Mono text={directory === '' ? 'No folder chosen' : directory} muted={directory === ''} />
            <Button
              id="settings-choose-folder"
              label="Choose…"
              onClick={() => {
                void chooseEngineDirectory(directory).then((chosen) => {
                  if (chosen !== null) setDirectory(chosen)
                })
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
            {agent.isInstalled ? (
              <>
                <Button
                  id="settings-remove-agent"
                  label="Remove from login"
                  disabled={isBusy}
                  onClick={() => run(agentRemove)}
                />
                <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
                  Starts at login and restarts if it stops.
                </span>
              </>
            ) : (
              <>
                <Button
                  id="settings-install-agent"
                  label="Start at login"
                  tone="accent"
                  // The engine's own refusals still run; this only keeps the obvious case
                  // from making a round trip to be told to choose a folder.
                  disabled={isBusy || directory === ''}
                  onClick={() => run(() => agentInstall(directory))}
                />
                <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
                  Keeps the engine running so you never start it by hand.
                </span>
              </>
            )}
          </div>

          {/*
            Shown always, not only on failure: when a managed engine will not start, this
            file is the only place that says why.
          */}
          <span
            style={{
              fontSize: 'var(--wb-fs-label)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: 'var(--wb-n700)',
            }}
          >
            Log: {agent.logPath === '' ? 'not known yet' : agent.logPath}
          </span>
        </>
      )}
    </section>
  )
}

/* -------------------------------------------------------------- Jira */

function JiraSection({ onError }: { onError: (message: string) => void }) {
  const [isWaiting, setIsWaiting] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const connection = useJiraConnection(isWaiting ? POLL_MS : false)
  const saveClient = useSaveJiraClient()
  const authorize = useAuthorizeJira()
  const chooseSite = useChooseJiraSite()
  const disconnect = useDisconnectJira()

  const isBusy =
    saveClient.isPending || authorize.isPending || chooseSite.isPending || disconnect.isPending

  /*
   * Both ends of the browser trip stop the wait, which is what `pollUntilConnected` does:
   * connected, or a site still to choose. Either means Atlassian called back.
   */
  const data = connection.data
  useEffect(() => {
    if (!isWaiting || data === undefined) return
    if (data.connected || data.availableSites.length > 0) setIsWaiting(false)
  }, [isWaiting, data])

  /*
   * And a ceiling on the wait, so a browser tab that was closed without authorising does
   * not leave the sheet polling for the rest of the session. 90 attempts at 2 seconds is
   * three minutes, the same as the Swift.
   */
  useEffect(() => {
    if (!isWaiting) return
    const timer = setTimeout(() => {
      setIsWaiting(false)
      onError('No response from Atlassian yet. Try Connect again.')
    }, POLL_MS * POLL_ATTEMPTS)
    return () => clearTimeout(timer)
  }, [isWaiting, onError])

  function connect() {
    authorize.mutate(undefined, {
      onSuccess: (result) => {
        setIsWaiting(true)
        // A real browser, not the webview: the Atlassian consent screen is not something
        // to render inside the app, and the callback goes to the engine either way.
        window.open(result.url, '_blank', 'noopener')
      },
      onError: (error) => {
        setIsWaiting(false)
        onError(String(error))
      },
    })
  }

  const onMutationError = { onError: (error: Error) => onError(String(error)) }

  function body(current: JiraConnection) {
    if (current.connected) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
          <span style={{ fontSize: 'var(--wb-fs-body)', color: 'var(--wb-text)' }}>
            Connected to {current.siteName ?? 'Jira'}
          </span>
          {current.siteUrl !== null && (
            <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
              {current.siteUrl}
            </span>
          )}
          <span style={{ alignSelf: 'flex-start' }}>
            <Button
              id="settings-jira-disconnect"
              label="Disconnect"
              tone="negative"
              disabled={isBusy}
              onClick={() => disconnect.mutate(undefined, onMutationError)}
            />
          </span>
        </div>
      )
    }

    if (current.availableSites.length > 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s2)' }}>
          <span style={{ fontSize: 'var(--wb-fs-body)', color: 'var(--wb-text)' }}>
            Choose which Jira site to use
          </span>
          {current.availableSites.map((site: JiraSite) => (
            <span key={site.id} style={{ alignSelf: 'flex-start' }}>
              <Button
                label={site.name}
                disabled={isBusy}
                onClick={() => chooseSite.mutate({ cloudId: site.id }, onMutationError)}
              />
            </span>
          ))}
        </div>
      )
    }

    if (isWaiting) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          <span style={{ fontSize: 'var(--wb-fs-body)', color: 'var(--wb-text)' }}>
            Waiting for Atlassian…
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <Button label="Cancel" onClick={() => setIsWaiting(false)} />
          </span>
        </div>
      )
    }

    if (current.hasClientCredentials) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
          <span style={{ fontSize: 'var(--wb-fs-body)', color: 'var(--wb-text)' }}>
            Client credentials saved.
          </span>
          <span style={{ alignSelf: 'flex-start' }}>
            <Button
              id="settings-jira-connect"
              label="Connect Jira"
              tone="accent"
              disabled={isBusy}
              onClick={connect}
            />
          </span>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s3)' }}>
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n500)' }}>
          Create an OAuth 2.0 (3LO) app at developer.atlassian.com, give it the Jira platform
          scopes, and set its callback URL to exactly:
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s2)' }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 'var(--wb-fs-table-meta)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: 'var(--wb-text)',
              overflowWrap: 'anywhere',
            }}
          >
            {current.callbackUrl}
          </span>
          <Button
            label="Copy"
            onClick={() => {
              // `navigator.clipboard` rather than NSPasteboard, which task 8.3 covers for
              // the rest of the app. It needs no permission for a write.
              void navigator.clipboard
                .writeText(current.callbackUrl)
                .catch((error: unknown) => onError(String(error)))
            }}
          />
        </div>
        <Field title="Client ID" value={clientId} onChange={setClientId} />
        <Field title="Client secret" value={clientSecret} onChange={setClientSecret} secret />
        <span style={{ alignSelf: 'flex-start' }}>
          <Button
            id="settings-jira-save"
            label="Save"
            tone="accent"
            // Both, and the engine says so too: it answers 400 on either missing.
            disabled={isBusy || clientId.trim() === '' || clientSecret.trim() === ''}
            onClick={() =>
              saveClient.mutate({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }, onMutationError)
            }
          />
        </span>
      </div>
    )
  }

  return (
    <section
      id="settings-jira"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-s4)' }}
    >
      <SectionTitle text="JIRA" />
      {connection.data === undefined ? (
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-n600)' }}>
          {connection.error ? String(connection.error) : 'Loading…'}
        </span>
      ) : (
        body(connection.data)
      )}
    </section>
  )
}

/* ------------------------------------------------------------- sheet */

export function SettingsSheet({
  isEngineDown,
  onClose,
}: {
  isEngineDown: boolean
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  return (
    <div
      id="settings-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--wb-palette-backdrop)',
      }}
    >
      <div
        id="settings-sheet"
        role="dialog"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 460,
          maxHeight: '86vh',
          overflowY: 'auto',
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
            fontSize: 'var(--wb-fs-card-title)',
            fontWeight: 'var(--wb-weight-heading)',
            color: 'var(--wb-text)',
          }}
        >
          Settings
        </span>

        <EngineSection isEngineDown={isEngineDown} onError={setError} />

        <span style={{ height: 1, background: 'var(--wb-n900)' }} />

        <JiraSection onError={setError} />

        {error !== null && (
          <span
            id="settings-error"
            style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-negative)' }}
          >
            {error}
          </span>
        )}

        <div style={{ display: 'flex' }}>
          <span style={{ marginLeft: 'auto' }}>
            <Button id="settings-close" label="Close" onClick={onClose} />
          </span>
        </div>
      </div>
    </div>
  )
}

/** The gear in the sidebar footer. Here because it is the only thing that opens the sheet. */
export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      id="sidebar-settings"
      aria-label="Settings"
      title="Settings"
      onClick={onClick}
      style={{
        display: 'flex',
        padding: 0,
        color: 'var(--wb-n600)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <Icon name="gearshape" size={14} />
    </button>
  )
}
