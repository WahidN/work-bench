import type Database from 'better-sqlite3';
import { getProject, listProjectMessages, addProjectMessage } from './projects.js';
import { runClaude } from './claude.js';
import type { ProjectMessage } from './types.js';

export function buildProjectChatPrompt(projectName: string, messages: ProjectMessage[]): string {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'You' : 'Claude'}: ${m.content}`).join('\n');
  return `You are helping the engineer who owns the "${projectName}" project decide what to work on. This is read-only analysis and discussion - do not make any changes.
${transcript ? `\nDiscussion so far:\n${transcript}` : ''}

Respond conversationally to continue the discussion, or answer their latest question.`;
}

export async function sendProjectMessage(
  db: Database.Database,
  projectId: number,
  userMessage: string
): Promise<string> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  addProjectMessage(db, projectId, 'user', userMessage);

  const messages = listProjectMessages(db, projectId);
  const reply = await runClaude({
    cwd: project.repoPath,
    prompt: buildProjectChatPrompt(project.name, messages),
    allowedTools: ['Read', 'Grep', 'Glob'],
    timeoutMs: 15 * 60 * 1000,
  });
  addProjectMessage(db, projectId, 'assistant', reply);
  return reply;
}
