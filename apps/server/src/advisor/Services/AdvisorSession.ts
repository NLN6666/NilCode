import type { AdvisorModelSelection, AdvisorVerdict, ThreadId } from "@synara/contracts";
import { Effect, ServiceMap, type Scope } from "effect";

export interface AdvisorEvaluationInput {
  /** Thread being watched. The shadow session id is derived from it. */
  readonly mainThreadId: ThreadId;
  readonly modelSelection: AdvisorModelSelection;
  readonly cwd?: string | undefined;
  readonly delta: string;
  readonly workInProgress: boolean;
}

export interface AdvisorSessionShape {
  /** Subscribe to provider events. Must run before any evaluate call. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Ask the advisor about one delta.
   *
   * Never fails. The advisor is an observer: a broken advisor must degrade to
   * silence, never to a stalled or failed main turn. Every failure mode -
   * unparseable output, timeout, dead session - surfaces as `null`.
   */
  readonly evaluate: (input: AdvisorEvaluationInput) => Effect.Effect<AdvisorVerdict | null>;

  /** Drop the shadow session and all state for a thread. */
  readonly forget: (mainThreadId: ThreadId) => Effect.Effect<void>;
}

export class AdvisorSession extends ServiceMap.Service<AdvisorSession, AdvisorSessionShape>()(
  "synara/advisor/Services/AdvisorSession",
) {}
