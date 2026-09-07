import type { ProjectScript, ServerLocalServerProcess } from "@synara/contracts";

function localServerListensOnPort(server: ServerLocalServerProcess, port: number): boolean {
  return server.ports.includes(port) || server.addresses.some((address) => address.port === port);
}

export function localServerMatchesProjectScript(input: {
  readonly server: ServerLocalServerProcess;
  readonly script: ProjectScript;
  readonly launchedScriptIds: ReadonlySet<string>;
}): boolean {
  const port = input.script.port;
  return (
    port !== null &&
    port !== undefined &&
    input.launchedScriptIds.has(input.script.id) &&
    localServerListensOnPort(input.server, port)
  );
}

export function findLocalServerForProjectScript(input: {
  readonly script: ProjectScript;
  readonly localServers: readonly ServerLocalServerProcess[];
  readonly launchedScriptIds: ReadonlySet<string>;
}): ServerLocalServerProcess | null {
  return (
    input.localServers.find((server) =>
      localServerMatchesProjectScript({
        server,
        script: input.script,
        launchedScriptIds: input.launchedScriptIds,
      }),
    ) ?? null
  );
}

export function resolveRunningProjectScriptIds(input: {
  readonly scripts: readonly ProjectScript[];
  readonly terminalRunningScriptIds: ReadonlySet<string>;
  readonly launchedScriptIds: ReadonlySet<string>;
  readonly localServers: readonly ServerLocalServerProcess[];
}): ReadonlySet<string> {
  const running = new Set(input.terminalRunningScriptIds);
  for (const script of input.scripts) {
    if (findLocalServerForProjectScript({ ...input, script }) !== null) {
      running.add(script.id);
    }
  }
  return running;
}
