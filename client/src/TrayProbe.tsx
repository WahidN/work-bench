/*
 * Probe 3's evidence page.
 *
 * The menu bar cannot be photographed on this machine, so the same bitmap that goes to
 * the tray is also painted into the page at 1x and blown up 6x with nearest-neighbour
 * scaling. That makes the badge geometry checkable in a browser screenshot even though
 * the tray itself is invisible to the harness.
 */

import { useEffect, useRef, useState } from 'react'
import { renderTrayIcon } from './trayBadge'
import { diffIcon, formatDiffs, type IconDiff } from './trayDiff'

const COUNTS = [0, 1, 9, 12]
const IN_TAURI = '__TAURI_INTERNALS__' in window

function Diff() {
  const [report, setReport] = useState('TRAY DIFF pending')

  useEffect(() => {
    let cancelled = false
    document.fonts.ready
      .then(() => Promise.all(COUNTS.map(diffIcon)))
      .then((diffs: IconDiff[]) => {
        if (!cancelled) setReport(formatDiffs(diffs))
      })
      .catch((error) => {
        if (!cancelled) setReport(`TRAY DIFF FAILED ${String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <pre
      id="tray-diff"
      style={{
        marginTop: 'var(--wb-s4)',
        padding: 'var(--wb-s4)',
        background: 'var(--wb-surface)',
        border: '1px solid var(--wb-divider)',
        borderRadius: 'var(--wb-radius-md)',
        fontSize: 'var(--wb-fs-table-meta)',
      }}
    >
      {report}
    </pre>
  )
}

function IconCell({ count }: { count: number }) {
  const actual = useRef<HTMLCanvasElement>(null)
  const zoomed = useRef<HTMLCanvasElement>(null)
  const [meta, setMeta] = useState('')

  useEffect(() => {
    let cancelled = false
    renderTrayIcon(count, 2, actual.current ?? undefined).then((icon) => {
      if (cancelled) return
      setMeta(
        `${icon.width}x${icon.height} template=${icon.isTemplate} ` +
          `textWidth=${icon.badgeTextWidth.toFixed(2)}/10pt disc`,
      )

      // Nearest-neighbour blow-up so a screenshot shows where each pixel landed.
      const big = zoomed.current
      const source = actual.current
      if (!big || !source) return
      big.width = icon.width * 6
      big.height = icon.height * 6
      const context = big.getContext('2d')
      if (!context) return
      context.imageSmoothingEnabled = false
      context.drawImage(source, 0, 0, big.width, big.height)
    })
    return () => {
      cancelled = true
    }
  }, [count])

  return (
    <div id={`tray-cell-${count}`} style={{ textAlign: 'center' }}>
      {/* White ground: the exported SF Symbol is black on transparent, which is what a
          template image needs, so on the dark page background it would be invisible. */}
      <div style={{ background: '#ffffff', padding: 'var(--wb-s2)', borderRadius: 4 }}>
        <canvas ref={zoomed} id={`tray-zoom-${count}`} style={{ display: 'block' }} />
      </div>
      <canvas ref={actual} id={`tray-actual-${count}`} style={{ display: 'none' }} />
      <div style={{ fontSize: 'var(--wb-fs-tag)', color: 'var(--wb-n500)', marginTop: 'var(--wb-s1)' }}>
        count {count}
      </div>
      <div id={`tray-meta-${count}`} style={{ fontSize: 'var(--wb-fs-tag)', color: 'var(--wb-n600)' }}>
        {meta}
      </div>
    </div>
  )
}

export function TrayProbe() {
  const [pushed, setPushed] = useState('not attempted')
  const [count, setCount] = useState(0)

  // Only meaningful inside the app: in Chrome there is no tray to push to.
  useEffect(() => {
    if (!IN_TAURI) {
      setPushed('skipped, not running in Tauri')
      return
    }
    let cancelled = false
    ;(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const icon = await renderTrayIcon(count, 2)
      try {
        const report = await invoke<string>('set_tray_icon', {
          rgba: Array.from(icon.rgba),
          width: icon.width,
          height: icon.height,
          isTemplate: icon.isTemplate,
        })
        if (!cancelled) setPushed(`ok ${report}`)
      } catch (error) {
        if (!cancelled) setPushed(`failed ${String(error)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [count])

  return (
    <section style={{ padding: 'var(--wb-s8)' }}>
      <h1
        style={{
          fontSize: 'var(--wb-fs-screen-title)',
          fontWeight: 500,
          margin: '0 0 var(--wb-s6)',
        }}
      >
        Tray badge
      </h1>

      <div style={{ display: 'flex', gap: 'var(--wb-s6)', alignItems: 'flex-start' }}>
        {COUNTS.map((c) => (
          <IconCell key={c} count={c} />
        ))}
      </div>

      <div style={{ marginTop: 'var(--wb-s6)', display: 'flex', gap: 'var(--wb-s2)' }}>
        {COUNTS.map((c) => (
          <button
            key={c}
            onClick={() => setCount(c)}
            style={{
              background: c === count ? 'var(--wb-a700)' : 'var(--wb-surface)',
              color: 'var(--wb-text)',
              border: '1px solid var(--wb-divider)',
              borderRadius: 'var(--wb-radius-sm)',
              padding: 'var(--wb-s2) var(--wb-s4)',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            push {c}
          </button>
        ))}
      </div>

      <pre
        id="tray-push"
        style={{
          marginTop: 'var(--wb-s4)',
          padding: 'var(--wb-s4)',
          background: 'var(--wb-surface)',
          border: '1px solid var(--wb-divider)',
          borderRadius: 'var(--wb-radius-md)',
          fontSize: 'var(--wb-fs-table-meta)',
        }}
      >
        {`tray push: ${pushed}`}
      </pre>

      <Diff />
    </section>
  )
}
