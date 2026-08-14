import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_MODEL_BY_PROVIDER, ServerSettings } from "@synara/contracts";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ServerConfig } from "./config";
import {
  migrateLegacyDisabledSkills,
  ServerSettingsLive,
  ServerSettingsService,
} from "./serverSettings";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-settings-test-",
}).pipe(Layer.provide(NodeServices.layer));
const makeTestLayer = Layer.merge(NodeServices.layer, serverConfigLayer);
const testLayer = Layer.merge(makeTestLayer, ServerSettingsLive.pipe(Layer.provide(makeTestLayer)));

const runWithSettings = <A, E>(
  effect: Effect.Effect<A, E, ServerSettingsService | ServerConfig | FileSystem.FileSystem>,
) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>);

describe("ServerSettingsService", () => {
  it("loads defaults when settings file does not exist", async () => {
    const settings = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        yield* service.start;
        return yield* service.getSettings;
      }),
    );

    expect(settings.providers.codex.binaryPath).toBe("codex");
    expect(settings.providers.grok.binaryPath).toBe("grok");
    expect(settings.providers.omp).toEqual({ enabled: true, binaryPath: "omp", customModels: [] });
    expect(settings.skills.disabled.omp).toEqual([]);
    expect(settings.defaultThreadEnvMode).toBe("local");
    expect(settings.enableProviderUpdateChecks).toBe(true);
  });

  it("persists updates and reloads them", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* service.start;

        const updated = yield* service.updateSettings({
          enableAssistantStreaming: true,
          enableProviderUpdateChecks: false,
          providers: {
            codex: {
              binaryPath: "/usr/local/bin/codex",
              customModels: ["gpt-custom"],
            },
          },
        });
        const raw = yield* fs.readFileString(settingsPath);
        return { updated, parsed: JSON.parse(raw) as unknown };
      }),
    );

    expect(result.updated.enableAssistantStreaming).toBe(true);
    expect(result.updated.enableProviderUpdateChecks).toBe(false);
    expect(result.updated.providers.codex.binaryPath).toBe("/usr/local/bin/codex");
    expect(result.parsed).toMatchObject({
      revision: 1,
      migrationVersion: 2,
      settings: {
        enableAssistantStreaming: true,
        enableProviderUpdateChecks: false,
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            customModels: ["gpt-custom"],
          },
        },
      },
    });
  });

  it("keeps provider passwords server-only and returns configured flags to clients", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* service.start;
        const view = yield* service.updateSettingsView({
          providers: {
            kilo: { serverPassword: "kilo-secret" },
            opencode: { serverPassword: "opencode-secret" },
          },
        });
        const internal = yield* service.getSettings;
        const persisted = yield* fs.readFileString(settingsPath);
        return { view, internal, persisted };
      }),
    );

    expect(result.internal.providers.kilo.serverPasswordConfigured).toBe(true);
    expect(result.internal.providers.opencode.serverPasswordConfigured).toBe(true);
    expect(result.view.providers.kilo).toMatchObject({ serverPasswordConfigured: true });
    expect(result.view.providers.opencode).toMatchObject({ serverPasswordConfigured: true });
    expect(JSON.stringify(result.internal)).not.toContain("kilo-secret");
    expect(JSON.stringify(result.internal)).not.toContain("opencode-secret");
    expect(JSON.stringify(result.view)).not.toContain("kilo-secret");
    expect(JSON.stringify(result.view)).not.toContain("opencode-secret");
    expect(JSON.stringify(result.view)).not.toContain('"serverPassword"');
    expect(result.persisted).not.toContain("kilo-secret");
    expect(result.persisted).not.toContain("opencode-secret");
  });

  it("resolves text generation selection away from disabled providers", async () => {
    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        return yield* service.getSettings;
      }).pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            textGenerationModelSelection: {
              provider: "antigravity",
              model: DEFAULT_MODEL_BY_PROVIDER.antigravity,
            },
            providers: {
              antigravity: { enabled: false },
            },
          }),
        ),
      ),
    );

    expect(settings.textGenerationModelSelection.provider).toBe("codex");
    expect(settings.textGenerationModelSelection.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });
});

describe("migrateLegacyDisabledSkills", () => {
  it("fans a legacy flat opt-out list out to every provider", () => {
    const migrated = migrateLegacyDisabledSkills({
      skills: { disabled: ["muted"] },
    }) as { skills: { disabled: Record<string, readonly string[]> } };

    expect(migrated.skills.disabled.codex).toEqual(["muted"]);
    expect(migrated.skills.disabled.claudeAgent).toEqual(["muted"]);
    expect(migrated.skills.disabled.omp).toEqual(["muted"]);
    expect(Object.keys(migrated.skills.disabled)).toHaveLength(10);
  });

  it("leaves an already per-provider map untouched", () => {
    const settings = { skills: { disabled: { codex: ["muted"] } } };

    expect(migrateLegacyDisabledSkills(settings)).toBe(settings);
  });

  it("leaves settings without a skills key untouched", () => {
    const settings = { enableAssistantStreaming: true };

    expect(migrateLegacyDisabledSkills(settings)).toBe(settings);
  });

  // The loader quarantines a settings file it cannot decode and falls back to defaults, so a
  // legacy shape reaching the schema would silently reset every unrelated setting on upgrade.
  it("keeps a legacy settings file decodable instead of quarantining it", () => {
    const legacy = {
      enableProviderUpdateChecks: false,
      skills: { disabled: ["muted"] },
    };

    expect(Schema.decodeUnknownExit(ServerSettings)(legacy)._tag).toBe("Failure");

    const decoded = Schema.decodeUnknownExit(ServerSettings)(migrateLegacyDisabledSkills(legacy));
    expect(decoded._tag).toBe("Success");
    if (decoded._tag === "Success") {
      expect(decoded.value.enableProviderUpdateChecks).toBe(false);
      expect(decoded.value.skills.disabled.grok).toEqual(["muted"]);
      expect(decoded.value.providers.omp).toEqual({
        enabled: true,
        binaryPath: "omp",
        customModels: [],
      });
      expect(decoded.value.skills.disabled.omp).toEqual(["muted"]);
    }
  });
});
