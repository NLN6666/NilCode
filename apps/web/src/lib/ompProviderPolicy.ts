import type { ServerProviderStatus } from "@synara/contracts";

export type OmpPolicyFeatureId = "launch" | "advisor" | "memory" | "autoLearn";

/** UI-only projection of configured OMP policy. It intentionally has no live/run fields. */
export function projectOmpProviderPolicy(status: ServerProviderStatus | undefined) {
  if (status?.provider !== "omp" || !status.ompPolicy) return undefined;
  const policy = status.ompPolicy;
  return {
    overlayPath: policy.overlayPath,
    sharedHome: policy.sharedHome,
    features: [
      { id: "launch", configured: policy.launch.configured, owner: policy.owner },
      { id: "advisor", configured: policy.advisor.configured, owner: policy.owner },
      { id: "memory", configured: true, owner: policy.owner },
      { id: "autoLearn", configured: policy.autoLearn.configured, owner: policy.owner },
    ] satisfies ReadonlyArray<{
      readonly id: OmpPolicyFeatureId;
      readonly configured: boolean;
      readonly owner: "omp-native";
    }>,
    memoryBackend: policy.memory.backend,
    memorySource: policy.memory.source,
    advisorState: policy.advisor.state,
    advisorModelRole: policy.advisor.modelRole,
    advisorWarning: policy.advisor.warning,
    autoContinue: policy.autoLearn.autoContinue,
    autoLearnExperimental: policy.autoLearn.experimental,
    typedObservabilityPending: policy.typedObservability === "phase-3-required",
  };
}
