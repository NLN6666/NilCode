// Runs the advisor as a shadow provider session.
//
// The shadow session is a real provider session keyed by "advisor:<threadId>"
// with no orchestration thread behind it. Its runtime events are filtered out
// of ingestion (see ProviderRuntimeIngestion), so nothing it emits reaches the
// journal, the projections, or the browser. That filter is also why this layer
// reads the reply straight off the event stream: there is no projection to read
// it from.
//
// The subscription is opened once at start() and lives for the process, not per
// evaluation. streamEvents is a PubSub - a subscription taken after sendTurn
// would miss everything published in between.

import type { AdvisorModelSelection, ProviderRuntimeEvent, ThreadId } from "@synara/contracts";
import { Deferred, Effect, Layer, Option, Ref, Stream } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ADVISOR_SYSTEM_PROMPT, buildAdvisorEvaluationPrompt } from "../advisorProtocol.ts";
import {
  EMPTY_ADVISOR_RESPONSE,
  foldAdvisorResponseEvent,
  type AdvisorResponseState,
} from "../advisorResponseCollector.ts";
import { parseAdvisorVerdict } from "../advisorProtocol.ts";
import { advisorShadowThreadId, isAdvisorShadowThreadId } from "../advisorShadowThread.ts";
import {
  AdvisorSession,
  type AdvisorEvaluationInput,
  type AdvisorSessionShape,
} from "../Services/AdvisorSession.ts";

/** A silent advisor is the common case, but a stalled one must not stall us. */
export const ADVISOR_EVALUATION_TIMEOUT_MS = 90_000;

/**
 * Consecutive failed evaluations before a thread's advisor is switched off.
 *
 * A model that cannot answer in the required shape will not start doing so on
 * the next turn, and every attempt costs a full round trip against the same
 * provider the main agent is using.
 */
export const ADVISOR_MAX_CONSECUTIVE_FAILURES = 3;

interface PendingEvaluation {
  readonly state: AdvisorResponseState;
  readonly done: Deferred.Deferred<AdvisorResponseState>;
}

interface ShadowSessionState {
  /** Serialized model selection; a change forces a fresh session. */
  readonly modelKey: string;
  /** Whether the system prompt has been delivered on this session. */
  readonly primed: boolean;
  readonly consecutiveFailures: number;
  readonly disabled: boolean;
}

function modelKeyOf(selection: AdvisorModelSelection): string {
  return `${selection.provider}:${selection.model}`;
}

