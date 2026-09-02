import { useEffect, useState, type FC } from 'react'
import { Shell } from './Shell'
import { Swatches } from './Swatches'
import { TrayProbe } from './TrayProbe'
import { renderTrayIcon } from './trayBadge'

/*
 * A hash switch rather than a router. The spike needs to reach several evidence pages
 * from one build, and pulling in a router would be a decision the spike has no business
 * making on the real client's behalf.
 */
const PAGES: Record<string, FC> = {
  '#app': Shell,
  '#tokens': Swatches,
  '#tray': TrayProbe,
}

const DEFAULT_PAGE = '#app'

/*
 * Sets the idle tray icon once at launch, before any engine data has arrived.
 *
 * Kept alongside Shell's own badge push rather than replaced by it: Shell can only push
 * a count once /today has answered, so without this the tray would have no icon at all
 * while the engine is unreachable.
 */
function useIdleTrayIcon() {
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let cancelled = false
    ;(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const icon = await renderTrayIcon(0, 2)
      if (cancelled) return
      try {
        await invoke('set_tray_icon', {
          rgba: Array.from(icon.rgba),
          width: icon.width,
          height: icon.height,
          isTemplate: icon.isTemplate,
        })
      } catch (error) {
        console.error('could not set the idle tray icon', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash || DEFAULT_PAGE)

  useIdleTrayIcon()

  useEffect(() => {
    const onChange = () => setHash(window.location.hash || DEFAULT_PAGE)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const Page = PAGES[hash] ?? Shell

  // The app page renders without the debug nav: it is measured against the Swift app,
  // and a strip of extra chrome at the top would shift every y coordinate.
  if (Page === Shell) return <Shell />

  return (
    <>
      <nav
        style={{
          display: 'flex',
          gap: 'var(--wb-s4)',
          padding: 'var(--wb-s3) var(--wb-s8)',
          borderBottom: '1px solid var(--wb-divider)',
          background: 'var(--wb-sidebar-gradient-top)',
          fontSize: 'var(--wb-fs-secondary)',
        }}
      >
        {Object.keys(PAGES).map((key) => (
          <a
            key={key}
            href={key}
            style={{
              color: key === hash ? 'var(--wb-accent)' : 'var(--wb-n500)',
              textDecoration: 'none',
            }}
          >
            {key.slice(1)}
          </a>
        ))}
      </nav>
      <Page />
    </>
  )
}
