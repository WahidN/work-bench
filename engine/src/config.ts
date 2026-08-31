// The engine's port lives here rather than in index.ts because the Jira OAuth
// redirect URI is assembled from it, and Atlassian matches that URI exactly. Two
// copies of this number would break the flow with an opaque Atlassian error and
// nothing in the codebase pointing at the cause.
export const ENGINE_PORT = 4173;