export const make = Effect.gen(function* () {
  const providerService = yield* ProviderService;

  const pending = yield* Ref.make(new Map<string, PendingEvaluation>());
  const sessions = yield* Ref.make(new Map<string, ShadowSessionState>());

  const settle = (shadowId: string, entry: PendingEvaluation, state: AdvisorResponseState) =>
    Effect.gen(function* () {
      yield* Ref.update(pending, (map) => {
        const next = new Map(map);
        next.delete(shadowId);
        return next;
      });
      yield* Deferred.succeed(entry.done, state);
    });

  const consume = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const entry = (yield* Ref.get(pending)).get(event.threadId);
      if (entry === undefined) {
        return;
      }
      const next = foldAdvisorResponseEvent(entry.state, event);
      if (next === entry.state) {
        return;
      }
      if (next.outcome === "pending") {
        yield* Ref.update(pending, (map) =>
          new Map(map).set(event.threadId, { ...entry, state: next }),
        );
        return;
      }
      yield* settle(event.threadId, entry, next);
    });

  const start = () =>
    Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) =>
        isAdvisorShadowThreadId(event.threadId) ? consume(event) : Effect.void,
      ),
    ).pipe(Effect.asVoid);

  const stopShadowSession = (shadowId: ThreadId) =>
    providerService.stopSession({ threadId: shadowId }).pipe(Effect.catchCause(() => Effect.void));

  /** Ensure a live session on the requested model, priming it if it is new. */
  const ensureSession = (shadowId: ThreadId, input: AdvisorEvaluationInput) =>
    Effect.gen(function* () {
      const existing = (yield* Ref.get(sessions)).get(shadowId);
      const modelKey = modelKeyOf(input.modelSelection);
      if (existing !== undefined && existing.modelKey === modelKey) {
        return existing;
      }
      if (existing !== undefined) {
        yield* stopShadowSession(shadowId);
      }
      yield* providerService.startSession(shadowId, {
        threadId: shadowId,
        provider: input.modelSelection.provider,
        modelSelection: input.modelSelection,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        // The advisor advises; it never acts. read-only plus a policy that
        // never asks means a stray tool call fails immediately instead of
        // hanging on an approval request nobody will ever answer - the shadow
        // session's events are filtered out before they can reach a user.
        approvalPolicy: "never",
        sandboxMode: "read-only",
        runtimeMode: "approval-required",
      });
      const created: ShadowSessionState = {
        modelKey,
        primed: false,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
        disabled: false,
      };
      yield* Ref.update(sessions, (map) => new Map(map).set(shadowId, created));
      return created;
    });

  const recordOutcome = (shadowId: ThreadId, succeeded: boolean) =>
    Ref.update(sessions, (map) => {
      const current = map.get(shadowId);
      if (current === undefined) {
        return map;
      }
      const failures = succeeded ? 0 : current.consecutiveFailures + 1;
      return new Map(map).set(shadowId, {
        ...current,
        primed: succeeded ? true : current.primed,
        consecutiveFailures: failures,
        disabled: failures >= ADVISOR_MAX_CONSECUTIVE_FAILURES,
      });
    });

  const askAdvisor = (shadowId: ThreadId, prompt: string) =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<AdvisorResponseState>();
      yield* Ref.update(pending, (map) =>
        new Map(map).set(shadowId, { state: EMPTY_ADVISOR_RESPONSE, done }),
      );
      const sent = yield* providerService.sendTurn({ threadId: shadowId, input: prompt }).pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      );
      if (!sent) {
        yield* Ref.update(pending, (map) => {
          const next = new Map(map);
          next.delete(shadowId);
          return next;
        });
        return null;
      }
      const settled = yield* Deferred.await(done).pipe(
        Effect.timeoutOption(ADVISOR_EVALUATION_TIMEOUT_MS),
      );
      if (Option.isNone(settled)) {
        // Reclaim the slot: the collector fiber would otherwise keep folding
        // into a deferred nobody awaits, and the next evaluation would be
        // refused as busy.
        yield* Ref.update(pending, (map) => {
          const next = new Map(map);
          next.delete(shadowId);
          return next;
        });
        yield* stopShadowSession(shadowId);
        yield* Ref.update(sessions, (map) => {
          const next = new Map(map);
          next.delete(shadowId);
          return next;
        });
        return null;
      }
      const response = settled.value;
      return response.outcome === "completed" ? response.text : null;
    });

  const evaluate: AdvisorSessionShape["evaluate"] = (input) =>
    Effect.gen(function* () {
      const shadowId = advisorShadowThreadId(input.mainThreadId);
      if ((yield* Ref.get(sessions)).get(shadowId)?.disabled === true) {
        return null;
      }
      // One evaluation at a time per thread: a second would overwrite the
      // deferred the first is awaiting.
      if ((yield* Ref.get(pending)).has(shadowId)) {
        return null;
      }
      const session = yield* ensureSession(shadowId, input).pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("advisor shadow session failed to start", { shadowId, cause }).pipe(
            Effect.as(null),
          ),
        ),
      );
      if (session === null) {
        yield* recordOutcome(shadowId, false);
        return null;
      }
      const evaluation = buildAdvisorEvaluationPrompt({
        delta: input.delta,
        workInProgress: input.workInProgress,
      });
      // The session persists, so the instructions only have to be sent once -
      // they stay in the advisor's own conversation context after that.
      const prompt = session.primed
        ? evaluation
        : `${ADVISOR_SYSTEM_PROMPT}\n\n---\n\n${evaluation}`;
      const text = yield* askAdvisor(shadowId, prompt);
      const verdict = text === null ? null : parseAdvisorVerdict(text);
      yield* recordOutcome(shadowId, verdict !== null);
      return verdict;
    });

  const forget: AdvisorSessionShape["forget"] = (mainThreadId) =>
    Effect.gen(function* () {
      const shadowId = advisorShadowThreadId(mainThreadId);
      if (!(yield* Ref.get(sessions)).has(shadowId)) {
        return;
      }
      yield* stopShadowSession(shadowId);
      yield* Ref.update(sessions, (map) => {
        const next = new Map(map);
        next.delete(shadowId);
        return next;
      });
      yield* Ref.update(pending, (map) => {
        const next = new Map(map);
        next.delete(shadowId);
        return next;
      });
    });

  return { start, evaluate, forget } satisfies AdvisorSessionShape;
});

export const AdvisorSessionLive = Layer.effect(AdvisorSession, make);
