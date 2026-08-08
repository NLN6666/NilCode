// Turns one delta into one advisor verdict.
//
// This layer owns the advisor protocol and nothing else: build the prompt,
// parse the reply. Actually reaching the model is AdvisorInference's job, and
// it does that with a single short-lived process - see that file for why the
// shadow provider session this used to run was removed.
//
// There is no state here. No session to prime, no consecutive-failure kill
// switch, no shadow thread id. A misconfigured advisor now recovers on the
// next turn instead of staying switched off until the server restarts.

import { Effect, Layer } from "effect";

import {
  ADVISOR_SYSTEM_PROMPT,
  buildAdvisorEvaluationPrompt,
  parseAdvisorVerdict,
} from "../advisorProtocol.ts";
import { AdvisorInference } from "../Services/AdvisorInference.ts";
import { AdvisorSession, type AdvisorSessionShape } from "../Services/AdvisorSession.ts";

/** How much of an unparseable advisor reply reaches the log. */
const ADVISOR_REPLY_PREVIEW_CHARS = 200;

export const make = Effect.gen(function* () {
  const inference = yield* AdvisorInference;

  const evaluate: AdvisorSessionShape["evaluate"] = (input) =>
    Effect.gen(function* () {
      // Every evaluation carries its own instructions. A session that answers
      // exactly one question has nothing worth remembering, and the few
      // hundred tokens this repeats buy the removal of a whole lifecycle.
      const prompt = `${ADVISOR_SYSTEM_PROMPT}\n\n---\n\n${buildAdvisorEvaluationPrompt({
        delta: input.delta,
        request: input.request ?? null,
        workInProgress: input.workInProgress,
      })}`;

      const text = yield* inference.run({
        modelSelection: input.modelSelection,
        prompt,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
      });
      if (text === null) {
        // AdvisorInference already logged which failure path was taken.
        return null;
      }

      const verdict = parseAdvisorVerdict(text);
      if (verdict === null) {
        // A reply that will not parse is the one failure the model itself can
        // fix, so the shape of what it said is the whole diagnostic. Only a
        // prefix is logged: the advisor quotes the work under review.
        yield* Effect.logWarning("advisor reply was not a valid verdict", {
          threadId: input.mainThreadId,
          replyLength: text.length,
          replyPreview: text.slice(0, ADVISOR_REPLY_PREVIEW_CHARS),
        });
      }
      return verdict;
    });

  return { evaluate } satisfies AdvisorSessionShape;
});

export const AdvisorSessionLive = Layer.effect(AdvisorSession, make);
