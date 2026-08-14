import type { ServerProviderStatus } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { projectOmpProviderPolicy } from "./ompProviderPolicy";

describe("projectOmpProviderPolicy", () => {
  it("projects configured ownership and degradation without inventing live state", () => {
    const status = {
      provider: "omp",
      available: true,
      status: "ready",
      message: "ready",
      checkedAt: "2026-08-14T00:00:00.000Z",
      ompPolicy: {
        owner: "omp-native",
        overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
        sharedHome: true,
        launch: { configured: true, observability: "acp-tool-activity-only" },
        advisor: {
          configured: true,
          state: "degraded",
          warning: "Configure modelRoles.advisor.",
          observability: "transcript-only",
        },
        memory: {
          backend: "local",
          source: "synara-fallback",
          observability: "ordinary-tools-only",
        },
        autoLearn: {
          configured: true,
          autoContinue: true,
          experimental: true,
          observability: "bounded-settle-only",
        },
        typedObservability: "phase-3-required",
      },
    } satisfies ServerProviderStatus;

    const projection = projectOmpProviderPolicy(status);

    expect(projection).toMatchObject({
      overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
      sharedHome: true,
      memoryBackend: "local",
      memorySource: "synara-fallback",
      advisorState: "degraded",
      advisorWarning: "Configure modelRoles.advisor.",
      autoContinue: true,
      autoLearnExperimental: true,
      typedObservabilityPending: true,
    });
    expect(projection?.features).toEqual([
      { id: "launch", configured: true, owner: "omp-native" },
      { id: "advisor", configured: true, owner: "omp-native" },
      { id: "memory", configured: true, owner: "omp-native" },
      { id: "autoLearn", configured: true, owner: "omp-native" },
    ]);
    expect(projection).not.toHaveProperty("captureComplete");
    expect(projection).not.toHaveProperty("launchRunning");
  });

  it("does not project policy for other providers", () => {
    expect(
      projectOmpProviderPolicy({
        provider: "codex",
        available: true,
        status: "ready",
        message: "ready",
        checkedAt: "2026-08-14T00:00:00.000Z",
      }),
    ).toBeUndefined();
  });

  it("exposes negotiated typed runtime state without treating policy as live state", () => {
    const status = {
      provider: "omp",
      available: true,
      status: "ready",
      message: "ready",
      checkedAt: "2026-08-14T00:00:00.000Z",
      ompPolicy: {
        owner: "omp-native",
        overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
        sharedHome: true,
        launch: { configured: true, observability: "acp-tool-activity-only" },
        advisor: { configured: true, state: "configured", observability: "transcript-only" },
        memory: { backend: "local", source: "user-config", observability: "ordinary-tools-only" },
        autoLearn: { configured: true, autoContinue: true, experimental: true, observability: "bounded-settle-only" },
        typedObservability: "phase-3-required",
        runtime: {
          mode: "typed",
          sessionCount: 1,
          ompVersion: "17.3.3",
          advisor: { enabled: true, active: true, toolRisk: "write-or-exec", grantedTools: ["bash"], inFlight: false, status: {} },
          autolearn: { enabled: true, autoContinue: true, state: "idle", captureGeneration: 3, pending: false },
          memory: { backend: "local", active: true, writable: true, searchable: true, scope: "isolated" },
          launch: { authority: "omp", services: [] },
        },
      },
    } satisfies ServerProviderStatus;

    const projection = projectOmpProviderPolicy(status);
    expect(projection?.typedObservabilityPending).toBe(false);
    expect(projection?.runtime).toMatchObject({
      mode: "typed",
      ompVersion: "17.3.3",
      advisor: { toolRisk: "write-or-exec" },
      memory: { scope: "isolated" },
      launch: { authority: "omp" },
    });
  });
});
