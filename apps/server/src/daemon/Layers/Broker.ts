// FILE: Broker.ts
// Purpose: Effect layer binding the daemon state machine to a real launcher and the
//          server's private state directory.
// Layer: Daemon service implementation
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.

import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { createBrokerCore, DaemonNotFoundError, type BrokerCore } from "../brokerCore.ts";
import { createDaemonLauncher } from "../launcher.ts";
import { readProcessIdentities } from "../processIdentity.ts";
import { DaemonBroker, DaemonError, type DaemonBrokerShape } from "../Services/Broker.ts";

/**
 * Map a rejection onto the typed error the tool surface reports.
 *
 * The name lookup gets its own code because it is the one failure an agent can act on
 * directly — everything else is a runtime fault it can only report.
 */
function toDaemonError(error: unknown): DaemonError {
  if (error instanceof DaemonNotFoundError) {
    return new DaemonError({ code: "daemon_not_found", message: error.message });
  }
  return new DaemonError({
    code: "daemon_failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

function attempt<A>(run: () => Promise<A> | A): Effect.Effect<A, DaemonError> {
  return Effect.tryPromise({ try: async () => run(), catch: toDaemonError });
}

export function makeDaemonBroker(core: BrokerCore): DaemonBrokerShape {
  return {
    start: (spec) => attempt(() => core.start(spec)),
    list: attempt(() => core.list()).pipe(Effect.orElseSucceed(() => [])),
    describe: (name) => attempt(() => core.describe(name)),
    logs: (input) => attempt(() => core.logs(input)),
    send: (input) => attempt(() => core.send(input)),
    wait: (input) => attempt(() => core.wait(input)),
    stop: (input) => attempt(() => core.stop(input)),
    restart: (name) => attempt(() => core.restart(name)),
    // Reclaim runs at startup, where nothing can act on a failure: a broker that
    // refused to come up because one stale record was unreadable would cost the agent
    // every other daemon too.
    reclaimDetached: attempt(() => core.reclaimDetached()).pipe(Effect.orElseSucceed(() => [])),
    dispose: attempt(() => core.dispose()).pipe(Effect.orElseSucceed(() => undefined)),
  };
}

export const DaemonBrokerLive = Layer.effect(
  DaemonBroker,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const core = createBrokerCore({
      // Daemon logs can hold whatever a server prints, so they live in the private
      // 0700 state tree beside the other per-installation runtime data.
      rootDir: config.stateDir,
      launcher: createDaemonLauncher(),
      readIdentities: readProcessIdentities,
    });
    const broker = makeDaemonBroker(core);
    yield* broker.reclaimDetached;
    return broker;
  }),
);
