import { useEffect, useMemo, useState } from 'react'
import { render } from '@gpuix/react'

import { fetchMyPrs, type Pr, type Reason } from './github'
import { inRepo, repoCounts, shortName } from './repos'

// GPUI does not inherit `color`, so every <text> sets one from here.
const C = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  border: '#292929',
  hover: '#E6EAF20D',
  active: '#E6EAF217',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  ghost: '#6B6B6B',
  accent: '#E2795B',
  error: '#F07171',
}

const REASON_LABEL: Record<Reason, string> = { assigned: 'Assigned', review: 'Review' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function SidebarRow({
  testId,
  label,
  count,
  active,
  onClick,
}: {
  testId: string
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 30,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        cursor: 'pointer',
        backgroundColor: active ? C.active : undefined,
        hover: active ? undefined : { backgroundColor: C.hover },
      }}
    >
      <text style={{ flexGrow: 1, fontSize: 13, color: active ? C.text : C.secondary }}>{label}</text>
      <text style={{ fontSize: 12, color: C.ghost }}>{String(count)}</text>
    </div>
  )
}

function PrRow({ pr }: { pr: Pr }) {
  return (
    <div
      testId={`pr-${pr.repo}#${pr.number}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 8,
        hover: { backgroundColor: C.hover },
      }}
    >
      <text style={{ fontSize: 14, lineHeight: 20, color: C.text }}>{pr.title}</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <text style={{ fontSize: 12, color: C.secondary }}>
          {`${shortName(pr.repo)}#${pr.number}`}
        </text>
        <text style={{ fontSize: 12, color: C.ghost }}>{pr.author}</text>
        {pr.reasons.map((reason) => (
          <text key={reason} style={{ fontSize: 12, color: C.accent }}>
            {REASON_LABEL[reason]}
          </text>
        ))}
      </div>
    </div>
  )
}

function Message({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ flexGrow: 1, minHeight: 0, padding: 24 }}>
      <text style={{ fontSize: 13, lineHeight: 20, color }}>{text}</text>
    </div>
  )
}

export function PrApp({ load = fetchMyPrs }: { load?: () => Promise<Pr[]> }) {
  const [prs, setPrs] = useState<Pr[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  const refresh = () => {
    setLoading(true)
    load()
      .then((fresh) => {
        setPrs(fresh)
        setError(null)
      })
      .catch((failure) => setError(errorMessage(failure)))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const repos = useMemo(() => repoCounts(prs ?? []), [prs])
  // A picked repo with nothing left after a refresh falls back to All.
  const repo = repos.some((entry) => entry.repo === picked) ? picked : null
  const visible = inRepo(prs ?? [], repo)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: C.canvas,
      }}
    >
      <div
        style={{
          width: 220,
          height: '100%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: 10,
          backgroundColor: C.sidebar,
          borderRightWidth: 1,
          borderColor: C.border,
        }}
      >
        <SidebarRow
          testId="repo-all"
          label="All"
          count={prs?.length ?? 0}
          active={repo === null}
          onClick={() => setPicked(null)}
        />
        {repos.map((entry) => (
          <SidebarRow
            key={entry.repo}
            testId={`repo-${entry.repo}`}
            label={shortName(entry.repo)}
            count={entry.count}
            active={entry.repo === repo}
            onClick={() => setPicked(entry.repo)}
          />
        ))}
      </div>

      <div style={{ flexGrow: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            height: 52,
            flexShrink: 0,
            paddingLeft: 20,
            paddingRight: 14,
          }}
        >
          <text style={{ fontSize: 15, color: C.text }}>Pull requests</text>
          <text style={{ fontSize: 13, color: C.ghost }}>{String(visible.length)}</text>
          <div style={{ flexGrow: 1 }} />
          <div
            testId="refresh"
            onClick={loading ? undefined : refresh}
            style={{
              height: 28,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 7,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
              hover: { backgroundColor: C.hover },
            }}
          >
            <text style={{ fontSize: 13, color: C.secondary }}>{loading ? 'Refreshing' : 'Refresh'}</text>
          </div>
        </div>

        {error ? (
          <Message text={error} color={C.error} />
        ) : prs === null ? (
          <Message text="Loading pull requests" color={C.secondary} />
        ) : visible.length === 0 ? (
          <Message text="No open pull requests" color={C.secondary} />
        ) : (
          <virtual-list
            estimatedItemHeight={64}
            style={{ flexGrow: 1, minHeight: 0 }}
          >
            {/* A row is laid out at the list width, so the side padding goes on the row. */}
            {visible.map((pr) => (
              <div key={pr.url} style={{ paddingLeft: 10, paddingRight: 10 }}>
                <PrRow pr={pr} />
              </div>
            ))}
          </virtual-list>
        )}
      </div>
    </div>
  )
}

// Only open a window when this file is the program, so a test can import `PrApp`.
const isEntryPoint =
  typeof Bun !== 'undefined' && (Bun.isStandaloneExecutable || Bun.main === import.meta.path)

if (isEntryPoint) {
  render(<PrApp />, {
    title: 'Workbench',
    width: 960,
    height: 680,
    focus: process.env.GPUIX_BACKGROUND !== '1',
  })
}
