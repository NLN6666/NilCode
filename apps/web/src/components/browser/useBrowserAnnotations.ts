// FILE: useBrowserAnnotations.ts
// Purpose: Owns the continuous desktop annotation session and marker projection lifecycle.
// Layer: BrowserPanel hook

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrowserAnnotationEvent,
  BrowserAnnotationMethods,
  BrowserAnnotationSession,
  ThreadId,
} from "@synara/contracts";

import type { Locale } from "@synara/shared/i18n";

import type { BrowserAnnotationDraft } from "../../lib/browserAnnotations";
import type { Messages } from "~/i18n/locales/en";

import {
  browserAnnotationActionErrorKey,
  browserAnnotationDraftFromCommittedEvent,
  browserAnnotationMarkers,
  browserAnnotationTheme,
  isBrowserAnnotationEventInScope,
} from "../BrowserPanel.logic";

interface PendingBrowserAnnotationSession {
  readonly requestId: number;
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly session: BrowserAnnotationSession | null;
}

export interface BrowserAnnotationsController {
  readonly active: boolean;
  readonly starting: boolean;
  readonly toggle: () => void;
}

interface UseBrowserAnnotationsInput {
  readonly methods: BrowserAnnotationMethods | undefined;
  /** The browser surface being annotated — a project-wide id when the project shares a browser. */
  readonly threadId: ThreadId;
  readonly activeTabId: string | null;
  readonly browserStateVersion: number;
  readonly enabled: boolean;
  readonly annotations: readonly BrowserAnnotationDraft[];
  /**
   * Pre-bound to the chat thread that owns the composer draft. It deliberately takes no
   * thread id: `threadId` above is the BROWSER SURFACE, which is a project-wide id when the
   * project shares its browser, and an annotation belongs to the chat it was taken from.
   */
  readonly addAnnotation: (annotation: Omit<BrowserAnnotationDraft, "ordinal">) => boolean;
  readonly onError: (message: string | null) => void;
  /** Active-locale annotation failure copy, keyed by `browserAnnotationActionErrorKey`. */
  readonly errorCopy: Messages["browser"]["annotation"]["errors"];
  /** Names the copy table the isolated annotation guest resolves for its in-page popover. */
  readonly locale: Locale;
}

// Main survives renderer reloads, so a module-local 1,2,3 counter could move
// backwards and leave stale badges projected after the web shell reloads.
let nextProjectionVersion = Date.now() * 1_000;

function nextBrowserAnnotationProjectionVersion(): number {
  nextProjectionVersion = Math.max(nextProjectionVersion + 1, Date.now() * 1_000);
  return nextProjectionVersion;
}

function sessionFromStartedEvent(
  event: Extract<BrowserAnnotationEvent, { kind: "started" }>,
): BrowserAnnotationSession {
  return {
    sessionId: event.sessionId,
    threadId: event.threadId,
    tabId: event.tabId,
    document: event.document,
    source: event.source,
  };
}

