/*
 * Port of app/Workbench/Views/ProjectsScreen.swift.
 *
 * The grid is `LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: s4)])`, which
 * CSS grid says as `repeat(auto-fill, minmax(280px, 1fr))`: as many equal columns as fit at
 * 280 or more, which is exactly what `.adaptive(minimum:)` means.
 */

import { useState } from 'react'
import { PROJECTS_EMPTY_STATE, prCountLabel, type ProjectCard } from './projectsLogic'

function Card({ card, onSelect }: { card: ProjectCard; onSelect: () => void }) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <button
      data-project-card={card.id}
      title={`Open ${card.name}`}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s3)',
        minHeight: 140,
        padding: 'var(--wb-s6)',
        textAlign: 'left',
        fontFamily: 'inherit',
        background: 'var(--wb-surface)',
        borderRadius: 'var(--wb-radius-md)',
        border: `1px solid ${isHovered ? 'var(--wb-a700)' : 'var(--wb-n900)'}`,
        boxSizing: 'border-box',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--wb-s3)' }}>
        <span
          style={{
            width: 7,
            height: 7,
            flex: 'none',
            borderRadius: '50%',
            background: card.dot,
          }}
        />
        <span
          style={{
            fontSize: 'var(--wb-fs-card-title)',
            fontWeight: 'var(--wb-weight-heading)',
            color: 'var(--wb-text)',
          }}
        >
          {card.name}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--wb-fs-tag)',
            color: 'var(--wb-n400)',
            padding: '2px 7px',
            background: 'var(--wb-n900)',
            borderRadius: 'var(--wb-radius-sm)',
            whiteSpace: 'nowrap',
          }}
        >
          {card.statusLabel}
        </span>
      </div>

      {card.blurb !== '' && (
        <span
          style={{
            fontSize: 'var(--wb-fs-table-meta)',
            lineHeight: 'calc(var(--wb-fs-table-meta) + 6px)',
            color: 'var(--wb-n500)',
          }}
        >
          {card.blurb}
        </span>
      )}

      {/*
        `Spacer(minLength: s3)` then a rule above the footer. The auto margin is the
        spacer: it pushes the footer down whatever the card's height turns out to be, which
        is what keeps the rules aligned across a row of cards with different blurbs.
      */}
      <span
        data-card-footer=""
        style={{
          marginTop: 'auto',
          paddingTop: 'var(--wb-s3)',
          borderTop: '1px solid var(--wb-n900)',
          fontSize: 'var(--wb-fs-table-meta)',
          color: 'var(--wb-n600)',
        }}
      >
        {card.openCount} open · {prCountLabel(card.prCount)} · {card.activity}
      </span>
    </button>
  )
}

export function ProjectsScreen({
  cards,
  onSelect,
}: {
  cards: ProjectCard[]
  onSelect: (card: ProjectCard) => void
}) {
  if (cards.length === 0) {
    return (
      <p
        id="projects-empty"
        style={{
          margin: 0,
          padding: 'var(--wb-s8)',
          fontSize: 'var(--wb-fs-secondary)',
          color: 'var(--wb-n600)',
        }}
      >
        {PROJECTS_EMPTY_STATE}
      </p>
    )
  }

  return (
    <div
      id="projects-screen"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 'var(--wb-s4)',
        alignContent: 'start',
        maxWidth: 1180,
        padding: 'var(--wb-s8)',
        background: 'var(--wb-bg)',
        boxSizing: 'border-box',
      }}
    >
      {cards.map((card) => (
        <Card key={card.id} card={card} onSelect={() => onSelect(card)} />
      ))}
    </div>
  )
}
