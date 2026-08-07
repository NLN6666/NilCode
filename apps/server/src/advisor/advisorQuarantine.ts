// Safety gate on advisor output.
//
// Modelled on Oh My Pi's quarantineAdvisorUnsafeOutput (see README
// acknowledgements).
//
// Why this exists: an accepted note is injected into the main model's input, so
// the advisor is a prompt-injection path. Untrusted text the main model reads -
// a file, a web page, a tool result - reaches the advisor as digest lines. If
// the advisor repeats an instruction out of that text, it arrives at the main
// model as advice rather than as data. The advisor has no tools of its own, but
// the model it advises has all of them.
//
// The central distinction is output-only: hazardous content the advisor
// ORIGINATED, versus content it is quoting back from what the model already did.
// Without that distinction the gate would be useless, because the advisor could
// never warn about a dangerous command - saying "you just ran rm -rf /" would
// quarantine itself.

const DESTRUCTIVE_SHELL_PATTERNS: readonly RegExp[] = [
  /\brm\s+-[a-z]*[rf][a-z]*\s+\/?/i,
  /--no-preserve-root/i,
  /\bmkfs(\.\w+)?\s/i,
  /\bdd\s+if=/i,
  /\bgit\s+push\s+(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bdrop\s+(table|database)\b/i,
  /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;?\s*:/,
];

const INSTRUCTION_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i,
  /\bdisregard\s+(?:your|all|the|any)\s+(?:previous|prior|above|earlier)\s+instructions?\b/i,
  /\byou\s+are\s+now\s+(?:a|an|the)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\boverride\s+(?:your|the)\s+(?:system\s+)?prompt\b/i,
];

const DENIAL_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\bdo\s+not\s+(?:tell|mention|inform|report|notify)\b/i,
  /\bdon'?t\s+(?:tell|mention|inform|report|notify)\b/i,
  /\bkeep\s+(?:this|it)\s+(?:secret|hidden|between)\b/i,
  /\bwithout\s+telling\s+(?:the\s+)?user\b/i,
  /\bhide\s+(?:this|it)\s+from\b/i,
];

const ACCOUNT_DELETION_PATTERNS: readonly RegExp[] = [
  /\bdelete\s+(?:your|the|my)\s+account\b/i,
  /\brevoke\s+all\s+(?:credentials|tokens|keys|access)\b/i,
  /\bdelete\s+the\s+(?:repository|repo|organization|org)\b/i,
  /\bexfiltrate\b/i,
];

/** Hazard classes that must co-occur before a non-destructive note is unsafe. */
const CO_OCCURRENCE_QUARANTINE_THRESHOLD = 3;

export const ADVISOR_MAX_CONSECUTIVE_QUARANTINES = 2;

export interface AdvisorQuarantineState {
  readonly consecutive: number;
}

export const INITIAL_ADVISOR_QUARANTINE_STATE: AdvisorQuarantineState = { consecutive: 0 };

/**
 * Whether any pattern matches text the advisor originated rather than quoted.
 *
 * A match whose exact text also appears in the source context is the advisor
 * reporting on the main model's own actions, which is its job.
 */
function hasOutputOnlyMatch(
  message: string,
  sourceText: string,
  patterns: readonly RegExp[],
): boolean {
  const haystack = sourceText.toLowerCase();
  return patterns.some((pattern) => {
    const match = pattern.exec(message);
    return match !== null && !haystack.includes(match[0].toLowerCase());
  });
}

function containsDestructiveCommand(text: string): boolean {
  return DESTRUCTIVE_SHELL_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAdvisorOutputUnsafe(input: {
  readonly message: string;
  readonly sourceText: string;
}): boolean {
  const { message, sourceText } = input;

  // A destructive command the advisor invented is on its own enough: it has no
  // legitimate reason to author one.
  if (hasOutputOnlyMatch(message, sourceText, DESTRUCTIVE_SHELL_PATTERNS)) {
    return true;
  }

  const override = hasOutputOnlyMatch(message, sourceText, INSTRUCTION_OVERRIDE_PATTERNS);
  const denial = hasOutputOnlyMatch(message, sourceText, DENIAL_INSTRUCTION_PATTERNS);
  const accountDeletion = hasOutputOnlyMatch(message, sourceText, ACCOUNT_DELETION_PATTERNS);

  // Any one of these alone is too weak - "ignore the previous approach" is
  // ordinary engineering advice. Together they stop looking like advice.
  const hazardClasses = [override, denial, accountDeletion].filter(Boolean).length;
  if (hazardClasses >= CO_OCCURRENCE_QUARANTINE_THRESHOLD) {
    return true;
  }

  // The relay case: the advisor did not author the command, but it is telling
  // the model to obey one that came in from untrusted input.
  return override && containsDestructiveCommand(sourceText);
}

export function recordAdvisorQuarantine(state: AdvisorQuarantineState): AdvisorQuarantineState {
  return { consecutive: state.consecutive + 1 };
}

/** Any accepted turn proves the advisor is not looping; the streak restarts. */
export function recordAdvisorTurnAccepted(_state: AdvisorQuarantineState): AdvisorQuarantineState {
  return INITIAL_ADVISOR_QUARANTINE_STATE;
}

/**
 * Whether the failure is worth telling the user about.
 *
 * The first offence is handled silently by resetting and re-priming the advisor:
 * one bad generation is usually noise. A second in a row is a loop.
 */
export function shouldSurfaceAdvisorQuarantine(state: AdvisorQuarantineState): boolean {
  return state.consecutive >= ADVISOR_MAX_CONSECUTIVE_QUARANTINES;
}
