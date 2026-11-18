import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  COMPOSER_PREDICTION_MAX_CHARS,
  ServerGenerateComposerPredictionResult,
  ServerGetEnvironmentResult,
  OmpProviderPolicyStatus,
  ServerProviderStatus,
} from "./server";

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

const decodeServerProviderStatus = Schema.decodeUnknownSync(ServerProviderStatus);
const decodeServerEnvironment = Schema.decodeUnknownSync(ServerGetEnvironmentResult);

describe("ServerProviderStatus", () => {
  it("promotes legacy provider-only snapshots to the default provider instance", () => {
    const parsed = decodeServerProviderStatus({
      provider: "codex",
      status: "ready",
      available: true,
      authStatus: "authenticated",
      checkedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.provider).toBe("codex");
    expect(parsed.driver).toBe("codex");
    expect(parsed.instanceId).toBe("codex");
  });

  it("preserves exact instance identity for same-driver provider snapshots", () => {
    const parsed = decodeServerProviderStatus({
      provider: "claudeAgent",
      driver: "claudeAgent",
      instanceId: "claude_work",
      displayName: "Claude Work",
      status: "ready",
      available: true,
      authStatus: "authenticated",
      checkedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.provider).toBe("claudeAgent");
    expect(parsed.driver).toBe("claudeAgent");
    expect(parsed.instanceId).toBe("claude_work");
    expect(parsed.displayName).toBe("Claude Work");
  });
});

describe("ServerGetEnvironmentResult", () => {
  it("decodes the composer predictions capability from older and newer servers", () => {
    const descriptor = {
      environmentId: "environment-1",
      label: "Mini",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "1.5.0",
      capabilities: { repositoryIdentity: true },
    };
    const withCapability = (composerPredictions: boolean) =>
      decodeServerEnvironment({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, composerPredictions },
      }).capabilities.composerPredictions;

    expect(decodeServerEnvironment(descriptor).capabilities.composerPredictions).toBeUndefined();
    expect(withCapability(true)).toBe(true);
    expect(withCapability(false)).toBe(false);
  });
});

describe("ServerGenerateComposerPredictionResult", () => {
  const decode = Schema.decodeUnknownSync(ServerGenerateComposerPredictionResult);

  it("accepts a suggestion of up to about three sentences and no longer", () => {
    const longest = "a".repeat(COMPOSER_PREDICTION_MAX_CHARS);

    expect(COMPOSER_PREDICTION_MAX_CHARS).toBe(320);
    expect(decode({ suggestion: longest })).toEqual({ suggestion: longest });
    expect(decode({ suggestion: null })).toEqual({ suggestion: null });
    expect(() => decode({ suggestion: `${longest}a` })).toThrow();
  });

  it("carries an optional outcome and still reads results from servers without one", () => {
    expect(decode({ suggestion: "Ship it", outcome: "suggested" })).toEqual({
      suggestion: "Ship it",
      outcome: "suggested",
    });
    expect(decode({ suggestion: null, outcome: "none" })).toEqual({
      suggestion: null,
      outcome: "none",
    });
    expect(decode({ suggestion: null, outcome: "unavailable" })).toEqual({
      suggestion: null,
      outcome: "unavailable",
    });
    expect(decode({ suggestion: null, outcome: "generation-unavailable" })).toEqual({
      suggestion: null,
      outcome: "generation-unavailable",
    });
    expect(decode({ suggestion: null })).toEqual({ suggestion: null });
    expect("outcome" in decode({ suggestion: null })).toBe(false);
    expect(() => decode({ suggestion: null, outcome: "maybe" })).toThrow();
  });
});

describe("ServerProviderStatus account identity", () => {
  it("keeps the signed-in email and organization a status reports", () => {
    const parsed = decodeServerProviderStatus({
      provider: "claudeAgent",
      driver: "claudeAgent",
      instanceId: "claude_work",
      status: "ready",
      available: true,
      authStatus: "authenticated",
      accountEmail: "work@example.com",
      accountOrganization: "Example Org",
      checkedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.accountEmail).toBe("work@example.com");
    expect(parsed.accountOrganization).toBe("Example Org");
  });
});
