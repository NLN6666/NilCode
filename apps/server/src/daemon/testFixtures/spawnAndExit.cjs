// Fixture for detachedSurvival.test.ts: the intermediate parent.
//
// Spawns tickingChild.cjs with the real daemon spawn options, prints the child pid,
// then exits — so the test can observe whether the child outlives its parent.
//
// argv: <tickingChildPath> <logPath> <"detached"|"supervised">
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const [, , childPath, logPath, mode] = process.argv;
const detached = mode === "detached";

const logFd = fs.openSync(logPath, "a");
const child = spawn(process.execPath, [childPath, logPath], {
  detached,
  windowsHide: process.platform === "win32",
  stdio: ["ignore", logFd, logFd],
});
child.unref();

process.stdout.write(`${child.pid}\n`);
setTimeout(() => process.exit(0), 300);
