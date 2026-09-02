/*
 * Port of app/Workbench/Views/EngineDownBanner.swift, comment and all, because the
 * comment is the reason the component exists.
 *
 * Shown across the top of every screen while the engine does not answer. It exists
 * because an engine that is down renders as a screen with nothing in it, which is
 * indistinguishable from having no work to do.
 */

import { Icon } from './Icon'

export function EngineDownBanner({
  isAgentInstalled,
  errorMessage,
  isBusy,
  onStart,
  onOpenSettings,
}: {
  isAgentInstalled: boolean
  /**
   * Rendered here, not only in Settings. Without it, a Start that fails looks exactly
   * like a button that does nothing.
   */
  errorMessage: string | null
  isBusy: boolean
  onStart: () => void
  onOpenSettings: () => void
}) {
  return (
    <div
      id="engine-down-banner"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s2)',
        padding: 'var(--wb-s3) var(--wb-s8)',
        background: 'var(--wb-surface)',
        borderBottom: '1px solid var(--wb-n900)',
        flex: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
        <Icon name="exclamationmark-triangle" size={13} color="var(--wb-negative)" />
        <span style={{ fontSize: 'var(--wb-fs-table-meta)', color: 'var(--wb-text)' }}>
          The engine is not running, so nothing on these screens is up to date.
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--wb-s3)' }}>
          {isBusy && (
            <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n500)' }}>Working…</span>
          )}
          {/*
            Only offer to start it when there is something to start. Otherwise the useful
            action is choosing the engine folder, which lives in Settings.
          */}
          {isAgentInstalled ? (
            <button
              id="engine-start"
              onClick={onStart}
              disabled={isBusy}
              style={buttonStyle(isBusy)}
            >
              Start it
            </button>
          ) : (
            <button id="engine-settings" onClick={onOpenSettings} style={buttonStyle(false)}>
              Set up in Settings
            </button>
          )}
        </span>
      </div>

      {errorMessage && (
        <span
          id="engine-error"
          style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-negative)' }}
        >
          {errorMessage}
        </span>
      )}
    </div>
  )
}

function buttonStyle(isBusy: boolean): React.CSSProperties {
  return {
    padding: 'var(--wb-s1) var(--wb-s3)',
    fontSize: 'var(--wb-fs-table-meta)',
    color: isBusy ? 'var(--wb-n600)' : 'var(--wb-accent)',
    background: 'transparent',
    border: `1px solid ${isBusy ? 'var(--wb-n800)' : 'var(--wb-accent)'}`,
    borderRadius: 'var(--wb-radius-sm)',
    font: 'inherit',
    cursor: isBusy ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
  }
}
