import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";

import { CliConfig, synaraCli } from "./main";
import { OpenLive } from "./open";
import { Command } from "effect/unstable/cli";
import { version } from "../package.json" with { type: "json" };
import { ServerLive } from "./effectServer";
import { exitOnceDrained } from "./shutdownExit";
import { NetService } from "@synara/shared/Net";
import { FetchHttpClient } from "effect/unstable/http";

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

/** Keeps the standard exit-code convention and only adds the bounded exit. */
const teardown: Runtime.Teardown = (exit, onExit) =>
  Runtime.defaultTeardown(exit, (code) => {
    exitOnceDrained(code);
    onExit(code);
  });

Command.run(synaraCli, { version })
  .pipe(Effect.provide(RuntimeLayer))
  .pipe((program) =>
    NodeRuntime.runMain(program as Effect.Effect<void, unknown, never>, { teardown }),
  );
