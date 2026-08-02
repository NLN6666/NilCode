import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication } from "playwright/test";

import { browserHostPipePath } from "./fixtures/browserHostPipe";
import { createBrowserMcpHarness } from "./fixtures/mcpBrowserHarness";
import { startVisibleBrowserFixtureSite } from "./fixtures/siteServer";

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(WEB_DIR, "../..");
const DESKTOP_DIR = resolve(REPO_ROOT, "apps/desktop");
const requireFromDesktop = createRequire(resolve(DESKTOP_DIR, "package.json"));

interface E2EGlobals {
  readonly __synaraVisibleBrowserE2E: {
    readonly guestMainFrameNavigations: string[];
    readonly panelRevealRequestCount: () => number;
  };
}

async function guestNavigations(application: ElectronApplication): Promise<string[]> {
  return application.evaluate(
    () => (globalThis as unknown as E2EGlobals).__synaraVisibleBrowserE2E.guestMainFrameNavigations,
  );
}

async function panelRevealRequests(application: ElectronApplication): Promise<number> {
  return application.evaluate(() =>
    (globalThis as unknown as E2EGlobals).__synaraVisibleBrowserE2E.panelRevealRequestCount(),
  );
}

// A cold browser pane reproduces the production ordering: BrowserPanel does not exist until
// the host asks for it, so the renderer mounts the <webview> only after automation projected
// the target URL. Everything the agent does afterwards must leave the visible page alone —
// no second load of the requested URL, and no forced re-open of the pane per tool call.
test("driving a cold browser pane never reloads the page or re-opens the pane", async () => {
  const mainPath = process.env.SYNARA_E2E_ELECTRON_MAIN;
  if (!mainPath) throw new Error("Electron E2E main bundle was not prepared.");
  const site = await startVisibleBrowserFixtureSite();
  const home = mkdtempSync(join(tmpdir(), "synara-cold-browser-e2e-"));
  const workspaceRoot = join(home, "workspace");
  mkdirSync(workspaceRoot);
  const pipePath = browserHostPipePath(home);
  const capability = `cold-browser-e2e-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const threadId = `thread-cold-browser-${crypto.randomUUID()}`;
  const shellPath = resolve(WEB_DIR, "e2e/fixtures/visibleBrowserShell.html");
  const electronApp = await electron.launch({
    executablePath: requireFromDesktop("electron") as string,
    args: [mainPath],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      HOME: home,
      SYNARA_HOME: home,
      SYNARA_BROWSER_HOST_PIPE_PATH: pipePath,
      SYNARA_BROWSER_HOST_CAPABILITY: capability,
      SYNARA_E2E_SHELL_PATH: shellPath,
      SYNARA_E2E_THREAD_ID: threadId,
      SYNARA_E2E_COLD_PANEL: "1",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.locator("html")).toHaveAttribute("data-shell-ready", "true");
    // The pane is closed: no guest exists before the agent asks for one.
    expect(await page.locator("webview").count()).toBe(0);

    const mcp = createBrowserMcpHarness({ pipePath, capability, threadId, workspaceRoot });
    await mcp.initialize();
    // The fixture starts its pipe server after the shell loads, so the first calls can race it.
    await expect
      .poll(
        async () => {
          try {
            return (await mcp.call("browser_status")).structuredContent.available;
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const opened = await mcp.call("browser_open", {
      url: site.slowUrl,
      show: true,
      reuse: true,
      timeoutMs: 30_000,
    });
    expect(opened.structuredContent).toMatchObject({ finalUrl: site.slowUrl });
    await expect(page.locator("webview")).toBeVisible();
    expect(
      await page
        .locator("webview")
        .evaluate((element) => (element as Electron.WebviewTag).getURL()),
    ).toBe(site.slowUrl);

    // One requested navigation must reach the server once. A second request means the host
    // aborted the renderer's in-flight load and started it again.
    expect(site.slowRequestCount()).toBe(1);
    expect((await guestNavigations(electronApp)).filter((url) => url === site.slowUrl)).toEqual([
      site.slowUrl,
    ]);

    // A follow-up navigation on the warm guest must stay single-load too.
    await mcp.call("browser_navigate", { url: site.nextUrl, waitUntil: "domcontentloaded" });
    expect((await guestNavigations(electronApp)).filter((url) => url === site.nextUrl)).toEqual([
      site.nextUrl,
    ]);

    // Opening a closed pane legitimately reveals it once. Everything after that drives a
    // browser the user is already looking at, so the host must stop asking to reveal it.
    const revealsAfterOpen = await panelRevealRequests(electronApp);
    expect(revealsAfterOpen).toBeGreaterThan(0);
    await mcp.call("browser_snapshot", { includeImage: false });
    await mcp.call("browser_tabs");
    await mcp.call("browser_snapshot", { includeImage: false });
    expect(await panelRevealRequests(electronApp)).toBe(revealsAfterOpen);
    expect(await guestNavigations(electronApp)).toEqual([site.slowUrl, site.nextUrl]);
  } finally {
    await electronApp.close();
    await site.close();
    rmSync(home, { recursive: true, force: true });
  }
});
