import type { AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  acceptOmpExtensionEnvelope,
  createConfiguredOnlyOmpExtensionState,
  decodeOmpExtensionEnvelope,
  negotiateOmpExtensions,
  OMP_EXTENSION_EVENTS,
  OMP_EXTENSION_METHODS,
  projectOmpEnvelopeData,
  projectOmpExtensionRuntimeStatus,
  projectOmpLaunchLogs,
} from "./OmpExtensionProtocol";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    ompVersion: "17.3.3",
    sessionId: "omp-session",
    generation: "generation-a",
    sequence: 1,
    timestamp: "2026-08-14T00:00:00.000Z",
    data: { protocol: "omp-acp-extensions", supportedSchemaVersions: [1], features: {} },
    ...overrides,
  };
}

describe("OMP typed extension protocol", () => {
  it("decodes the versioned envelope and preserves additive data", () => {
    const decoded = decodeOmpExtensionEnvelope(envelope({ additiveFutureField: true }));

    expect(decoded.schemaVersion).toBe(1);
    expect(decoded.sessionId).toBe("omp-session");
    expect(decoded.data).toMatchObject({ protocol: "omp-acp-extensions" });
  });

  it("fails closed for unknown breaking versions and malformed sequences", () => {
    expect(() => decodeOmpExtensionEnvelope(envelope({ schemaVersion: 2 }))).toThrow(
      "unsupported schemaVersion",
    );
    expect(() => decodeOmpExtensionEnvelope(envelope({ sequence: -1 }))).toThrow("sequence");
    expect(() => decodeOmpExtensionEnvelope(envelope({ generation: "" }))).toThrow("generation");
    expect(
      decodeOmpExtensionEnvelope(
        envelope({
          data: undefined,
          error: {
            code: "TIMEOUT",
            message: "bounded operation timed out",
            recoverable: true,
            detail: { method: "_omp/advisor/drain" },
          },
        }),
      ).error,
    ).toMatchObject({ recoverable: true, detail: { method: "_omp/advisor/drain" } });
  });

  it("drops duplicate, stale-generation, and cross-session notifications", () => {
    const configuredOnly = createConfiguredOnlyOmpExtensionState("configured-policy-only");
    const negotiated = acceptOmpExtensionEnvelope(configuredOnly, decodeOmpExtensionEnvelope(envelope()));
    expect(negotiated.accepted).toBe(true);
    expect(negotiated.state.mode).toBe("typed");

    expect(
      acceptOmpExtensionEnvelope(negotiated.state, decodeOmpExtensionEnvelope(envelope())).reason,
    ).toBe("duplicate-sequence");
    expect(
      acceptOmpExtensionEnvelope(
        negotiated.state,
        decodeOmpExtensionEnvelope(envelope({ generation: "generation-b", sequence: 2 })),
      ).reason,
    ).toBe("stale-generation");
    expect(
      acceptOmpExtensionEnvelope(
        negotiated.state,
        decodeOmpExtensionEnvelope(envelope({ sessionId: "other", sequence: 2 })),
      ).reason,
    ).toBe("cross-session");
  });

  it("keeps methods and events in a provider-specific namespace", () => {
    expect(OMP_EXTENSION_METHODS.capabilities).toBe("_omp/capabilities");
    expect(OMP_EXTENSION_METHODS.memoryClear).toBe("_omp/memory/clear");
    expect(OMP_EXTENSION_EVENTS.advisorNote).toBe("_omp/advisor/note");
    expect(OMP_EXTENSION_EVENTS.launchLifecycle).toBe("_omp/launch/lifecycle");
  });

  it("negotiates capabilities and four real owner snapshots in sequence", async () => {
    let sequence = 0;
    const calls: string[] = [];
    const runtime = {
      request: (method: string) => {
        calls.push(method);
        sequence += 1;
        const feature = {
          available: true,
          enabled: true,
          observable: true,
          controllable: true,
          recoverable: true,
          methods: [],
          events: [],
        };
        const dataByMethod: Record<string, Record<string, unknown>> = {
          [OMP_EXTENSION_METHODS.capabilities]: {
            protocol: "omp-acp-extensions",
            supportedSchemaVersions: [1],
            selectedSchemaVersion: 1,
            features: {
              advisor: feature,
              autolearn: feature,
              memory: feature,
              launch: feature,
            },
          },
          [OMP_EXTENSION_METHODS.advisorStatus]: { enabled: true, active: true },
          [OMP_EXTENSION_METHODS.autolearnStatus]: {
            enabled: true,
            autoContinue: true,
            state: "idle",
            captureGeneration: 0,
            pending: false,
          },
          [OMP_EXTENSION_METHODS.memoryStatus]: {
            backend: "local",
            active: true,
            writable: true,
            searchable: true,
          },
          [OMP_EXTENSION_METHODS.launchList]: { authority: "omp", services: [] },
        };
        return Effect.succeed(
          envelope({ sequence, data: dataByMethod[method] ?? { unexpected: true } }),
        );
      },
    } as unknown as Pick<AcpSessionRuntimeShape, "request">;

    const state = await Effect.runPromise(
      negotiateOmpExtensions(runtime, { sessionId: "omp-session", timeoutMs: 100 }),
    );

    expect(calls).toEqual([
      OMP_EXTENSION_METHODS.capabilities,
      OMP_EXTENSION_METHODS.advisorStatus,
      OMP_EXTENSION_METHODS.autolearnStatus,
      OMP_EXTENSION_METHODS.memoryStatus,
      OMP_EXTENSION_METHODS.launchList,
    ]);
    expect(state).toMatchObject({
      mode: "typed",
      lastSequence: 5,
      advisor: { active: true },
      autolearn: { state: "idle" },
      memory: { backend: "local" },
      launch: { authority: "omp" },
    });
  });

  it("degrades method-not-found to configured-only without failing ordinary ACP", async () => {
    const runtime = {
      request: () => Effect.fail(new Error("Method not found")),
    } as unknown as Pick<AcpSessionRuntimeShape, "request">;

    const state = await Effect.runPromise(
      negotiateOmpExtensions(runtime, { sessionId: "omp-session", timeoutMs: 100 }),
    );

    expect(state.mode).toBe("configured-only");
    expect(state.degradedReason).toContain("Method not found");
  });

  it("degrades malformed typed capabilities instead of exposing guessed runtime state", async () => {
    const runtime = {
      request: () => Effect.succeed(envelope({ data: { protocol: "omp-acp-extensions" } })),
    } as unknown as Pick<AcpSessionRuntimeShape, "request">;

    const state = await Effect.runPromise(
      negotiateOmpExtensions(runtime, { sessionId: "omp-session", timeoutMs: 100 }),
    );

    expect(state.mode).toBe("configured-only");
    expect(state.degradedReason).toContain("schema v1");
  });

  it("keeps Advisor status while projecting notes and upserts Launch lifecycle state", () => {
    const configured = createConfiguredOnlyOmpExtensionState("negotiating");
    const advisor = projectOmpEnvelopeData(
      configured,
      OMP_EXTENSION_METHODS.advisorStatus,
      decodeOmpExtensionEnvelope(envelope({ data: { enabled: true, active: true } })),
    );
    const note = projectOmpEnvelopeData(
      advisor,
      OMP_EXTENSION_EVENTS.advisorNote,
      decodeOmpExtensionEnvelope(
        envelope({ sequence: 2, data: { advisorId: "security", severity: "concern", content: "note" } }),
      ),
    );
    const launched = projectOmpEnvelopeData(
      note,
      OMP_EXTENSION_EVENTS.launchLifecycle,
      decodeOmpExtensionEnvelope(
        envelope({
          sequence: 3,
          data: {
            event: "restart",
            service: {
              serviceId: "service-1",
              name: "fixture",
              state: "ready",
              restartCount: 1,
              outputBytes: 12,
              owner: "omp-session",
              persist: false,
              detached: false,
            },
          },
        }),
      ),
    );
    expect(note.advisor).toEqual({ enabled: true, active: true });
    expect(projectOmpExtensionRuntimeStatus(launched, 1).launch).toMatchObject({
      authority: "omp",
      services: [{ serviceId: "service-1", restartCount: 1 }],
    });
  });

  it("rejects malformed Launch log payloads at the server projection seam", () => {
    expect(
      projectOmpLaunchLogs({ text: "ready", cursor: 12, state: "ready", timedOut: false }),
    ).toEqual({ content: "ready", nextCursor: 12, state: "ready", timedOut: false });
    expect(projectOmpLaunchLogs({ text: "ready", cursor: -1, state: "ready", timedOut: false })).toBeUndefined();
  });
});
