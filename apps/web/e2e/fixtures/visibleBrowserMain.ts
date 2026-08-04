import * as path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";
import type { BrowserAnnotationEvent, ThreadBrowserState, ThreadId } from "@synara/contracts";

import {
  BROWSER_SESSION_PARTITION,
  DesktopBrowserManager,
} from "../../../desktop/src/browserManager";
import { BrowserUsePipeServer } from "../../../desktop/src/browserUsePipeServer";
import { BROWSER_IPC_CHANNELS } from "../../../desktop/src/ipcChannels";
import { hardenBrowserAnnotationWebviewPreferences } from "../../../desktop/src/browserAnnotations/webviewSecurity";
import { createBrowserPanelHideScheduler } from "../../src/components/BrowserPanel.logic";

const pipePath = process.env.SYNARA_BROWSER_HOST_PIPE_PATH;
const capability = process.env.SYNARA_BROWSER_HOST_CAPABILITY;
const shellPath = process.env.SYNARA_E2E_SHELL_PATH;
const threadId = process.env.SYNARA_E2E_THREAD_ID as ThreadId | undefined;
const synaraHome = process.env.SYNARA_HOME;
const annotationPreloadPath = process.env.SYNARA_E2E_BROWSER_ANNOTATION_PRELOAD;
// Mirrors production BrowserPanel: the browser pane is not mounted until the host asks for
// it, so the guest is created after automation has already projected the target URL.
const coldPanel = process.env.SYNARA_E2E_COLD_PANEL === "1";

if (!pipePath || !capability || !shellPath || !threadId || !synaraHome || !annotationPreloadPath) {
  throw new Error("The visible-browser Electron fixture requires its isolated E2E environment.");
}

app.setPath("userData", path.join(synaraHome, "electron-userdata"));

const browserManager = new DesktopBrowserManager({ annotationPreloadPath });
let mainWindow: BrowserWindow | null = null;
let latestState: ThreadBrowserState | null = null;
let shellReady = false;
let panelRevealEnabled = true;
const annotationEvents: BrowserAnnotationEvent[] = [];
const rendererLifecycleHide = createBrowserPanelHideScheduler();
// How many times the host asked the renderer to reveal the browser pane. Once per tool call
// would mean the pane is force-opened and re-focused under the user on every agent action.
let panelRevealRequests = 0;
// Every main-frame navigation the visible guest performs, in order. A URL appearing twice
// for one requested navigation is the double-load the user perceives as a forced refresh.
const guestMainFrameNavigations: string[] = [];
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.on("did-start-navigation", (_navigationEvent, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) guestMainFrameNavigations.push(url);
  });
});
function setPanelVisible(visible: boolean): void {
  browserManager.setPanelBounds({
    threadId,
    surface: "native",
    bounds: visible ? { x: 0, y: 34, width: 1_000, height: 726 } : null,
  });
  if (!visible) {
    browserManager.hide({ threadId });
    return;
  }
  pushState();
  mainWindow?.webContents.send("synara-e2e:open-panel");
}
function pushState(): void {
  if (shellReady && latestState && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("synara-e2e:browser-state", latestState);
  }
}

browserManager.subscribe((state) => {
  latestState = state;
  pushState();
});

ipcMain.on("synara-e2e:shell-ready", () => {
  shellReady = true;
  pushState();
});

ipcMain.handle(
  "synara-e2e:attach-webview",
  (event, input: { readonly tabId: string; readonly webContentsId: number }) =>
    browserManager.attachWebview({ threadId, ...input }, event.sender.id),
);
ipcMain.on(BROWSER_IPC_CHANNELS.annotations.guestMessage, (event, payload: unknown) => {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return;
  browserManager.handleAnnotationGuestMessage(event.sender, payload);
});
browserManager.subscribeAnnotationEvents((event) => {
  annotationEvents.push(event);
});

const pipeServer = new BrowserUsePipeServer(browserManager, {
  pipePath,
  capability,
  requestOpenPanel: (requestedThreadId) => {
    if (requestedThreadId !== threadId) throw new Error("Unexpected E2E thread scope.");
    panelRevealRequests += 1;
    // Exercise React development's setup/cleanup/setup sequence against the
    // real desktop human-control boundary. The remount must cancel the passive
    // cleanup before it can masquerade as a user takeover.
    rendererLifecycleHide.schedule(threadId, () => browserManager.hide({ threadId }));
    rendererLifecycleHide.cancel(threadId);
    if (panelRevealEnabled) setPanelVisible(true);
  },
});

Object.assign(globalThis, {
  __synaraVisibleBrowserE2E: {
    browserManager,
    annotationEvents,
    guestMainFrameNavigations,
    panelRevealRequestCount: () => panelRevealRequests,
    threadId,
    pipePath,
    setPanelRevealEnabled(enabled: boolean) {
      panelRevealEnabled = enabled;
      setPanelVisible(enabled);
    },
  },
});

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1_000,
    height: 760,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  browserManager.setWindow(mainWindow);
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (
      !hardenBrowserAnnotationWebviewPreferences({
        partition: params.partition,
        expectedPartition: BROWSER_SESSION_PARTITION,
        preloadPath: annotationPreloadPath,
        webPreferences,
      })
    ) {
      event.preventDefault();
    }
  });
  await mainWindow.loadFile(shellPath, coldPanel ? { query: { coldPanel: "1" } } : {});
  await pipeServer.start();
});

app.on("before-quit", () => {
  browserManager.dispose();
  void pipeServer.dispose();
});
