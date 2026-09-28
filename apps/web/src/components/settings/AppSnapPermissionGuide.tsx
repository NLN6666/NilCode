// FILE: AppSnapPermissionGuide.tsx
// Purpose: Guided macOS permission setup shared by AppSnap and Computer control — deep-links
//          the exact System Settings pane and explains granting access to this installed build.
// Layer: Settings UI component

import type { DesktopAppSnapSettingsPane } from "@synara/contracts";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useMessages } from "~/i18n/context";

export function AppSnapPermissionGuide(props: {
  pane: DesktopAppSnapSettingsPane;
  appDisplayName: string;
  waiting: boolean;
  onOpenSettings: () => void;
  onRestart: () => void;
}) {
  const m = useMessages();
  const copy = m.settings.appSnap.permissions.guide;
  const app = props.appDisplayName;
  const paneLabel =
    props.pane === "accessibility"
      ? m.settings.computer.permissions.accessibility.title
      : props.pane === "input-monitoring"
        ? m.settings.appSnap.permissions.inputMonitoring.title
        : m.settings.appSnap.permissions.screenRecording.title;
  const steps = [
    <Button
      key="open-settings"
      type="button"
      size="xs"
      variant="outline"
      onClick={props.onOpenSettings}
    >
      {copy.openSettings(paneLabel)}
    </Button>,
    copy.listedApp(app),
    copy.macAuth,
  ];

  return (
    <div className="space-y-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
      <ol className="space-y-2.5">
        {steps.map((step, index) => (
          <li
            key={typeof step === "string" ? step : "open-settings"}
            className="flex items-start gap-2.5"
          >
            <span
              aria-hidden
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--color-border)] text-ui-xs font-medium text-muted-foreground"
            >
              {index + 1}
            </span>
            <span className="min-h-6 text-ui leading-6 text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 border-t border-[color:var(--color-border)] pt-3">
        {props.waiting ? (
          <>
            <Spinner className="size-3.5" />
            <span className="text-ui-sm text-muted-foreground">
              {copy.watching}
            </span>
          </>
        ) : (
          <span className="text-ui-sm font-medium text-emerald-600">{copy.granted}</span>
        )}
      </div>
      <p className="text-ui-sm text-muted-foreground">
        {copy.stillDenied}
      </p>
      <Button type="button" size="xs" variant="outline" onClick={props.onRestart}>
        {copy.restart(app)}
      </Button>
    </div>
  );
}
