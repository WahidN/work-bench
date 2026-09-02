/*
 * Evidence page for the token port, not a design. Every cell carries an id so a
 * browser session can read its computed style and compare against Theme.swift,
 * which is the only way to prove the port rather than eyeball it.
 */

import { useEffect, useState } from 'react'
import { formatTokenCheck, runTokenCheck } from './tokenCheck'

const NEUTRAL = ['n100', 'n200', 'n300', 'n400', 'n500', 'n600', 'n700', 'n800', 'n900']
const ACCENT = ['a100', 'a200', 'a300', 'a400', 'a500', 'a600', 'a700', 'a800', 'a900']
const STATUS = [
  'status-needs-review',
  'status-changes-requested',
  'status-approved',
  'status-blocked',
  'status-draft',
]
const SURFACES = [
  'sidebar-gradient-top',
  'bg',
  'surface',
  'palette-surface',
  'accent',
  'negative',
]
const SPACE = ['s1', 's2', 's3', 's4', 's6', 's8']
const RADIUS = ['radius-sm', 'radius-md', 'radius-lg']
const FONT_SIZE = [
  'fs-screen-title',
  'fs-card-title',
  'fs-body',
  'fs-secondary',
  'fs-table-meta',
  'fs-label',
  'fs-tag',
]

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--wb-s8)' }}>
      <h2
        style={{
          fontSize: 'var(--wb-fs-label)',
          fontWeight: 'var(--wb-weight-heading)' as never,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--wb-n500)',
          margin: '0 0 var(--wb-s3)',
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', gap: 'var(--wb-s2)', flexWrap: 'wrap' }}>{children}</div>
    </section>
  )
}

function Chip({ token }: { token: string }) {
  return (
    <div
      id={`swatch-${token}`}
      data-token={token}
      style={{
        background: `var(--wb-${token})`,
        width: 76,
        height: 52,
        borderRadius: 'var(--wb-radius-sm)',
        border: '1px solid var(--wb-divider)',
        display: 'flex',
        alignItems: 'flex-end',
        padding: 'var(--wb-s1)',
        fontSize: 'var(--wb-fs-tag)',
        color: 'var(--wb-n900)',
        boxSizing: 'border-box',
      }}
    >
      {token}
    </div>
  )
}

/*
 * Waits for the Inter faces before checking, because a check that runs while the
 * fallback font is still in place measures the wrong thing.
 */
function TokenCheck() {
  const [report, setReport] = useState('TOKEN CHECK pending')

  useEffect(() => {
    document.fonts.ready.then(() => setReport(formatTokenCheck(runTokenCheck())))
  }, [])

  return (
    <pre
      id="token-check"
      style={{
        marginTop: 'var(--wb-s8)',
        padding: 'var(--wb-s4)',
        background: 'var(--wb-surface)',
        border: '1px solid var(--wb-divider)',
        borderRadius: 'var(--wb-radius-md)',
        fontSize: 'var(--wb-fs-table-meta)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {report}
    </pre>
  )
}

export function Swatches() {
  return (
    <main style={{ padding: 'var(--wb-s8)' }}>
      <h1
        style={{
          fontSize: 'var(--wb-fs-screen-title)',
          fontWeight: 'var(--wb-weight-heading)' as never,
          margin: '0 0 var(--wb-s8)',
        }}
      >
        Nocturne tokens
      </h1>

      <Row title="Neutral">
        {NEUTRAL.map((t) => (
          <Chip key={t} token={t} />
        ))}
      </Row>
      <Row title="Accent">
        {ACCENT.map((t) => (
          <Chip key={t} token={t} />
        ))}
      </Row>
      <Row title="Status">
        {STATUS.map((t) => (
          <Chip key={t} token={t} />
        ))}
      </Row>
      <Row title="Surfaces">
        {SURFACES.map((t) => (
          <Chip key={t} token={t} />
        ))}
      </Row>
      <Row title="Project dots">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Chip key={i} token={`dot-${i}`} />
        ))}
      </Row>

      <Row title="Space">
        {SPACE.map((t) => (
          <div key={t} id={`space-${t}`} data-token={t} style={{ textAlign: 'center' }}>
            <div
              style={{
                width: `var(--wb-${t})`,
                height: 40,
                background: 'var(--wb-accent)',
                marginBottom: 'var(--wb-s1)',
              }}
            />
            <span style={{ fontSize: 'var(--wb-fs-tag)', color: 'var(--wb-n500)' }}>{t}</span>
          </div>
        ))}
      </Row>

      <Row title="Radius">
        {RADIUS.map((t) => (
          <div
            key={t}
            id={`radius-${t}`}
            data-token={t}
            style={{
              width: 64,
              height: 52,
              background: 'var(--wb-surface)',
              borderRadius: `var(--wb-${t})`,
              border: '1px solid var(--wb-divider)',
              fontSize: 'var(--wb-fs-tag)',
              color: 'var(--wb-n400)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {t}
          </div>
        ))}
      </Row>

      <Row title="Font size">
        {FONT_SIZE.map((t) => (
          <div
            key={t}
            id={`font-${t}`}
            data-token={t}
            style={{ fontSize: `var(--wb-${t})`, marginRight: 'var(--wb-s6)' }}
          >
            {t}
          </div>
        ))}
      </Row>

      <Row title="Font faces">
        <div id="face-heading" style={{ fontWeight: 500, fontSize: 'var(--wb-fs-card-title)' }}>
          Inter Medium, used by Theme.heading
        </div>
        <div id="face-body" style={{ fontWeight: 400, fontSize: 'var(--wb-fs-card-title)' }}>
          Inter Regular, used by Theme.body
        </div>
      </Row>

      <TokenCheck />
    </main>
  )
}
