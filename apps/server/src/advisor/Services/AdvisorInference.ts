import type { AdvisorModelSelection, ProviderStartOptions } from "@synara/contracts";
import { Effect, ServiceMap } from "effect";

export interface AdvisorInferenceInput {
  readonly modelSelection: AdvisorModelSelection;
  /** The whole prompt: the advisor's instructions plus the delta under review. */
  readonly prompt: string;
  readonly cwd?: string | undefined;
  /** Where the provider CLIs live, resolved exactly as a main session does it. */
  readonly providerOptions?: ProviderStartOptions | undefined;
}

export interface AdvisorInferenceShape {
  /**
   * Run one prompt against the advisor's model and return the reply.
   *
   * One process, one prompt, one answer - no session, no resume cursor, no
   * lifecycle. The advisor never calls a tool and never needs to remember a
   * previous turn, so everything a provider session exists to manage is cost
   * without benefit here.
   *
   * Never fails. A broken advisor must degrade to silence rather than to a
   * stalled main turn, so every failure path surfaces as `null`.
   */
  readonly run: (input: AdvisorInferenceInput) => Effect.Effect<string | null>;
}

export class AdvisorInference extends ServiceMap.Service<AdvisorInference, AdvisorInferenceShape>()(
  "synara/advisor/Services/AdvisorInference",
) {}
