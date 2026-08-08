import { describe, expect, it } from "vitest";

import { detectShellBackgrounding, shellBackgroundingGuidance } from "./shellBackgrounding";

describe("detectShellBackgrounding", () => {
  it("detects PowerShell Start-Process", () => {
    // findings.md #16: this is the Windows idiom the agent actually reached for,
    // and the one the harness policy's prose never enumerated.
    expect(
      detectShellBackgrounding({
        command: "powershell -NoProfile -Command \"Start-Process java -ArgumentList @('-jar')\"",
      }),
    ).toBe("powershell-start-process");
  });

  it("detects Start-Process regardless of case", () => {
    expect(detectShellBackgrounding({ command: "pwsh -c start-process node server.js" })).toBe(
      "powershell-start-process",
    );
  });

  it("detects PowerShell Start-Job", () => {
    expect(
      detectShellBackgrounding({ command: "powershell -Command Start-Job { npm run dev }" }),
    ).toBe("powershell-start-job");
  });

  it("detects the tool's own run-in-background flag", () => {
    // The provider's native affordance needs no shell syntax at all, so command
    // scanning alone would miss the most likely bypass of them all.
    expect(detectShellBackgrounding({ command: "npm run dev", runInBackground: true })).toBe(
      "run-in-background-flag",
    );
  });

  it("detects a trailing POSIX ampersand", () => {
    expect(detectShellBackgrounding({ command: "npm run dev &" })).toBe("posix-ampersand");
  });

  it("detects a trailing ampersand after a command chain", () => {
    expect(detectShellBackgrounding({ command: "cd server && ./run.sh &" })).toBe(
      "posix-ampersand",
    );
  });

  it("does not mistake && for backgrounding", () => {
    expect(detectShellBackgrounding({ command: "bun run build && bun run test" })).toBeNull();
  });

  it("detects nohup", () => {
    expect(detectShellBackgrounding({ command: "nohup ./gradlew bootRun" })).toBe("nohup");
  });

  it("detects setsid", () => {
    expect(detectShellBackgrounding({ command: "setsid ./server" })).toBe("setsid");
  });

  it("detects cmd start /b", () => {
    expect(detectShellBackgrounding({ command: "cmd /c start /b node server.js" })).toBe(
      "cmd-start",
    );
  });

  it("returns null for an ordinary foreground command", () => {
    expect(detectShellBackgrounding({ command: "git status --porcelain" })).toBeNull();
  });

  it("does not fire on a word that merely contains a mechanism name", () => {
    // `nohuptest` and `restart /build` are not backgrounding; a substring match
    // would nag on every unrelated call and train the agent to ignore the notice.
    expect(detectShellBackgrounding({ command: "./nohuptest.sh" })).toBeNull();
    expect(detectShellBackgrounding({ command: "npm run restart /build" })).toBeNull();
  });

  it("treats an explicitly false run-in-background flag as foreground", () => {
    expect(detectShellBackgrounding({ command: "ls", runInBackground: false })).toBeNull();
  });
});

describe("shellBackgroundingGuidance", () => {
  it("names the daemon tool and the two consequences", () => {
    const guidance = shellBackgroundingGuidance("powershell-start-process");

    expect(guidance).toContain("synara_start_daemon");
    // Both halves of the cost matter: the process dies, AND the user loses the panel.
    expect(guidance).toMatch(/background services panel/i);
  });

  it("stays conditional so a short-lived background command is not a false accusation", () => {
    // Detection cannot know a command's lifetime, so the notice must be phrased as a
    // condition the agent evaluates rather than a verdict it has to argue with.
    expect(shellBackgroundingGuidance("posix-ampersand")).toMatch(/if this process/i);
  });

  it("names the mechanism it detected", () => {
    expect(shellBackgroundingGuidance("run-in-background-flag")).toContain(
      "run-in-background-flag",
    );
  });
});
