/*
 * What Workbench is running right now.
 *
 * There is nothing to talk to here. A review and a comment fix are headless: they run a
 * Claude session in a detached worktree and answer by changing the branch, so this lists
 * them and opens what they work on, rather than pretending to be a conversation.
 */

import { Icon } from './Icon'
import { agentElapsed, agentLabel, agentTarget, canOpenAgent, type RunningAgent } from './agentsLogic'

export function AgentsScreen({
  agents,
  onOpenPr,
}: {
  agents: RunningAgent[]
  onOpenPr: (prId: number) => void
}) {
  const now = new Date()

  return (
    <div
      id="agents-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-s6)',
        padding: 'var(--wb-s8)',
        maxWidth: 1180,
        background: 'var(--wb-bg)',
        boxSizing: 'border-box',
      }}
    >
      {agents.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--wb-fs-secondary)', color: 'var(--wb-n600)' }}>
          No agent is running. Start one by reviewing a pull request, or by asking for a fix
          on a review comment.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {agents.map((agent) => {
            const canOpen = canOpenAgent(agent)
            return (
              <div
                key={agent.key}
                data-agent={agent.targetId}
                data-agent-waiting={agent.waiting ? 'true' : 'false'}
                onClick={() => {
                  if (canOpen) onOpenPr(agent.targetId)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--wb-s3)',
                  padding: 'var(--wb-s3) var(--wb-s4)',
                  borderBottom: '1px solid var(--wb-n900)',
                  boxSizing: 'border-box',
                  cursor: canOpen ? 'pointer' : 'default',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    flex: 'none',
                    borderRadius: '50%',
                    background: agent.waiting ? 'var(--wb-n600)' : 'var(--wb-accent)',
                  }}
                />

                <div
                  style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}
                >
                  <span
                    style={{
                      fontSize: 'var(--wb-fs-secondary)',
                      color: 'var(--wb-text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {agentTarget(agent)}
                  </span>
                  <span style={{ fontSize: 'var(--wb-fs-label)', color: 'var(--wb-n600)' }}>
                    {agentLabel(agent)} {agentElapsed(agent, now)}
                  </span>
                </div>

                {canOpen && <Icon name="arrow-triangle-pull" size={13} color="var(--wb-n600)" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
