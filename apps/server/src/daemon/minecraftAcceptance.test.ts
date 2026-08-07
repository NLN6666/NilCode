// Manual acceptance test for the daemon subsystem, driven through the real agent tool
// surface against a real Minecraft server.
//
// Skipped unless SYNARA_MC_SERVER_DIR and SYNARA_MC_JAR are set, because it starts a real
// server against a real world save and takes minutes:
//
//   SYNARA_MC_SERVER_DIR="D:/Minecraft/1Servers/Purpur1.21.11/server" \
//   SYNARA_MC_JAR="purpur-1.21.11-2568.jar" \
//   npx vitest run apps/server/src/daemon/minecraftAcceptance.test.ts
//
// The server is always shut down with its own `stop` command, never force-killed: the
// whole point of the supervised PTY mode is that a stateful server gets to save first.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { makeDaemonTools } from "../agentGateway/daemonTools";
import type { McpToolCallResult } from "../agentGateway/protocol";
import type { ToolContext, ToolEntry } from "../agentGateway/toolRuntime";
import { createBrokerCore, type BrokerCore } from "./brokerCore";
import { makeDaemonBroker } from "./Layers/Broker";
import { createDaemonLauncher } from "./launcher";
import { readProcessIdentities } from "./processIdentity";

const serverDir = process.env.SYNARA_MC_SERVER_DIR;
const serverJar = process.env.SYNARA_MC_JAR;
const enabled = Boolean(serverDir && serverJar);

const context = {} as ToolContext;
const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const run of cleanup.splice(0)) await run();
});

function makeSurface(rootDir: string): { core: BrokerCore; tools: ReadonlyArray<ToolEntry> } {
  const core = createBrokerCore({
    rootDir,
    launcher: createDaemonLauncher(),
    readIdentities: readProcessIdentities,
  });
  return { core, tools: makeDaemonTools({ broker: makeDaemonBroker(core) }) };
}

async function call(
  tools: ReadonlyArray<ToolEntry>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const entry = tools.find((candidate) => candidate.definition.name === name);
  if (entry === undefined) throw new Error(`no tool named ${name}`);
  const result: McpToolCallResult = await Effect.runPromise(entry.handler(args, context));
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  // Error results carry plain text, not JSON — parse second, or the real message is
  // lost behind a SyntaxError.
  if (result.isError) throw new Error(`${name} failed: ${first.text}`);
  return JSON.parse(first.text) as Record<string, unknown>;
}

/** The gateway caps one wait at 60s; a cold world needs several. This is the agent's loop. */
async function waitRepeatedly(
  tools: ReadonlyArray<ToolEntry>,
  args: Record<string, unknown>,
  attempts: number,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await call(tools, "synara_wait_daemon", { ...args, timeout: 60 });
    if (last.timedOut !== true) return last;
  }
  return last;
}

describe.skipIf(!enabled)("Minecraft acceptance", () => {
  it("starts, reports ready, answers a console command, and stops cleanly", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "synara-mc-accept-"));
    const { core, tools } = makeSurface(rootDir);
    cleanup.push(async () => {
      // Always leave via the server's own `stop`, including when an assertion above
      // failed partway through. Letting the test runner tear down a live server would
      // hard-kill it mid-chunk-write — the exact damage this design exists to avoid.
      try {
        if (core.describe("mc").state !== "exited") {
          await core.send({ name: "mc", text: "stop", enter: true, keys: [], signal: null });
          await core.wait({ name: "mc", for: "exit", pattern: null, timeoutMs: 120_000 });
        }
      } catch {
        // Already gone, or never started.
      }
      await core.dispose();
      await rm(rootDir, { recursive: true, force: true });
    });

    const started = await call(tools, "synara_start_daemon", {
      name: "mc",
      application: "java",
      args: ["-Xmx2G", "-jar", serverJar!, "nogui"],
      cwd: serverDir!,
      ready: { log: "Done \\(" },
    });
    expect(started.state).toBe("starting");
    expect(started.pid).toBeGreaterThan(0);

    const ready = await waitRepeatedly(tools, { name: "mc", for: "ready" }, 4);
    expect(ready.timedOut).toBe(false);
    expect((ready.snapshot as Record<string, unknown>).state).toBe("ready");

    const banner = await call(tools, "synara_read_daemon_logs", { name: "mc", lines: 40 });
    expect(String(banner.content)).toMatch(/Done \(/u);

    // A console command proves the PTY carries stdin — the capability detached mode
    // gives up, and the reason a stateful server must run supervised.
    await call(tools, "synara_send_daemon_input", { name: "mc", text: "list" });
    const listed = await waitRepeatedly(
      tools,
      { name: "mc", for: "exit", pattern: "players online" },
      1,
    );
    expect(listed.matched).toBe(true);

    await call(tools, "synara_send_daemon_input", { name: "mc", text: "stop" });
    const stopped = await waitRepeatedly(tools, { name: "mc", for: "exit" }, 3);
    expect(stopped.timedOut).toBe(false);

    const final = await call(tools, "synara_describe_daemon", { name: "mc" });
    expect(final.state).toBe("exited");

    // The server saved on its way out; a force-kill would have skipped this.
    const tail = await call(tools, "synara_read_daemon_logs", { name: "mc", lines: 60 });
    expect(String(tail.content)).toMatch(/Saving|Stopping server/u);
  }, 600_000);
});

describe("detached survival and reclaim", () => {
  // Uses a throwaway process rather than the Minecraft world: a detached daemon has no
  // stdin, so it could only be force-killed, which is exactly what a world save must not
  // suffer. Detached is for stateless services; stateful servers stay supervised.
  it("survives the broker that started it and is re-adopted by a fresh one", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "synara-detach-accept-"));
    const first = makeSurface(rootDir);

    const started = await call(first.tools, "synara_start_daemon", {
      name: "ticker",
      application: process.execPath,
      args: ["-e", "let n=0;setInterval(()=>{n+=1;process.stdout.write('tick '+n+'\\n')},200)"],
      detached: true,
    });
    const pid = started.pid as number;
    cleanup.push(async () => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      await rm(rootDir, { recursive: true, force: true });
    });

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    // Disposing the broker is what a server shutdown does; the child must not care.
    await first.core.dispose();
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const second = makeSurface(rootDir);
    const reclaimed = await Effect.runPromise(makeDaemonBroker(second.core).reclaimDetached);

    expect(reclaimed.map((entry) => entry.name)).toEqual(["ticker"]);
    expect(reclaimed[0]?.pid).toBe(pid);
    expect(reclaimed[0]?.state).toBe("running");

    const logs = await call(second.tools, "synara_read_daemon_logs", {
      name: "ticker",
      lines: 200,
    });
    // Output written while no broker was watching is still in the file.
    expect(String(logs.content)).toMatch(/tick \d+/u);

    await call(second.tools, "synara_stop_daemon", { name: "ticker", timeout: 5 });
    await second.core.dispose();
  }, 60_000);
});