export function useBrowserAnnotations({
  methods,
  threadId,
  activeTabId,
  browserStateVersion,
  enabled,
  annotations,
  addAnnotation,
  onError,
  errorCopy,
  locale,
}: UseBrowserAnnotationsInput): BrowserAnnotationsController {
  const [phase, setPhase] = useState<"idle" | "starting" | "active">("idle");
  const [documentRevision, setDocumentRevision] = useState(0);
  const pendingRef = useRef<PendingBrowserAnnotationSession | null>(null);
  const requestIdRef = useRef(0);
  const currentScopeRef = useRef({ threadId, activeTabId, enabled, methods });
  currentScopeRef.current = { threadId, activeTabId, enabled, methods };

  const clearLocalSession = useCallback(() => {
    requestIdRef.current += 1;
    pendingRef.current = null;
    setPhase("idle");
  }, []);

  const cancelPendingSession = useCallback(
    (surfaceError: boolean) => {
      const pending = pendingRef.current;
      clearLocalSession();
      if (!methods || !pending) {
        return;
      }
      void methods
        .cancel({ threadId: pending.threadId, tabId: pending.tabId })
        .catch((error: unknown) => {
          if (surfaceError) {
            onError(errorCopy[browserAnnotationActionErrorKey(error, "cancel")]);
          }
        });
    },
    [clearLocalSession, errorCopy, methods, onError],
  );

  const toggle = useCallback(() => {
    if (pendingRef.current) {
      cancelPendingSession(true);
      return;
    }
    if (!methods || !enabled || !activeTabId) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    pendingRef.current = {
      requestId,
      threadId,
      tabId: activeTabId,
      session: null,
    };
    setPhase("starting");
    onError(null);

    void methods
      .start({
        threadId,
        tabId: activeTabId,
        theme: browserAnnotationTheme(document.documentElement),
        locale,
      })
      .then(
        (session) => {
          const pending = pendingRef.current;
          const scope = currentScopeRef.current;
          if (
            !pending ||
            pending.requestId !== requestId ||
            pending.threadId !== session.threadId ||
            pending.tabId !== session.tabId ||
            scope.threadId !== session.threadId ||
            scope.activeTabId !== session.tabId ||
            !scope.enabled
          ) {
            void methods
              .cancel({ threadId: session.threadId, tabId: session.tabId })
              .catch(() => {});
            return;
          }
          pendingRef.current = { ...pending, session };
          setPhase("active");
        },
        (error: unknown) => {
          if (pendingRef.current?.requestId !== requestId) {
            return;
          }
          clearLocalSession();
          onError(errorCopy[browserAnnotationActionErrorKey(error, "start")]);
        },
      );
  }, [
    activeTabId,
    cancelPendingSession,
    clearLocalSession,
    enabled,
    errorCopy,
    locale,
    methods,
    onError,
    threadId,
  ]);

  useEffect(() => {
    if (!methods) {
      return;
    }
    return methods.onEvent((event) => {
      const scope = currentScopeRef.current;
      if (
        !isBrowserAnnotationEventInScope(event, {
          threadId: scope.threadId,
          tabId: scope.activeTabId,
        })
      ) {
        return;
      }

      const pending = pendingRef.current;
      if (event.kind === "started") {
        if (!pending || pending.tabId !== event.tabId || !scope.enabled) {
          return;
        }
        pendingRef.current = { ...pending, session: sessionFromStartedEvent(event) };
        setPhase("active");
        return;
      }

      if (event.kind === "committed") {
        if (
          !pending?.session ||
          !isBrowserAnnotationEventInScope(event, {
            threadId: scope.threadId,
            tabId: scope.activeTabId,
            sessionId: pending.session.sessionId,
            documentToken: pending.session.document.token,
          })
        ) {
          return;
        }
        const added = addAnnotation(browserAnnotationDraftFromCommittedEvent(event));
        if (!added) {
          cancelPendingSession(false);
          onError(errorCopy.draftFull);
        } else {
          onError(null);
        }
        return;
      }

      if (event.kind === "cancelled") {
        if (
          pending &&
          (event.sessionId === null ||
            (pending.session !== null && event.sessionId === pending.session.sessionId))
        ) {
          clearLocalSession();
        }
        return;
      }

      if (event.kind === "document-changed") {
        if (pending?.session && event.document.token !== pending.session.document.token) {
          clearLocalSession();
        }
        setDocumentRevision((revision) => revision + 1);
      }
    });
  }, [addAnnotation, cancelPendingSession, clearLocalSession, errorCopy, methods, onError]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (
      !pending ||
      (enabled && methods && threadId === pending.threadId && activeTabId === pending.tabId)
    ) {
      return;
    }
    cancelPendingSession(false);
  }, [activeTabId, cancelPendingSession, enabled, methods, threadId]);

  useEffect(() => {
    if (!methods || !enabled || !activeTabId) {
      return;
    }
    const version = nextBrowserAnnotationProjectionVersion();
    void methods
      .syncMarkers({
        threadId,
        tabId: activeTabId,
        version,
        markers: browserAnnotationMarkers(annotations, activeTabId),
      })
      .catch((error: unknown) => {
        const scope = currentScopeRef.current;
        if (
          scope.enabled &&
          scope.methods === methods &&
          scope.threadId === threadId &&
          scope.activeTabId === activeTabId
        ) {
          onError(errorCopy[browserAnnotationActionErrorKey(error, "sync")]);
        }
      });
  }, [
    activeTabId,
    annotations,
    browserStateVersion,
    documentRevision,
    enabled,
    errorCopy,
    methods,
    onError,
    threadId,
  ]);

  useEffect(
    () => () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!methods || !pending) {
        return;
      }
      void methods.cancel({ threadId: pending.threadId, tabId: pending.tabId }).catch(() => {});
    },
    [methods, threadId],
  );

  useEffect(() => {
    if (phase === "idle") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      cancelPendingSession(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelPendingSession, phase]);

  return {
    active: phase !== "idle",
    starting: phase === "starting",
    toggle,
  };
}
