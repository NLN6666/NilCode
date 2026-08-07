import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { connectPort, createReadinessTracker, READINESS_BUFFER_BYTES } from "./readiness";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("createReadinessTracker", () => {
  it("is ready immediately when no conditions are declared", () => {
    const tracker = createReadinessTracker(null);

    expect(tracker.isReady).toBe(true);
    expect(tracker.pending).toEqual([]);
  });

  it("becomes ready when the log pattern matches", () => {
    const tracker = createReadinessTracker({ log: "Done \\(" });

    expect(tracker.isReady).toBe(false);
    expect(tracker.pending).toEqual(["log"]);

    tracker.feedOutput('[Server thread/INFO]: Done (12.3s)! For help, type "help"\n');

    expect(tracker.isReady).toBe(true);
    expect(tracker.pending).toEqual([]);
  });

  it("matches a pattern split across chunks", () => {
    const tracker = createReadinessTracker({ log: "Done \\(" });

    tracker.feedOutput("[Server thread/INFO]: Do");
    expect(tracker.isReady).toBe(false);
    tracker.feedOutput("ne (12.3s)!");

    expect(tracker.isReady).toBe(true);
  });

  it("requires every declared condition, not just one", () => {
    const tracker = createReadinessTracker({ log: "Done \\(", port: 25_565 });

    tracker.feedOutput("Done (1.0s)!");
    expect(tracker.isReady).toBe(false);
    expect(tracker.pending).toEqual(["port"]);

    tracker.markPortReady();
    expect(tracker.isReady).toBe(true);
  });

  it("keeps the scan window bounded while still matching recent output", () => {
    const tracker = createReadinessTracker({ log: "Done \\(" });

    for (let index = 0; index < 200; index += 1) {
      tracker.feedOutput("x".repeat(1_000));
    }
    expect(tracker.isReady).toBe(false);
    expect(tracker.bufferedBytes).toBeLessThanOrEqual(READINESS_BUFFER_BYTES);

    tracker.feedOutput("Done (1.0s)!");
    expect(tracker.isReady).toBe(true);
  });

  it("treats an invalid pattern as never satisfied instead of throwing", () => {
    const tracker = createReadinessTracker({ log: "([unclosed" });

    expect(() => tracker.feedOutput("anything at all")).not.toThrow();
    expect(tracker.isReady).toBe(false);
    expect(tracker.pending).toEqual(["log"]);
  });

  it("ignores output once already ready", () => {
    const tracker = createReadinessTracker({ log: "Done \\(" });
    tracker.feedOutput("Done (1.0s)!");

    tracker.feedOutput("later noise");

    expect(tracker.isReady).toBe(true);
  });
});

describe("connectPort", () => {
  it("reports a listening port as reachable", async () => {
    const server = createServer();
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });

    expect(await connectPort({ host: "127.0.0.1", port, timeoutMs: 1_000 })).toBe(true);
  });

  it("reports a closed port as unreachable without hanging", async () => {
    // Port 1 is reserved and never listening in the test environment.
    expect(await connectPort({ host: "127.0.0.1", port: 1, timeoutMs: 500 })).toBe(false);
  }, 10_000);
});
