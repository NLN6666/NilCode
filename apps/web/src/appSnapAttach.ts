import { readExecutionContext } from "./lib/hosts/executionContext";
// FILE: appSnapAttach.ts
// Purpose: Shared completion flow for an AppSnap capture once its target thread is known.
// Layer: Web composer domain
// Depends on: composer draft image intake, toast notifications, and optional bridge acknowledgement.

import type { DesktopAppSnapCapture, ThreadId } from "@synara/contracts";

import { insertAppSnapCaptureIntoDraft } from "~/appSnapIntake";
import { toastManager } from "~/components/ui/toast";
import type { useTranslation } from "~/i18n";

type AppSnapTranslator = ReturnType<typeof useTranslation>["t"];

export async function attachAppSnapCapture(
  threadId: ThreadId,
  capture: DesktopAppSnapCapture,
  translate: AppSnapTranslator,
  acknowledge?: () => Promise<void>,
): Promise<"persisted" | "unverified"> {
  if (readExecutionContext()?.remote)
    throw new Error("AppSnap is unavailable for remote workspaces.");
  const persistenceResult = await insertAppSnapCaptureIntoDraft(threadId, capture);

  const successDescription = capture.sourceAppName
    ? translate("chat:appSnap_addedApp", { value0: capture.sourceAppName })
    : translate("chat:appSnap_addedWindow");

  toastManager.add({
    type: persistenceResult === "unverified" ? "warning" : "success",
    title: translate(
      persistenceResult === "unverified" ? "chat:appSnap_addedWithWarning" : "chat:appSnap_added",
    ),
    description:
      persistenceResult === "unverified"
        ? translate("chat:appSnap_unverified")
        : successDescription,
    data: { allowCrossThreadVisibility: true },
  });

  if (persistenceResult === "persisted" && acknowledge) {
    await acknowledge().catch((error) =>
      console.warn("[appsnap] Could not acknowledge capture", error),
    );
  }

  return persistenceResult;
}
