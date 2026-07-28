// FILE: browserElementPicker.ts
// Purpose: Owns the lifecycle of an in-app browser "pick an element" session (CDP overlay
//          inspect mode, one-shot read-only extraction, cropped screenshot).
// Layer: Desktop runtime helper
// Depends on: a narrow CDP host interface supplied by DesktopBrowserManager
//
// Kept out of browserManager.ts on purpose: the manager already owns tab/view lifecycle,
// and the pick session is an independent state machine that must be able to clean itself
// up (a page left in inspect mode swallows every click).

import type {
  BrowserCancelElementPickInput,
  BrowserCaptureScreenshotResult,
  BrowserElementPickCancelledEvent,
  BrowserElementPickedEvent,
  BrowserElementSelection,
  BrowserStartElementPickInput,
  BrowserTabInput,
  ThreadId,
} from "@synara/contracts";

import {
  BROWSER_ELEMENT_HTML_MAX_CHARS,
  BROWSER_ELEMENT_STYLE_ALLOWLIST,
  BROWSER_ELEMENT_TEXT_MAX_CHARS,
  browserElementScreenshotName,
  buildBrowserElementSelection,
} from "./browserElementSelectionBuilder";

// Read-only evaluation in the page's main world. It must not touch the DOM: the point of
// picking is to describe the page, not to change it. Truncation happens twice — a coarse
// pass here so a giant <body> never crosses the IPC boundary, then the authoritative pass
// in buildBrowserElementSelection.
const EXTRACT_ELEMENT_FN = `
function (styleProperties, textMaxChars, htmlMaxChars) {
  var el = this;
  if (!el || el.nodeType !== 1) {
    return null;
  }

  function escapeIdentifier(value) {
    if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function isStableClassName(value) {
    // Skip hashed/utility-generated classes: they change between builds and make the
    // selector useless for locating the element in source.
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length < 40 &&
      !/^[a-z]+-[0-9a-f]{5,}$/i.test(value)
    );
  }

  function ownSelector(node) {
    var tag = node.tagName ? node.tagName.toLowerCase() : "*";
    if (node.id && document.querySelectorAll("#" + escapeIdentifier(node.id)).length === 1) {
      return "#" + escapeIdentifier(node.id);
    }
    var classes = [];
    var list = node.classList ? Array.prototype.slice.call(node.classList) : [];
    for (var i = 0; i < list.length && classes.length < 3; i += 1) {
      if (isStableClassName(list[i])) {
        classes.push("." + escapeIdentifier(list[i]));
      }
    }
    var base = tag + classes.join("");
    var parent = node.parentElement;
    if (!parent) {
      return base;
    }
    var sameShape = 0;
    var index = 0;
    var siblings = parent.children;
    for (var j = 0; j < siblings.length; j += 1) {
      if (siblings[j].tagName !== node.tagName) {
        continue;
      }
      sameShape += 1;
      if (siblings[j] === node) {
        index = sameShape;
      }
    }
    return sameShape > 1 ? base + ":nth-of-type(" + index + ")" : base;
  }

  function buildSelector(node) {
    var parts = [];
    var current = node;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 5) {
      var part = ownSelector(current);
      parts.unshift(part);
      if (part.charAt(0) === "#") {
        break;
      }
      var candidate = parts.join(" > ");
      try {
        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      } catch (error) {
        return parts.join(" > ");
      }
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  }

  var rect = el.getBoundingClientRect();
  var computed = window.getComputedStyle(el);
  var styles = {};
  for (var k = 0; k < styleProperties.length; k += 1) {
    var property = styleProperties[k];
    try {
      styles[property] = computed.getPropertyValue(property);
    } catch (error) {
      // A shadow-DOM or cross-origin edge case: drop the property instead of failing.
    }
  }

  var text = typeof el.textContent === "string" ? el.textContent : "";
  var html = typeof el.outerHTML === "string" ? el.outerHTML : "";
  var classList = el.classList ? Array.prototype.slice.call(el.classList) : [];

  return {
    selector: buildSelector(el),
    tagName: el.tagName ? el.tagName.toLowerCase() : "",
    elementId: typeof el.id === "string" && el.id.length > 0 ? el.id : null,
    classNames: classList.slice(0, 32),
    textSnippet: text.slice(0, textMaxChars * 4),
    outerHtmlSnippet: html.slice(0, htmlMaxChars * 2),
    rect: {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    },
    computedStyles: styles
  };
}
`;

