import { Effect, ServiceMap, type Scope } from "effect";

export interface AdvisorReactorShape {
  /** Subscribe to domain events and begin watching threads. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /** Resolve once every event admitted so far has been processed. */
  readonly drain: Effect.Effect<void>;
}

export class AdvisorReactor extends ServiceMap.Service<AdvisorReactor, AdvisorReactorShape>()(
  "synara/advisor/Services/AdvisorReactor",
) {}
