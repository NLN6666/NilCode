import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { OmpProviderPolicyStatus, ServerProviderStatus } from "./server";

describe("OMP provider policy status", () => {
  it("round-trips configured ownership without claiming typed feature state", () => {
    const policy = Schema.decodeUnknownSync(OmpProviderPolicyStatus)({
      owner: "omp-native",
      overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
      sharedHome: true,
      launch: { configured: true, observability: "acp-tool-activity-only" },
      advisor: {
        configured: true,
        state: "degraded",
        warning: "Configure modelRoles.advisor before starting an OMP session.",
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
    });

    const status = Schema.decodeUnknownSync(ServerProviderStatus)({
      provider: "omp",
      status: "warning",
      available: true,
      authStatus: "unknown",
      checkedAt: "2026-08-14T00:00:00.000Z",
      ompPolicy: policy,
    });

    expect(status.ompPolicy).toEqual(policy);
    expect(status.ompPolicy).not.toHaveProperty("launch.running");
    expect(status.ompPolicy).not.toHaveProperty("autoLearn.captureComplete");
  });

  it("round-trips typed effective, observable, controllable, and recoverable OMP state", () => {
    const policy = Schema.decodeUnknownSync(OmpProviderPolicyStatus)({
      owner: "omp-native",
      overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
      sharedHome: true,
      launch: { configured: true, observability: "acp-tool-activity-only" },
      advisor: { configured: true, state: "configured", observability: "transcript-only" },
      memory: { backend: "local", source: "user-config", observability: "ordinary-tools-only" },
      autoLearn: {
        configured: true,
        autoContinue: true,
        experimental: true,
        observability: "bounded-settle-only",
      },
      typedObservability: "phase-3-required",
      runtime: {
        mode: "typed",
        sessionCount: 1,
        ompVersion: "17.3.3",
        features: {
          launch: {
            available: true,
            enabled: true,
            observable: true,
            controllable: true,
            recoverable: true,
            methods: ["_omp/launch/list", "_omp/launch/stop"],
            events: ["_omp/launch/lifecycle"],
          },
        },
        launch: {
          authority: "omp",
          services: [
            {
              serviceId: "service-1",
              name: "fixture",
              state: "ready",
              restartCount: 0,
              outputBytes: 12,
              owner: "omp-session-1",
              persist: false,
              detached: false,
            },
          ],
        },
      },
    });
    expect(policy.runtime?.mode).toBe("typed");
    expect(policy.runtime?.features?.launch?.controllable).toBe(true);
    expect(policy.runtime?.launch?.authority).toBe("omp");
  });
});
