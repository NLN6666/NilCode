import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";

import { CliRuntimeLayer, synaraCli } from "./main";
import { Command } from "effect/unstable/cli";
import { version } from "../package.json" with { type: "json" };
import { exitOnceDrained } from "./shutdownExit";
import { consumeDesktopParentInput, withDesktopParentLifetime } from "./desktopParentLifetime";

const desktopParentInput = consumeDesktopParentInput(process.env, () => process.stdin);

/** Keeps the standard exit-code convention and only adds the bounded exit. */
const teardown: Runtime.Teardown = (exit, onExit) =>
  Runtime.defaultTeardown(exit, (code) => {
    exitOnceDrained(code);
    onExit(code);
  });

Command.run(synaraCli, { version })
  .pipe(Effect.provide(CliRuntimeLayer))
  .pipe((program) => withDesktopParentLifetime(program, desktopParentInput))
  .pipe((program) =>
    NodeRuntime.runMain(program as Effect.Effect<void, unknown, never>, { teardown }),
  );
