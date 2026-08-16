// Keep the renderer and virtualization estimator on the same collapsed-message
// policy. The character threshold is only a first-paint overflow hint; rendered
// and estimated heights are both governed by the line limit.
export const COLLAPSED_USER_MESSAGE_MAX_CHARS = 600;
export const COLLAPSED_USER_MESSAGE_DIRECT_FIT_MAX_CHARS = 96;
export const USER_MESSAGE_COLLAPSED_MAX_LINES = 12;
export const USER_MESSAGE_COLLAPSED_FADE_LINES = 2;

const STRUCTURED_USER_MESSAGE_PATTERN = /[\r\n`*_#[\]<>|~]/;

export function userMessageDefinitelyFitsCollapsedView(
  text: string,
  options: {
    hasMentionReferences: boolean;
    hasTerminalContexts: boolean;
  },
): boolean {
  // The narrowest supported chat pane is 20rem. At the largest supported chat
  // font (18px), 96 plain-text characters still fit comfortably inside the
  // 12-line clamp. Rich inline content and Markdown structure keep the exact
  // DOM measurement path because their rendered height is not text-length bound.
  return (
    text.length <= COLLAPSED_USER_MESSAGE_DIRECT_FIT_MAX_CHARS &&
    !options.hasMentionReferences &&
    !options.hasTerminalContexts &&
    !STRUCTURED_USER_MESSAGE_PATTERN.test(text)
  );
}

export function userMessageLikelyOverflows(text: string): boolean {
  if (text.length > COLLAPSED_USER_MESSAGE_MAX_CHARS) {
    return true;
  }

  let newlineCount = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    newlineCount += 1;
    if (newlineCount >= USER_MESSAGE_COLLAPSED_MAX_LINES) {
      return true;
    }
  }
  return false;
}

export function resolveCollapsedUserMessageLineEstimate(estimatedLines: number): {
  renderedLines: number;
  collapsible: boolean;
} {
  const safeLines = Math.max(0, estimatedLines);
  return {
    renderedLines: Math.min(safeLines, USER_MESSAGE_COLLAPSED_MAX_LINES),
    collapsible: safeLines > USER_MESSAGE_COLLAPSED_MAX_LINES,
  };
}
