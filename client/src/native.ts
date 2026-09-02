/*
 * The native surface: notifications, the clipboard and the account name.
 *
 * Everything here needs the app. In a browser each call is a no-op that says so rather than
 * throwing, because these are all things the screens do incidentally and none of them is
 * worth an error dialog when the answer is simply "not here".
 */

const IN_TAURI = '__TAURI_INTERNALS__' in window

/**
 * Asks for notification permission once, at launch.
 *
 * `applicationDidFinishLaunching` does the same with `requestAuthorization`. Asking at the
 * moment of the first notification would put the macOS prompt in front of the user at the
 * least useful time, and the notification itself would be dropped while they read it.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!IN_TAURI) return false
  const { isPermissionGranted, requestPermission } = await import(
    '@tauri-apps/plugin-notification'
  )
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

/**
 * One notification. Silent when permission was refused, which is the user's answer and not
 * an error to report back to them.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (!IN_TAURI) return
  const { isPermissionGranted, sendNotification } = await import(
    '@tauri-apps/plugin-notification'
  )
  if (!(await isPermissionGranted())) return
  sendNotification({ title, body })
}

/**
 * Copies text, replacing `NSPasteboard.general.setString`.
 *
 * The plugin rather than `navigator.clipboard`, which in a webview depends on a secure
 * context and on the document having focus, and fails silently when it does not. The
 * plugin goes through Rust and has neither condition.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (!IN_TAURI) {
    await navigator.clipboard.writeText(text)
    return
  }
  const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
  await writeText(text)
}

/**
 * The signed-in user's full name, for the sidebar footer.
 *
 * The spike hard-coded this, because `ProcessInfo.processInfo.fullUserName` is not
 * something a webview can see. Empty here means the app could not be asked, and the
 * sidebar falls back rather than rendering a footer with no name in it.
 */
export async function accountName(): Promise<string> {
  if (!IN_TAURI) return ''
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('account_name')
}