// Chrome DevTools' own inspect palette, so the highlight reads as a familiar affordance.
const INSPECT_HIGHLIGHT_CONFIG = {
  showInfo: true,
  showStyles: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.42 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
} as const;

const SCREENSHOT_MIME_TYPE = "image/png";

// A narrow slice of DesktopBrowserManager so tests can drive the session with fakes and
// the manager keeps only thin delegation methods.
export interface BrowserElementPickHost {
  /** Ensures the tab is live and the debugger is attached (attachBrowserUseTab). */
  attachTab: (input: BrowserTabInput) => Promise<void>;
  sendCommand: (
    input: BrowserTabInput,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  subscribeToCdpEvents: (
    input: BrowserTabInput,
    listener: (event: { method: string; params?: unknown }) => void,
  ) => () => void;
  /** Last committed URL for the tab, used as the selection's pageUrl. */
  getTabUrl: (input: BrowserTabInput) => string;
  emitPicked: (event: BrowserElementPickedEvent) => void;
  emitCancelled: (event: BrowserElementPickCancelledEvent) => void;
}

interface ActivePickSession {
  tabId: string;
  /** Identifies which start() call owns this slot; see BrowserElementPicker.start. */
  generation: number;
  /** Null until the CDP event listener is attached partway through start(). */
  unsubscribe: (() => void) | null;
  settled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBackendNodeId(params: unknown): number | null {
  if (!isRecord(params)) {
    return null;
  }
  const backendNodeId = params.backendNodeId;
  return typeof backendNodeId === "number" && Number.isFinite(backendNodeId) ? backendNodeId : null;
}

function readObjectId(result: unknown): string | null {
  if (!isRecord(result)) {
    return null;
  }
  const object = result.object;
  if (!isRecord(object)) {
    return null;
  }
  return typeof object.objectId === "string" && object.objectId.length > 0 ? object.objectId : null;
}

function readCallFunctionValue(result: unknown): unknown {
  if (!isRecord(result)) {
    return null;
  }
  if (isRecord(result.exceptionDetails)) {
    return null;
  }
  const remoteObject = result.result;
  return isRecord(remoteObject) ? remoteObject.value : null;
}

function readScreenshotData(result: unknown): string | null {
  if (!isRecord(result)) {
    return null;
  }
  return typeof result.data === "string" && result.data.length > 0 ? result.data : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Element picking failed.";
}

export class BrowserElementPicker {
  private readonly sessions = new Map<ThreadId, ActivePickSession>();
  private generationCounter = 0;

  constructor(private readonly host: BrowserElementPickHost) {}

  isPicking(threadId: ThreadId): boolean {
    return this.sessions.has(threadId);
  }

  /**
   * Puts the tab into DevTools inspect mode and waits for one Overlay.inspectNodeRequested.
   *
   * The session is registered **synchronously, before the first await**, and every async
   * step re-checks its generation. Registering only after the CDP setup chain would leave a
   * window where `cancel()` finds no session and silently no-ops while this call goes on to
   * arm inspect mode — the page would end up swallowing clicks with the UI already back in
   * browse mode. The generation check also retires a listener whose session was replaced by
   * a concurrent start, which would otherwise leak forever.
   */
  async start(input: BrowserStartElementPickInput): Promise<void> {
    const existing = this.sessions.get(input.threadId);
    if (existing?.tabId === input.tabId) {
      return;
    }
    // Switching tabs mid-pick: drop the old session silently so the renderer does not get
    // a cancel event for the mode it just re-entered.
    this.endSession(input.threadId);

    const target: BrowserTabInput = { threadId: input.threadId, tabId: input.tabId };
    this.generationCounter += 1;
    const generation = this.generationCounter;
    this.sessions.set(input.threadId, {
      tabId: input.tabId,
      generation,
      unsubscribe: null,
      settled: false,
    });

    try {
      await this.host.attachTab(target);
      if (await this.bailOutIfSuperseded(target, generation)) return;
      await this.host.sendCommand(target, "DOM.enable");
      if (await this.bailOutIfSuperseded(target, generation)) return;
      await this.host.sendCommand(target, "CSS.enable");
      if (await this.bailOutIfSuperseded(target, generation)) return;
      await this.host.sendCommand(target, "Overlay.enable");
      if (await this.bailOutIfSuperseded(target, generation)) return;
      // DOM.getDocument seeds the backend node map; without it DOM.resolveNode fails on
      // pages the debugger has not walked yet.
      await this.host.sendCommand(target, "DOM.getDocument", { depth: 0 });
      if (await this.bailOutIfSuperseded(target, generation)) return;

      const unsubscribe = this.host.subscribeToCdpEvents(target, (event) => {
        if (event.method !== "Overlay.inspectNodeRequested") {
          return;
        }
        if (this.sessions.get(input.threadId)?.generation !== generation) {
          return;
        }
        const backendNodeId = readBackendNodeId(event.params);
        if (backendNodeId === null) {
          void this.finishWithError(
            input.threadId,
            "Couldn't read the picked element.",
            generation,
          );
          return;
        }
        void this.completePick(target, backendNodeId, generation);
      });

      const session = this.sessions.get(input.threadId);
      if (session?.generation !== generation) {
        // Cancelled (or replaced) while we were subscribing: retire this listener now,
        // because the session that would have owned it is already gone.
        unsubscribe();
        await this.clearInspectMode(target);
        return;
      }
      session.unsubscribe = unsubscribe;

      await this.host.sendCommand(target, "Overlay.setInspectMode", {
        mode: "searchForNode",
        highlightConfig: INSPECT_HIGHLIGHT_CONFIG,
      });
      await this.bailOutIfSuperseded(target, generation);
    } catch (error) {
      if (this.sessions.get(input.threadId)?.generation !== generation) {
        return;
      }
      this.endSession(input.threadId);
      this.host.emitCancelled({
        threadId: input.threadId,
        reason: "error",
        message: errorMessage(error),
      });
    }
  }

