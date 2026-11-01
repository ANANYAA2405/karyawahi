/**
 * One way, from anywhere on a page, to open the Claude drawer with a question already asked:
 * the command palette, the home page's suggestions and a draft's "Ask a follow-up" all call this.
 */
export const ASK_CLAUDE_EVENT = 'kv:ask-claude';

export const askClaude = (question: string) =>
  window.dispatchEvent(new CustomEvent<string>(ASK_CLAUDE_EVENT, { detail: question }));
