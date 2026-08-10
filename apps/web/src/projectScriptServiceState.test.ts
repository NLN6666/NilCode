import type { ProjectScript, ServerLocalServerProcess } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  findLocalServerForProjectScript,
  resolveRunningProjectScriptIds,
} from "./projectScriptServiceState";

const SERVICE: ProjectScript = {
  id: "erp-web",
  name: "erp-web",
  command: "dotnet run",
  icon: "play",
  runOnWorktreeCreate: false,
  port: 5299,
};

function localServer(
  overrides: Partial<Omit<ServerLocalServerProcess, "cwd">> = {},
  cwd: string | null = "D:/Codes/ERP/ERPC#/src/Erp.Web",
): ServerLocalServerProcess {
  return {
    id: "local-server:42:5299",
    pid: 42,
    ppid: 7,
    displayName: "dotnet",
    command: "dotnet",
    args: "run",
    ...(cwd === null ? {} : { cwd }),
    ports: [5299],
    addresses: [{ host: "127.0.0.1", port: 5299, family: "tcp4", url: "http://127.0.0.1:5299" }],
    pageTitle: "ERP",
    isStoppable: true,
    ...overrides,
  };
}

describe("resolveRunningProjectScriptIds", () => {
  it("reports a service from its listening port when terminal activity detection missed it", () => {
    expect(
      resolveRunningProjectScriptIds({
        scripts: [SERVICE],
        terminalRunningScriptIds: new Set(),
        launchedScriptIds: new Set([SERVICE.id]),
        localServers: [localServer({}, "D:/Synara/worktrees/erp-feature/src/Erp.Web")],
      }),
    ).toEqual(new Set(["erp-web"]));
  });

  it("keeps terminal-confirmed services and ignores another project's listener", () => {
    const scripts = [SERVICE, { ...SERVICE, id: "worker", port: 5300 }];

    expect(
      resolveRunningProjectScriptIds({
        scripts,
        terminalRunningScriptIds: new Set(["worker"]),
        launchedScriptIds: new Set(),
        localServers: [localServer({ ports: [5299] }, "D:/Codes/Other")],
      }),
    ).toEqual(new Set(["worker"]));
  });

  it("matches an exact port when the platform cannot resolve process cwd", () => {
    expect(
      resolveRunningProjectScriptIds({
        scripts: [SERVICE],
        terminalRunningScriptIds: new Set(),
        launchedScriptIds: new Set([SERVICE.id]),
        localServers: [localServer({}, null)],
      }),
    ).toEqual(new Set(["erp-web"]));
  });

  it("returns the detected process that can stop a service without terminal activity", () => {
    const server = localServer();

    expect(
      findLocalServerForProjectScript({
        script: SERVICE,
        localServers: [server],
        launchedScriptIds: new Set([SERVICE.id]),
      }),
    ).toBe(server);
  });

  it("does not claim a same-port process without this project's launch identity", () => {
    expect(
      resolveRunningProjectScriptIds({
        scripts: [SERVICE],
        terminalRunningScriptIds: new Set(),
        launchedScriptIds: new Set(),
        localServers: [localServer({}, null)],
      }),
    ).toEqual(new Set());
  });

  it("does not mark a second action that declares the same port as running", () => {
    const duplicatePortScript = { ...SERVICE, id: "erp-web-alternate" };

    expect(
      resolveRunningProjectScriptIds({
        scripts: [SERVICE, duplicatePortScript],
        terminalRunningScriptIds: new Set(),
        launchedScriptIds: new Set([SERVICE.id]),
        localServers: [localServer({}, null)],
      }),
    ).toEqual(new Set([SERVICE.id]));
  });
});