  /**
   * True when this start() call is no longer the owner of the thread's session.
   *
   * Always disarms inspect mode on the way out: a cancel that landed in the setup window may
   * have cleared it *before* we armed it, so the only safe assumption is that the page might
   * be armed right now. `setInspectMode({mode:"none"})` is idempotent, so an extra call on a
   * never-armed page is harmless.
   */
  private async bailOutIfSuperseded(target: BrowserTabInput, generation: number): Promise<boolean> {
    if (this.sessions.get(target.threadId)?.generation === generation) {
      return false;
    }
    await this.clearInspectMode(target);
    return true;
  }

  // User-initiated exit (toolbar toggle, Esc, panel unmount).
  async cancel(input: BrowserCancelElementPickInput): Promise<void> {
    await this.stop(input.threadId, "user", null);
  }

  // Page navigated out from under an active pick: inspect mode does not survive it.
  handleNavigation(threadId: ThreadId, tabId: string): void {
    if (this.sessions.get(threadId)?.tabId !== tabId) {
      return;
    }
    void this.stop(threadId, "navigation", null);
  }

  // The tab (or its runtime) is gone, so no CDP command can be issued anymore.
  handleTabClosed(threadId: ThreadId, tabId: string): void {
    const session = this.sessions.get(threadId);
    if (session?.tabId !== tabId) {
      return;
    }
    this.endSession(threadId);
    this.host.emitCancelled({ threadId, reason: "tab-closed", message: null });
  }

  // Teardown for manager dispose: drop listeners without emitting into a dead renderer.
  disposeAll(): void {
    for (const threadId of [...this.sessions.keys()]) {
      this.endSession(threadId);
    }
  }

  private async stop(
    threadId: ThreadId,
    reason: BrowserElementPickCancelledEvent["reason"],
    message: string | null,
    expectedGeneration?: number,
  ): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) {
      return;
    }
    if (expectedGeneration !== undefined && session.generation !== expectedGeneration) {
      return;
    }
    const tabId = session.tabId;
    if (!this.endSession(threadId, expectedGeneration)) {
      return;
    }
    if (reason !== "tab-closed") {
      await this.clearInspectMode({ threadId, tabId });
    }
    this.host.emitCancelled({ threadId, reason, message });
  }

  /**
   * Retires the thread's session and returns whether it actually did anything.
   *
   * `expectedGeneration` is mandatory for any caller that reaches here after an await: by
   * then the slot may already belong to a newer session (user picked on tab A, then started
   * a pick on tab B while A's extraction round trip was still running). Tearing that one
   * down would leave tab B armed in inspect mode with nobody listening — clicks swallowed,
   * and no later navigation/close hook able to disarm it because the map is empty.
   * Omitting the argument means "replace whatever is here", which is what start() wants.
   */
  private endSession(threadId: ThreadId, expectedGeneration?: number): boolean {
    const session = this.sessions.get(threadId);
    if (!session) {
      return false;
    }
    if (expectedGeneration !== undefined && session.generation !== expectedGeneration) {
      return false;
    }
    session.settled = true;
    this.sessions.delete(threadId);
    try {
      // Null while start() is still between its awaits; that call retires its own listener
      // once it notices the generation moved on.
      session.unsubscribe?.();
    } catch {
      // The runtime may already be torn down; the listener dies with it.
    }
    return true;
  }

