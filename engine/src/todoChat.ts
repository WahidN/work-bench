import type Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { getTodo, listTodoMessages, addTodoMessage } from './todos.js';
import { getProject } from './projects.js';
import { runClaude } from './claude.js';
import type { Todo, Project, TodoMessage } from './types.js';

export function buildTodoChatPrompt(
  todo: Todo,
  project: Project | null,
  messages: TodoMessage[]
): string {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'You' : 'Claude'}: ${m.content}`).join('\n');
  const reference = todo.sourceId ?? `todo ${todo.id}`;
  // A mapped issue is worth reading the code for. An unmapped one has no checkout,
  // so say that plainly instead of letting it guess at files it cannot see.
  const scope = project
    ? `The repository for this issue is checked out in the current directory, so you may read it. This is read-only analysis and discussion - do not make any changes.`
    : `No repository is mapped for this issue, so you have no files to read. Answer from the issue text alone, and say so when the text is not enough.`;

  return `You are helping the engineer who owns this Jira issue work out what to do with it.

Issue: ${reference}
Title: ${todo.text}
${todo.body ? `\nDescription:\n${todo.body}\n` : ''}
${scope}
${transcript ? `\nDiscussion so far:\n${transcript}` : ''}

Respond conversationally to continue the discussion, or answer their latest question.`;
}

export async function sendTodoMessage(
  db: Database.Database,
  todoId: number,
  userMessage: string
): Promise<string> {
  const todo = getTodo(db, todoId);
  if (!todo) throw new Error(`Todo ${todoId} not found`);

  addTodoMessage(db, todoId, 'user', userMessage);

  // A null project id, or an id pointing at a deleted project, both mean the same
  // thing here: there is no checkout, so no directory and no tools.
  const project = todo.projectId === null ? null : getProject(db, todo.projectId);
  const messages = listTodoMessages(db, todoId);
  const reply = await runClaude({
    cwd: project ? project.repoPath : tmpdir(),
    prompt: buildTodoChatPrompt(todo, project, messages),
    allowedTools: project ? ['Read', 'Grep', 'Glob'] : [],
    timeoutMs: 15 * 60 * 1000,
  });
  addTodoMessage(db, todoId, 'assistant', reply);
  return reply;
}
