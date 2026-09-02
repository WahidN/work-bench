/*
 * Stands in for the `.alert("Error", isPresented:)` every screen in the app attaches to
 * its ViewModel's `errorMessage`.
 *
 * A webview has no NSAlert, so the one thing that has to be preserved is what the alert
 * is for: it blocks, and it is dismissed deliberately. A toast that fades would change
 * the behaviour, because these messages are refusals the user has to read before they
 * understand why nothing happened.
 *
 * The backdrop token is the command palette's. That is a borrow, and it is the only
 * scrim colour the handoff defines, so inventing a second one would be worse.
 */

export function ErrorAlert({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      id="error-alert"
      role="alertdialog"
      aria-label="Error"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--wb-palette-backdrop)',
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: '80vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--wb-s4)',
          padding: 'var(--wb-s6)',
          background: 'var(--wb-palette-surface)',
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
          Error
        </span>
        <span style={{ fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n400)' }}>
          {message}
        </span>
        <button
          autoFocus
          onClick={onDismiss}
          style={{
            alignSelf: 'flex-end',
            padding: 'var(--wb-s2) var(--wb-s4)',
            // `fontFamily`, never the `font` shorthand: `font: inherit` after a
            // `fontSize` silently resets the size back to the inherited one, because the
            // shorthand rewrites every part of it.
            fontFamily: 'inherit',
            fontSize: 'var(--wb-fs-secondary)',
            color: 'var(--wb-accent)',
            background: 'transparent',
            border: '1px solid var(--wb-accent)',
            borderRadius: 'var(--wb-radius-md)',
            cursor: 'pointer',
          }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
