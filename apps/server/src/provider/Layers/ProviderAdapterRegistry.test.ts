import type { ProviderKind } from "@synara/contracts";
import { expect } from "vitest";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { AntigravityAdapter, AntigravityAdapterShape } from "../Services/AntigravityAdapter.ts";
import { ClaudeAdapter, ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter, CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { CursorAdapter, CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { DevinAdapter, DevinAdapterShape } from "../Services/DevinAdapter.ts";
import { DroidAdapter, DroidAdapterShape } from "../Services/DroidAdapter.ts";
import { GrokAdapter, GrokAdapterShape } from "../Services/GrokAdapter.ts";
import { OpenCodeAdapter, OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import { OhMyPiAdapter, OhMyPiAdapterShape } from "../Services/OhMyPiAdapter.ts";
import { PiAdapter, PiAdapterShape } from "../Services/PiAdapter.ts";
import { OmpAdapter, OmpAdapterShape } from "../Services/OmpAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  makeProviderAdapterRegistryLive,
  ProviderAdapterRegistryLive,
} from "./ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SERVER_DESKTOP_FLAVOR } from "../../betaFeatureGate.ts";

const fakeCodexAdapter: CodexAdapterShape = {
  provider: "codex",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: "claudeAgent",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  steerTurn: vi.fn(),
  interruptTurn: vi.fn(),
  stopTask: vi.fn(),
  backgroundTask: vi.fn(),
  steerSubagent: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: CursorAdapterShape = {
  provider: "cursor",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeGrokAdapter: GrokAdapterShape = {
  provider: "grok",
  capabilities: { sessionModelSwitch: "restart-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeDroidAdapter: DroidAdapterShape = {
  provider: "droid",
  capabilities: { sessionModelSwitch: "restart-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: "opencode",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakePiAdapter: PiAdapterShape = {
  provider: "pi",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeDevinAdapter: DevinAdapterShape = {
  provider: "devin",
  capabilities: { sessionModelSwitch: "restart-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};
const fakeOhMyPiAdapter: OhMyPiAdapterShape = {
  ...fakePiAdapter,
  provider: "omp",
};
const fakeOmpAdapter: OmpAdapterShape = {
  ...fakePiAdapter,
  provider: "omp",
  capabilities: { sessionModelSwitch: "restart-session" },
};

const fakeAntigravityAdapter: AntigravityAdapterShape = {
  provider: "antigravity",
  capabilities: { sessionModelSwitch: "restart-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const registryLayer = (
  codexAdapter = fakeCodexAdapter,
  flavor: typeof SERVER_DESKTOP_FLAVOR = SERVER_DESKTOP_FLAVOR,
) =>
  Layer.mergeAll(
    Layer.provide(
      flavor === SERVER_DESKTOP_FLAVOR
        ? ProviderAdapterRegistryLive
        : makeProviderAdapterRegistryLive(flavor),
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, codexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
        Layer.succeed(DevinAdapter, fakeDevinAdapter),
        Layer.succeed(AntigravityAdapter, fakeAntigravityAdapter),
        Layer.succeed(GrokAdapter, fakeGrokAdapter),
        Layer.succeed(DroidAdapter, fakeDroidAdapter),
        Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
        Layer.succeed(OhMyPiAdapter, fakeOhMyPiAdapter),
        Layer.succeed(OmpAdapter, fakeOmpAdapter),
        Layer.succeed(PiAdapter, fakePiAdapter),
      ),
    ),
    NodeServices.layer,
  );

const layer = it.layer(registryLayer());

for (const [flavor, expectedSwitch] of [
  ["production", "in-session"],
  ["development", "in-session"],
  ["unknown", "in-session"],
  ["canary", "in-session"],
  ["cua", "in-session"],
  ["beta", "restart-session"],
] as const) {
  it.effect(
    `${flavor} exposes exactly one OMP implementation with its own session semantics`,
    () =>
      Effect.gen(function* () {
        const registry = yield* ProviderAdapterRegistry;
        const omp = yield* registry.getByProvider("omp");
        assert.equal(omp.capabilities.sessionModelSwitch, expectedSwitch);
        assert.equal(
          (yield* registry.listProviders()).filter((provider) => provider === "omp").length,
          1,
        );
      }).pipe(Effect.provide(registryLayer(fakeCodexAdapter, flavor))),
  );
}

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByProvider("codex");
      const claude = yield* registry.getByProvider("claudeAgent");
      const cursor = yield* registry.getByProvider("cursor");
      const devin = yield* registry.getByProvider("devin");
      const antigravity = yield* registry.getByProvider("antigravity");
      const grok = yield* registry.getByProvider("grok");
      const droid = yield* registry.getByProvider("droid");
      const opencode = yield* registry.getByProvider("opencode");
      const omp = yield* registry.getByProvider("omp");
      const pi = yield* registry.getByProvider("pi");
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(cursor, fakeCursorAdapter);
      assert.equal(devin, fakeDevinAdapter);
      assert.equal(antigravity, fakeAntigravityAdapter);
      assert.equal(grok, fakeGrokAdapter);
      assert.equal(droid, fakeDroidAdapter);
      assert.equal(opencode, fakeOpenCodeAdapter);
      assert.equal(
        omp,
        SERVER_DESKTOP_FLAVOR === "beta" ? fakeOmpAdapter : fakeOhMyPiAdapter,
      );
      assert.equal(pi, fakePiAdapter);

      const providers = yield* registry.listProviders();
      assert.deepEqual(providers, [
        "codex",
        "claudeAgent",
        "cursor",
        "devin",
        "antigravity",
        "grok",
        "droid",
        "opencode",
        "omp",
        "pi",
      ]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry.getByProvider("unknown" as ProviderKind).pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});

it("rejects missing required methods while constructing the registry", async () => {
  const malformed = { ...fakeCodexAdapter };
  Reflect.deleteProperty(malformed, "stopAll");

  await expect(
    Effect.runPromise(Effect.provide(Effect.void, registryLayer(malformed))),
  ).rejects.toThrow("required method stopAll() is missing");
});

it("rejects duplicate provider identities while constructing the registry", async () => {
  const duplicate = { ...fakeCodexAdapter };
  Reflect.set(duplicate, "provider", "claudeAgent");

  await expect(
    Effect.runPromise(Effect.provide(Effect.void, registryLayer(duplicate))),
  ).rejects.toThrow("Duplicate provider adapter registrations: claudeAgent at index 1.");
});
