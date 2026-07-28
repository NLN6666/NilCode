// FILE: ThemePreviewCard.tsx
// Purpose: Shared card shell for color-theme fences (```theme and ```html theme).
//          The structured variant renders native swatch rows; the HTML variant
//          renders a fully sandboxed iframe. Both share the same header/footer
//          identity and the same "adopt" action, which sends the confirmed
//          palette back through the existing composer dispatch chain.
// Layer: Web chat presentation component
// Exports: ThemePreviewCard, ThemeHtmlFencePreview, ThemePreviewThreadContext,
//          ChatMarkdownSourceContext

import type { ThemeFencePayload, ThreadId } from "@synara/contracts";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  getProviderStartOptions,
  resolveAssistantDeliveryMode,
  useAppSettings,
} from "../../appSettings";
import { copyTextToClipboard } from "../../hooks/useCopyToClipboard";
import {
  buildHtmlThemeAdoptionMessage,
  buildStructuredThemeAdoptionMessage,
  buildThemeFenceSrcdoc,
  isThemeFenceClosed,
  type ThemeAdoptionMessageCopy,
} from "../../lib/themeFence";
import {
  formatOutgoingComposerPrompt,
  resolvePromptEffortFromModelSelection,
} from "../../lib/composerSend";
import { disclosureHeightClassName } from "../../lib/disclosureMotion";
import { newCommandId, newMessageId } from "../../lib/utils";
import { readNativeApi } from "../../nativeApi";
import { useStore } from "../../store";
import { getThreadFromState } from "../../threadDerivation";
import { useMessages } from "~/i18n/context";
import { CheckIcon, CopyIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { IconButton } from "../ui/icon-button";

/**
 * Thread the theme cards belong to; provided by the transcript pane so a card
 * nested arbitrarily deep in markdown can dispatch to its own thread (split
 * panes render several threads at once, so a global "active thread" is wrong).
 */
export const ThemePreviewThreadContext = createContext<ThreadId | null>(null);

/**
 * Raw markdown source currently rendered by the enclosing ChatMarkdown. The
 * HTML fence preview needs it to tell a closed fence from one still streaming
 * in (mdast auto-closes unterminated fences at EOF).
 */
export const ChatMarkdownSourceContext = createContext<string>("");

type AdoptState = "idle" | "sending" | "sent" | "failed";

/**
 * Sends the adoption message through the same command the composer send path
 * uses (`thread.turn.start`, queue mode), so server-side queueing/steering
 * semantics stay identical to a hand-typed message.
 */
async function dispatchThemeAdoptionMessage(input: {
  readonly threadId: ThreadId;
  readonly text: string;
  readonly assistantDeliveryMode: ReturnType<typeof resolveAssistantDeliveryMode>;
  readonly providerOptions: ReturnType<typeof getProviderStartOptions>;
}): Promise<boolean> {
  const api = readNativeApi();
  if (!api) {
    return false;
  }
  const thread = getThreadFromState(useStore.getState(), input.threadId);
  if (!thread) {
    return false;
  }
  const modelSelection = thread.modelSelection;
  const outgoingText = formatOutgoingComposerPrompt({
    provider: modelSelection.provider,
    model: modelSelection.model,
    effort: resolvePromptEffortFromModelSelection(modelSelection),
    text: input.text,
  });
  try {
    await api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId: input.threadId,
      message: {
        messageId: newMessageId(),
        role: "user",
        text: outgoingText,
        attachments: [],
      },
      modelSelection,
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      assistantDeliveryMode: input.assistantDeliveryMode,
      dispatchMode: "queue",
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error("[theme-preview] failed to dispatch the adoption message", error);
    return false;
  }
}

function useAdoptAction(buildMessage: () => string | null) {
  const threadId = useContext(ThemePreviewThreadContext);
  const { settings } = useAppSettings();
  const [adoptState, setAdoptState] = useState<AdoptState>("idle");
  const adopt = async () => {
    const text = buildMessage();
    if (threadId === null || text === null || adoptState === "sending") {
      return;
    }
    setAdoptState("sending");
    const sent = await dispatchThemeAdoptionMessage({
      threadId,
      text,
      assistantDeliveryMode: resolveAssistantDeliveryMode(settings),
      providerOptions: getProviderStartOptions(settings),
    });
    setAdoptState(sent ? "sent" : "failed");
  };
  return { adoptState, adopt, canAdopt: threadId !== null };
}

/** Localized sentences of the adoption message, sourced from the chat locale. */
function useThemeAdoptionCopy(): ThemeAdoptionMessageCopy {
  const copy = useMessages().chat.themePreview;
  return {
    namedHeading: copy.adoptionNamedHeading,
    heading: copy.adoptionHeading,
    request: copy.adoptionRequest,
  };
}

function useTransientCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );
  const copy = (key: string, text: string) => {
    void copyTextToClipboard(text)
      .then(() => {
        if (timerRef.current != null) {
          clearTimeout(timerRef.current);
        }
        setCopiedKey(key);
        timerRef.current = setTimeout(() => {
          setCopiedKey(null);
          timerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  };
  return { copiedKey, copy };
}

function ThemePreviewShell(props: {
  title: string;
  actions?: ReactNode;
  adoptState: AdoptState;
  adoptDisabled: boolean;
  onAdopt: () => void;
  children: ReactNode;
}) {
  const copy = useMessages().chat.themePreview;
  const adoptLabel =
    props.adoptState === "sent"
      ? copy.adoptSent
      : props.adoptState === "failed"
        ? copy.adoptFailed
        : copy.adopt;
  return (
    <div className="chat-markdown-codeblock chat-theme-preview">
      <div className="chat-markdown-codeblock__header">
        <span className="chat-markdown-codeblock__lang chat-theme-preview__title">
          {props.title}
        </span>
        {props.actions ? (
          <div className="chat-markdown-codeblock__actions">{props.actions}</div>
        ) : null}
      </div>
      {props.children}
      <div className="chat-theme-preview__footer">
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={props.adoptDisabled || props.adoptState === "sending"}
          onClick={props.onAdopt}
        >
          {adoptLabel}
        </Button>
      </div>
    </div>
  );
}

function StructuredThemePreviewCard(props: { payload: ThemeFencePayload }) {
  const copy = useMessages().chat.themePreview;
  const adoptionCopy = useThemeAdoptionCopy();
  const { copiedKey, copy: copyValue } = useTransientCopy();
  const { adoptState, adopt, canAdopt } = useAdoptAction(() =>
    buildStructuredThemeAdoptionMessage(props.payload, adoptionCopy),
  );
  const allColorsText = props.payload.colors
    .map((color) => `${color.token} ${color.hex}`)
    .join("\n");
  return (
    <ThemePreviewShell
      title={`${copy.label} · ${props.payload.name}`}
      actions={
        <IconButton
          className="chat-markdown-codeblock__action"
          onClick={() => copyValue("all", allColorsText)}
          title={copiedKey === "all" ? copy.copied : copy.copyAll}
          label={copiedKey === "all" ? copy.copied : copy.copyAll}
          size="icon-xs"
          variant="ghost"
        >
          {copiedKey === "all" ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </IconButton>
      }
      adoptState={adoptState}
      adoptDisabled={!canAdopt}
      onAdopt={() => void adopt()}
    >
      <div className="chat-theme-preview__rows">
        {props.payload.colors.map((color, index) => {
          const rowKey = `${index}:${color.hex}`;
          return (
            <div key={rowKey} className="chat-theme-preview__row">
              <button
                type="button"
                className="chat-theme-preview__swatch"
                style={{ backgroundColor: color.hex }}
                title={copiedKey === rowKey ? copy.copied : copy.copyHex(color.hex)}
                aria-label={copy.copyHex(color.hex)}
                onClick={() => copyValue(rowKey, color.hex)}
              />
              <span className="chat-theme-preview__token">{color.token}</span>
              <span className="chat-theme-preview__hex">{color.hex}</span>
              {color.note !== undefined && color.note.length > 0 ? (
                <span className="chat-theme-preview__note">{color.note}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </ThemePreviewShell>
  );
}

function HtmlThemePreviewCard(props: { html: string }) {
  const copy = useMessages().chat.themePreview;
  const adoptionCopy = useThemeAdoptionCopy();
  const [expanded, setExpanded] = useState(false);
  const { adoptState, adopt, canAdopt } = useAdoptAction(() =>
    buildHtmlThemeAdoptionMessage(props.html, adoptionCopy),
  );
  return (
    <ThemePreviewShell
      title={copy.label}
      actions={
        <IconButton
          className="chat-markdown-codeblock__action"
          onClick={() => setExpanded((previous) => !previous)}
          title={expanded ? copy.collapse : copy.expand}
          label={expanded ? copy.collapse : copy.expand}
          aria-expanded={expanded}
          size="icon-xs"
          variant="ghost"
        >
          <DisclosureChevron open={expanded} />
        </IconButton>
      }
      adoptState={adoptState}
      adoptDisabled={!canAdopt}
      onAdopt={() => void adopt()}
    >
      {/* Fixed heights on purpose: sandbox="" blocks scripts, so the iframe can
          never postMessage its natural height — a fixed cap also stops a
          3000px page from swallowing the transcript. Overflow scrolls inside
          the iframe document itself. */}
      <div
        className={disclosureHeightClassName(
          expanded,
          "h-[720px]",
          "h-[360px]",
          "chat-theme-preview__frame",
        )}
      >
        <iframe
          className="h-full w-full border-0"
          title={copy.htmlTitle}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={buildThemeFenceSrcdoc(props.html)}
        />
      </div>
    </ThemePreviewShell>
  );
}

export type ThemePreviewCardProps =
  | { readonly variant: "structured"; readonly payload: ThemeFencePayload }
  | { readonly variant: "html"; readonly html: string };

export function ThemePreviewCard(props: ThemePreviewCardProps) {
  if (props.variant === "structured") {
    return <StructuredThemePreviewCard payload={props.payload} />;
  }
  return <HtmlThemePreviewCard html={props.html} />;
}

/**
 * Gate for ```html theme fences: the iframe mounts only once the fence has
 * closed. While the fence is still streaming in, `fallback` (the ordinary
 * highlighted code block) renders instead — rebuilding an iframe per streamed
 * frame would flicker and cost a full document parse each time.
 */
export function ThemeHtmlFencePreview(props: {
  html: string;
  nodeEndOffset: number | undefined;
  isStreaming: boolean;
  fallback: ReactNode;
}) {
  const source = useContext(ChatMarkdownSourceContext);
  const closed = isThemeFenceClosed({
    source,
    nodeEndOffset: props.nodeEndOffset,
    isStreaming: props.isStreaming,
  });
  if (!closed) {
    return props.fallback;
  }
  return <ThemePreviewCard variant="html" html={props.html} />;
}
