// FILE: localServerMonitorWindows.test.ts
// Purpose: Locks down parsing of the Windows PowerShell snapshot into listener rows
//          and the pid -> process info map the monitor builds server rows from.
// Layer: Server runtime utility tests

import { describe, expect, it } from "vitest";

import { buildLocalServerProcesses } from "./localServerMonitor";
import { parseWindowsLocalServerSnapshot } from "./localServerMonitorWindows";

// Shape of a real `dotnet run` tree: the launched app owns the port, while the
// `dotnet run` command line that identifies it lives on the parent.
const DOTNET_SNAPSHOT = JSON.stringify({
  listeners: [
    { LocalAddress: "0.0.0.0", LocalPort: 5299, OwningProcess: 1234 },
    { LocalAddress: "::", LocalPort: 5299, OwningProcess: 1234 },
  ],
  processes: [
    {
      ProcessId: 1234,
      ParentProcessId: 900,
      Name: "Erp.Web.exe",
      CommandLine: String.raw`"D:\Codes\ERP\ERPC#\src\Erp.Web\bin\Debug\net8.0\Erp.Web.exe"`,
    },
    {
      ProcessId: 900,
      ParentProcessId: 800,
      Name: "dotnet.exe",
      CommandLine: String.raw`"C:\Program Files\dotnet\dotnet.exe" run --project src\Erp.Web`,
    },
  ],
});

describe("parseWindowsLocalServerSnapshot", () => {
  it("turns listening sockets into one listener row per address", () => {
    const { listeners } = parseWindowsLocalServerSnapshot(DOTNET_SNAPSHOT);

    expect(listeners).toEqual([
      {
        pid: 1234,
        command: "Erp.Web.exe",
        protocol: "tcp",
        host: "0.0.0.0",
        port: 5299,
        family: "tcp4",
      },
      {
        pid: 1234,
        command: "Erp.Web.exe",
        protocol: "tcp",
        host: "::",
        port: 5299,
        family: "tcp6",
      },
    ]);
  });

  it("maps the process table by pid, keeping the parent link", () => {
    const { processInfoByPid } = parseWindowsLocalServerSnapshot(DOTNET_SNAPSHOT);

    expect(processInfoByPid.get(1234)).toEqual({
      ppid: 900,
      commandLine: String.raw`"D:\Codes\ERP\ERPC#\src\Erp.Web\bin\Debug\net8.0\Erp.Web.exe"`,
    });
    expect(processInfoByPid.get(900)?.ppid).toBe(800);
  });

  // Get-NetTCPConnection has no process name; it is recovered from the CIM table
  // so a row still reads as a program rather than as a bare pid.
  it("names the listener from the process table", () => {
    const { listeners } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: [{ LocalAddress: "127.0.0.1", LocalPort: 3000, OwningProcess: 42 }],
        processes: [
          { ProcessId: 42, ParentProcessId: 1, Name: "node.exe", CommandLine: "node dev.js" },
        ],
      }),
    );

    expect(listeners[0]?.command).toBe("node.exe");
  });

  it("falls back to a placeholder name when the process is not in the table", () => {
    const { listeners } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: [{ LocalAddress: "127.0.0.1", LocalPort: 3000, OwningProcess: 42 }],
        processes: [],
      }),
    );

    expect(listeners[0]?.command).toBe("unknown");
  });

  // ConvertTo-Json collapses a single-element result to a bare object.
  it("accepts a single record that PowerShell did not wrap in an array", () => {
    const { listeners, processInfoByPid } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: { LocalAddress: "127.0.0.1", LocalPort: 8080, OwningProcess: 7 },
        processes: {
          ProcessId: 7,
          ParentProcessId: 1,
          Name: "python.exe",
          CommandLine: "python -m http.server",
        },
      }),
    );

    expect(listeners).toHaveLength(1);
    expect(processInfoByPid.size).toBe(1);
  });

  it("drops rows with a port or pid outside the valid range", () => {
    const { listeners } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: [
          { LocalAddress: "127.0.0.1", LocalPort: 0, OwningProcess: 42 },
          { LocalAddress: "127.0.0.1", LocalPort: 70_000, OwningProcess: 42 },
          { LocalAddress: "127.0.0.1", LocalPort: 3000, OwningProcess: 0 },
          { LocalAddress: "127.0.0.1", LocalPort: 3000, OwningProcess: 42 },
        ],
        processes: [],
      }),
    );

    expect(listeners.map((listener) => listener.port)).toEqual([3000]);
  });

  it("omits a process whose command line Windows would not disclose", () => {
    const { processInfoByPid } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: [],
        processes: [{ ProcessId: 4, ParentProcessId: 0, Name: "System", CommandLine: null }],
      }),
    );

    expect(processInfoByPid.get(4)).toEqual({ ppid: 0, commandLine: "" });
  });

  it.each(["", "   ", "not json", "null", "[]"])("returns empty tables for %o", (output) => {
    const snapshot = parseWindowsLocalServerSnapshot(output);

    expect(snapshot.listeners).toEqual([]);
    expect(snapshot.processInfoByPid.size).toBe(0);
  });
});

// The regression this whole module exists for: on Windows the panel reported
// "no servers running" while an ASP.NET app was listening on 5299.
describe("Windows snapshot feeding the server rows", () => {
  it("recognizes a dotnet run tree as one dev server", () => {
    const { listeners, processInfoByPid } = parseWindowsLocalServerSnapshot(DOTNET_SNAPSHOT);

    const servers = buildLocalServerProcesses(listeners, processInfoByPid, new Map());

    expect(servers).toHaveLength(1);
    expect(servers[0]?.pid).toBe(1234);
    // The parent link is what lets detection read `dotnet run` off the ancestor
    // and what attributes the listener back to a tracked project run.
    expect(servers[0]?.ppid).toBe(900);
    expect(servers[0]?.ports).toEqual([5299]);
    expect(servers[0]?.displayName).toBe("Dotnet");
  });

  // Detection keys on the command line, which lives on the parent: the launched
  // app's own command line says nothing about being a dev server.
  it("finds nothing when the parent process is missing from the table", () => {
    const { listeners, processInfoByPid } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: [{ LocalAddress: "0.0.0.0", LocalPort: 5299, OwningProcess: 1234 }],
        processes: [
          {
            ProcessId: 1234,
            ParentProcessId: 900,
            Name: "Erp.Web.exe",
            CommandLine: String.raw`"D:\Codes\ERP\src\Erp.Web\bin\Debug\net8.0\Erp.Web.exe"`,
          },
        ],
      }),
    );

    expect(buildLocalServerProcesses(listeners, processInfoByPid, new Map())).toEqual([]);
  });

  it("reads a vite dev server started from a Windows shell", () => {
    const { listeners, processInfoByPid } = parseWindowsLocalServerSnapshot(
      JSON.stringify({
        listeners: [{ LocalAddress: "127.0.0.1", LocalPort: 5173, OwningProcess: 4242 }],
        processes: [
          {
            ProcessId: 4242,
            ParentProcessId: 1,
            Name: "node.exe",
            CommandLine: String.raw`"C:\Program Files\nodejs\node.exe" node_modules\vite\bin\vite.js`,
          },
        ],
      }),
    );

    const servers = buildLocalServerProcesses(listeners, processInfoByPid, new Map());

    expect(servers[0]?.displayName).toBe("Vite");
    expect(servers[0]?.ports).toEqual([5173]);
  });
});