  private async clearInspectMode(target: BrowserTabInput): Promise<void> {
    try {
      await this.host.sendCommand(target, "Overlay.setInspectMode", { mode: "none" });
    } catch {
      // Best effort: the page may already be gone, in which case there is no mode to clear.
    }
  }

  private async finishWithError(
    threadId: ThreadId,
    message: string,
    generation: number,
  ): Promise<void> {
    await this.stop(threadId, "error", message, generation);
  }

  /**
   * Turns one inspect hit into a selection.
   *
   * `generation` identifies the session that observed the hit. Every teardown below passes
   * it through, because this method spans several CDP round trips and the user can start a
   * pick on another tab in that window. Note that `emitPicked` is deliberately NOT gated on
   * it: the user really did click that element, the thread is the same, so the result belongs
   * in the composer draft regardless of which session currently owns the slot. Only cleanup
   * is generation-scoped.
   */
  private async completePick(
    target: BrowserTabInput,
    backendNodeId: number,
    generation: number,
  ): Promise<void> {
    const session = this.sessions.get(target.threadId);
    if (
      !session ||
      session.generation !== generation ||
      session.tabId !== target.tabId ||
      session.settled
    ) {
      return;
    }
    // Claim the session before any await so a second inspectNodeRequested cannot race in.
    session.settled = true;

    try {
      // Chrome leaves inspect mode armed after a hit on some surfaces; disarm explicitly so
      // the page becomes clickable again the instant the user picks.
      await this.clearInspectMode(target);

      const resolved = await this.host.sendCommand(target, "DOM.resolveNode", { backendNodeId });
      const objectId = readObjectId(resolved);
      if (!objectId) {
        if (this.endSession(target.threadId, generation)) {
          this.host.emitCancelled({
            threadId: target.threadId,
            reason: "error",
            message: "Couldn't resolve the picked element.",
          });
        }
        return;
      }

      const called = await this.host.sendCommand(target, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: EXTRACT_ELEMENT_FN,
        arguments: [
          { value: [...BROWSER_ELEMENT_STYLE_ALLOWLIST] },
          { value: BROWSER_ELEMENT_TEXT_MAX_CHARS },
          { value: BROWSER_ELEMENT_HTML_MAX_CHARS },
        ],
        returnByValue: true,
        awaitPromise: false,
      });

      const selection = buildBrowserElementSelection({
        tabId: target.tabId,
        pageUrl: this.host.getTabUrl(target),
        raw: readCallFunctionValue(called),
      });
      if (!selection) {
        if (this.endSession(target.threadId, generation)) {
          this.host.emitCancelled({
            threadId: target.threadId,
            reason: "error",
            message: "Couldn't read the picked element.",
          });
        }
        return;
      }

      const screenshot = await this.captureElementScreenshot(target, selection);
      this.endSession(target.threadId, generation);
      // Unconditional on purpose — see the note on this method.
      this.host.emitPicked({ threadId: target.threadId, selection, screenshot });
    } catch (error) {
      const wasCurrent = this.endSession(target.threadId, generation);
      await this.clearInspectMode(target);
      if (wasCurrent) {
        this.host.emitCancelled({
          threadId: target.threadId,
          reason: "error",
          message: errorMessage(error),
        });
      }
    }
  }

  // A missing crop is not a failed pick: the structural context alone is still useful, so
  // every failure path here degrades to null instead of throwing.
  private async captureElementScreenshot(
    target: BrowserTabInput,
    selection: BrowserElementSelection,
  ): Promise<BrowserCaptureScreenshotResult | null> {
    const { x, y, width, height } = selection.rect;
    if (width <= 0 || height <= 0) {
      return null;
    }

    try {
      const result = await this.host.sendCommand(target, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x, y, width, height, scale: 1 },
      });
      const data = readScreenshotData(result);
      if (!data) {
        return null;
      }
      const bytes = Buffer.from(data, "base64");
      if (bytes.byteLength === 0) {
        return null;
      }
      return {
        name: browserElementScreenshotName(selection.pageUrl, selection.tagName),
        mimeType: SCREENSHOT_MIME_TYPE,
        sizeBytes: bytes.byteLength,
        bytes: Uint8Array.from(bytes),
      };
    } catch {
      return null;
    }
  }
}
