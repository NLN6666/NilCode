import { promises as fs } from "node:fs";
import os from "node:os";
import nodePath from "node:path";

import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";

import { makeStandardAcpClientHandlers } from "./AcpClientCapabilities.ts";

describe("standard ACP client capabilities", () => {
  it("reads line windows and writes absolute UTF-8 files", async () => {
    const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "synara-acp-fs-"));
    const filePath = nodePath.join(root, "sample.txt");
    await fs.writeFile(filePath, "one\ntwo\nthree\n", "utf8");
    const scope = await Effect.runPromise(Scope.make("sequential"));
    const handlers = await Effect.runPromise(makeStandardAcpClientHandlers(scope));

    await expect(
      Effect.runPromise(handlers.readTextFile({ sessionId: "s", path: filePath, line: 2, limit: 1 })),
    ).resolves.toEqual({ content: "two\n" });
    await Effect.runPromise(
      handlers.writeTextFile({ sessionId: "s", path: filePath, content: "updated" }),
    );
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("updated");

    await Effect.runPromise(Scope.close(scope, Exit.void));
    await fs.rm(root, { recursive: true, force: true });
  });

  it("runs, bounds, waits for, and releases a standard ACP terminal", async () => {
    const scope = await Effect.runPromise(Scope.make("sequential"));
    const handlers = await Effect.runPromise(makeStandardAcpClientHandlers(scope));
    const created = await Effect.runPromise(
      handlers.createTerminal({
        sessionId: "s",
        command: process.execPath,
        args: ["-e", "process.stdout.write('0123456789');"],
        outputByteLimit: 5,
      }),
    );

    await expect(
      Effect.runPromise(
        handlers.terminalWaitForExit({ sessionId: "s", terminalId: created.terminalId }),
      ),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      Effect.runPromise(handlers.terminalOutput({ sessionId: "s", terminalId: created.terminalId })),
    ).resolves.toEqual(expect.objectContaining({ output: "56789", truncated: true }));
    await Effect.runPromise(
      handlers.terminalRelease({ sessionId: "s", terminalId: created.terminalId }),
    );
    await expect(
      Effect.runPromise(
        handlers.terminalOutput({ sessionId: "s", terminalId: created.terminalId }).pipe(Effect.flip),
      ),
    ).resolves.toMatchObject({ message: expect.stringContaining("Unknown terminal id") });

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  it("strips Synara control-plane authority from ACP terminal descendants", async () => {
    const scope = await Effect.runPromise(Scope.make("sequential"));
    const handlers = await Effect.runPromise(makeStandardAcpClientHandlers(scope));
    try {
      const created = await Effect.runPromise(
        handlers.createTerminal({
          sessionId: "s",
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify({ allowed: process.env.OMP_PHASE1_CHILD_VALUE, secret: process.env.SYNARA_AUTH_TOKEN }))",
          ],
          env: [
            { name: "OMP_PHASE1_CHILD_VALUE", value: "allowed" },
            { name: "SYNARA_AUTH_TOKEN", value: "must-not-leak" },
          ],
        }),
      );

      await Effect.runPromise(
        handlers.terminalWaitForExit({ sessionId: "s", terminalId: created.terminalId }),
      );
      const output = await Effect.runPromise(
        handlers.terminalOutput({ sessionId: "s", terminalId: created.terminalId }),
      );
      expect(JSON.parse(output.output)).toEqual({ allowed: "allowed" });
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });
});
