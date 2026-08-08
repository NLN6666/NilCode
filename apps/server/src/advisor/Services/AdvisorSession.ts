import type {
  AdvisorModelSelection,
  AdvisorVerdict,
  ProviderStartOptions,
  ThreadId,
} from "@synara/contracts";
import { Effect, ServiceMap } from "effect";

export interface AdvisorEvaluationInput {
  /** Thread being watched; carried for logging only. */
  readonly mainThreadId: ThreadId;
  readonly modelSelection: AdvisorModelSelection;
  readonly cwd?: string | undefined;
  /**
   * Where the provider CLIs live, exactly as a main session resolves them.
   *
   * Without this the shadow session falls back to a bare command name, which
   * the server process cannot resolve when the binary sits outside its PATH -
   * the CLI then exits 127 before the advisor ever sees a prompt.
   */
  readonly providerOptions?: ProviderStartOptions | undefined;
  readonly delta: string;
  /**
   * What the user asked for, rendered from the thread's recent messages.
   *
   * Separate from the delta because it has to survive every evaluation: the
   * delta is emptied each time, and the goal is what the delta is judged
   * against. Null on a thread with no user message yet.
   */
  readonly request?: string | null;
  readonly workInProgress: boolean;
}

export interface AdvisorSessionShape {
  /**
   * Ask the advisor about one delta.
   *
   * Stateless: there is nothing to start and nothing to forget. Each call is
   * one prompt answered once.
   *
   * Never fails. The advisor is an observer: a broken advisor must degrade to
   * silence, never to a stalled or failed main turn. Every failure mode -
   * unparseable output, timeout, a runtime that will not start - surfaces as
   * `null`.
   */
  readonly evaluate: (input: AdvisorEvaluationInput) => Effect.Effect<AdvisorVerdict | null>;
}

export class AdvisorSession extends ServiceMap.Service<AdvisorSession, AdvisorSessionShape>()(
  "synara/advisor/Services/AdvisorSession",
) {}
