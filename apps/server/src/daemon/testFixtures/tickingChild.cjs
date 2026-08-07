// Fixture for detachedSurvival.test.ts: appends a line to the target file forever.
//
// Must stay `.cjs` — the repo root package.json is `"type": "module"`, so a `.js`
// fixture would fail with `require is not defined`.
const fs = require("node:fs");

const target = process.argv[2];
let tick = 0;
setInterval(() => {
  tick += 1;
  fs.appendFileSync(target, `tick ${tick} pid=${process.pid}\n`);
}, 200);
