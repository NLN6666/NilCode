import { describe, expect, it } from "vitest";

import {
  parsePosixIdentities,
  parseWindowsIdentities,
  processIdentityMatches,
  readProcessIdentities,
  resolveIdentityLiveness,
  type ProcessIdentity,
} from "./processIdentity";

const identity: ProcessIdentity = {
  pid: 4242,
  startedAt: "Thu Aug  7 10:00:00 2026",
  commandLine: "java -jar server.jar nogui",
};

describe("processIdentityMatches", () => {
  it("matches an identical identity", () => {
    expect(processIdentityMatches(identity, { ...identity })).toBe(true);
  });

  it("rejects a reused pid whose start time differs", () => {
    // The whole point: pid 4242 now belongs to something else.
    expect(
      processIdentityMatches(identity, { ...identity, startedAt: "Thu Aug  7 11:30:00 2026" }),
    ).toBe(false);
  });

  it("rejects a reused pid whose command line differs", () => {
    expect(processIdentityMatches(identity, { ...identity, commandLine: "notepad.exe" })).toBe(
      false,
    );
  });

  it("ignores command-line whitespace differences the platform introduces", () => {
    expect(
      processIdentityMatches(identity, {
        ...identity,
        commandLine: "java  -jar   server.jar nogui",
      }),
    ).toBe(true);
  });

  it("falls back to the command line when the platform reports no start time", () => {
    const withoutStart = { ...identity, startedAt: null };
    expect(processIdentityMatches(withoutStart, { ...withoutStart })).toBe(true);
    expect(
      processIdentityMatches(withoutStart, { ...withoutStart, commandLine: "notepad.exe" }),
    ).toBe(false);
  });
});

describe("resolveIdentityLiveness", () => {
  it("reports running when the current identity matches", () => {
    expect(resolveIdentityLiveness(identity, new Map([[4242, identity]]))).toBe("running");
  });

  it("reports exited when the pid is absent from the process table", () => {
    expect(resolveIdentityLiveness(identity, new Map())).toBe("exited");
  });

  it("reports exited when the pid was reused by something else", () => {
    const other = { ...identity, commandLine: "notepad.exe" };
    expect(resolveIdentityLiveness(identity, new Map([[4242, other]]))).toBe("exited");
  });

  it("reports unknown — never exited — when the process table could not be read", () => {
    // Treating a failed query as "exited" would have the agent relaunch a daemon that
    // is still running, putting two processes on one Minecraft world save.
    expect(resolveIdentityLiveness(identity, null)).toBe("unknown");
  });
});

describe("parsePosixIdentities", () => {
  it("parses pid, start time, and command from ps output", () => {
    const output = [
      " 4242 Thu Aug  7 10:00:00 2026 java -jar server.jar nogui",
      " 7 Thu Aug  7 09:00:00 2026 node index.js",
    ].join("\n");

    const parsed = parsePosixIdentities(output);

    expect(parsed.get(4242)).toEqual({
      pid: 4242,
      startedAt: "Thu Aug  7 10:00:00 2026",
      commandLine: "java -jar server.jar nogui",
    });
    expect(parsed.get(7)?.commandLine).toBe("node index.js");
  });

  it("skips malformed lines rather than failing the whole parse", () => {
    const parsed = parsePosixIdentities("garbage\n 4242 Thu Aug  7 10:00:00 2026 java -jar x");

    expect(parsed.size).toBe(1);
    expect(parsed.has(4242)).toBe(true);
  });
});

describe("parseWindowsIdentities", () => {
  it("parses the CIM JSON projection", () => {
    const json = JSON.stringify([
      {
        ProcessId: 4242,
        CreationDate: "/Date(1785060000000)/",
        CommandLine: "java -jar server.jar nogui",
      },
    ]);

    const parsed = parseWindowsIdentities(json);

    expect(parsed?.get(4242)).toEqual({
      pid: 4242,
      startedAt: "/Date(1785060000000)/",
      commandLine: "java -jar server.jar nogui",
    });
  });

  it("accepts a single object as well as an array", () => {
    // PowerShell's ConvertTo-Json emits a bare object for a one-element result.
    const json = JSON.stringify({
      ProcessId: 7,
      CreationDate: "/Date(1)/",
      CommandLine: "node index.js",
    });

    expect(parseWindowsIdentities(json)?.get(7)?.pid).toBe(7);
  });

  it("returns null for unparseable output so the caller reports unknown", () => {
    expect(parseWindowsIdentities("not json")).toBeNull();
  });

  it("tolerates a null command line", () => {
    // Real observed shape: protected system processes report CommandLine as null.
    const json = JSON.stringify([
      { ProcessId: 9, CreationDate: "/Date(1)/", CommandLine: null },
    ]);

    expect(parseWindowsIdentities(json)?.get(9)?.commandLine).toBe("");
  });
});

describe("readProcessIdentities (real platform query)", () => {
  // Parser tests alone would pass even if the platform command itself were wrong;
  // this one exercises the actual `ps` / CIM invocation on the host running the suite.
  it("finds this very process and reports a start time", () => {
    const identities = readProcessIdentities([globalThis.process.pid]);

    expect(identities).not.toBeNull();
    const self = identities?.get(globalThis.process.pid);
    expect(self?.pid).toBe(globalThis.process.pid);
    expect(self?.startedAt).toBeTruthy();
    expect(self?.commandLine.length).toBeGreaterThan(0);
  }, 20_000);

  it("reports an empty map, not null, when asked about nothing", () => {
    expect(readProcessIdentities([])?.size).toBe(0);
  });

  it("omits a pid that does not exist", () => {
    const identities = readProcessIdentities([globalThis.process.pid, 999_999_998]);

    expect(identities?.has(999_999_998)).toBe(false);
  }, 20_000);
});
