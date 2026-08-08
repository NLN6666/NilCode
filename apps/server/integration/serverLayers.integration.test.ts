// Builds the server's whole layer graph the way a real start does.
//
// This exists because of a start-up crash that shipped: `advisorReactorLayer`
// was never given `ServerSettingsLive`, and nothing caught it. `Layer.mergeAll`
// does not let siblings satisfy each other at runtime, but the composition in
// `main.ts` makes the missing requirement look satisfied to the compiler, and
// `index.ts` casts the remainder away. Typecheck stayed green; every start died
// with "Service not found".
//
// So the assertion here is deliberately shallow: building the graph at all is
// the test. Anything a layer forgets surfaces as a build failure.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BooleanFlagInput } from "@synara/shared/cli";
import { Effect, Option } from "effect";
import { afterEach, expect, it } from "vitest";

import { CliRuntimeLayer, LayerLive, type CliInput } from "../src/main.ts";
import { OrchestrationEngineService } from "../src/orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../src/provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";

const UNSET_FLAG: BooleanFlagInput = { positive: undefined, negative: undefined };

const createdHomeDirs: string[] = [];

function makeTemporaryHomeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "synara-layer-smoke-"));
  createdHomeDirs.push(dir);
  return dir;
}

/** A start with no flags set, pointed at a throwaway home directory. */
function makeCliInput(homeDir: string): CliInput {
  return {
    mode: Option.some("web"),
    port: Option.none(),
    host: Option.none(),
    synaraHome: Option.some(homeDir),
    devUrl: Option.none(),
    publicUrl: Option.none(),
    allowInsecureRemote: UNSET_FLAG,
    noBrowser: { positive: true, negative: undefined },
    authToken: Option.none(),
    autoBootstrapProjectFromCwd: UNSET_FLAG,
    logProviderEvents: UNSET_FLAG,
    logWebSocketEvents: UNSET_FLAG,
  };
}

afterEach(() => {
  while (createdHomeDirs.length > 0) {
    const dir = createdHomeDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

it("builds every layer a server start needs", async () => {
  const program = Effect.gen(function* () {
    // The services `makeServerProgram` reads straight after the layer is built.
    // A layer can build fine and still be missing from the output context, so
    // these are read rather than assumed.
    yield* ServerSettingsService;
    yield* OrchestrationEngineService;
    yield* ProjectionSnapshotQuery;
    yield* ProviderService;
    return "built" as const;
  }).pipe(
    Effect.scoped,
    // Same two-part composition the entry point uses: the handler's graph on
    // top, the CLI runtime it leans on underneath.
    Effect.provide(LayerLive(makeCliInput(makeTemporaryHomeDir()))),
    Effect.provide(CliRuntimeLayer),
  );

  await expect(Effect.runPromise(program)).resolves.toBe("built");
});
