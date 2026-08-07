// The wire protocol between Synara and the advisor model.
//
// The advisor has no tools, so its entire contribution is one object per
// evaluation. Two jobs live here: telling it what shape to answer in, and
// refusing anything that is not that shape.
//
// Parsing strips formatting but never loosens the schema. Models wrap JSON in
// fences and prefix it with prose constantly, and that is a presentation
// problem. Guessing intent out of free text would be a different thing entirely:
// every guard downstream - severity routing, dedupe, quarantine - keys off
// fields in this object, so prose that "sounds like" advice must count as a
// failed turn, not as a note.

import { AdvisorVerdict } from "@synara/contracts";
import { Schema } from "effect";

const decodeVerdict = Schema.decodeUnknownSync(AdvisorVerdict);

export const ADVISOR_SYSTEM_PROMPT = `You are an advisor watching another AI coding agent work. You do not write code, run commands, or read files. You only observe what the agent did and, rarely, say something.

Answer with exactly one JSON object and nothing else:

  {"verdict":"silent"}
  {"verdict":"advise","severity":"nit|concern|blocker","message":"<one or two sentences>"}

Silence is the expected answer. Most of the time the agent is working fine and the correct response is {"verdict":"silent"}. Do not narrate, do not summarise, do not confirm that things look good - that is noise, and it will be discarded.

Speak only when you see something the agent appears not to have seen:

  nit      - a smaller/simpler path exists, or something minor is off. Delivered at the next turn boundary; never interrupts.
  concern  - the agent is drifting from what was asked, rebuilding something that exists, or repeating a failed approach. Interrupts the live turn.
  blocker  - the work is destructive, unsafe, or definitively wrong. Interrupts even settled work.

Rules for the message:
- Say what is wrong and why, concretely. "Looks good", "continue", "nothing to add" are rejected outright.
- One point per message. Pick the most important one.
- Do not repeat advice you already gave. If a point you raised is now worse, raise it again at a higher severity.
- Address the agent directly and briefly. It will see your message mid-task.
- Never instruct the agent to run a command. Describe the problem; the agent decides what to do.`;

export function buildAdvisorEvaluationPrompt(input: {
  readonly delta: string;
  readonly workInProgress: boolean;
}): string {
  const header = input.workInProgress
    ? "The agent's work is still in progress. Only a blocker will be acted on; anything less will be discarded, so stay silent unless it is serious."
    : "The agent has finished a turn. Here is everything it did since you last looked.";
  return `${header}\n\n<activity>\n${input.delta}\n</activity>\n\nRespond with one JSON object.`;
}

/**
 * Find the outermost JSON object in a model response.
 *
 * Brace matching rather than a regex, because a message field can legitimately
 * contain braces. String-aware so that a brace inside a quoted message does not
 * end the scan early.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

/** Returns null when the response is not exactly one well-formed verdict. */
export function parseAdvisorVerdict(text: string): AdvisorVerdict | null {
  const json = extractJsonObject(text);
  if (json === null) {
    return null;
  }
  try {
    return decodeVerdict(JSON.parse(json));
  } catch {
    // Malformed JSON and a well-formed object of the wrong shape are the same
    // failure here: the advisor did not answer in the one shape it may answer in.
    return null;
  }
}
