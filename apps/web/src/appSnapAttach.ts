// FILE: appSnapAttach.ts
// Purpose: Shared completion flow for an AppSnap capture once its target thread is known.
// Layer: Web composer domain
// Depends on: composer draft image intake, toast notifications, and optional bridge acknowledgement.

import type { DesktopAppSnapCapture, ThreadId } from "@synara/contracts";

import { insertAppSnapCaptureIntoDraft } from "~/appSnapIntake";
import { toastManager } from "~/components/ui/toast";
import type { Messages } from "~/i18n/locales/en";

export async function attachAppSnapCapture(
  threadId: ThreadId,
  capture: DesktopAppSnapCapture,
  copy: Messages["composer"]["extras"]["appSnap"],
  acknowledge?: () => Promise<void>,
): Promise<"persisted" | "unverified"> {
  const persistenceResult = await insertAppSnapCaptureIntoDraft(threadId, capture);

  const successDescription = capture.sourceAppName
    ? copy.addedApp(capture.sourceAppName)
    : copy.addedWindow;

  toastManager.add({
    type: persistenceResult === "unverified" ? "warning" : "success",
    title: persistenceResult === "unverified" ? copy.addedWithWarning : copy.added,
    description: persistenceResult === "unverified" ? copy.unverified : successDescription,
    data: { allowCrossThreadVisibility: true },
  });

  if (persistenceResult === "persisted" && acknowledge) {
    await acknowledge().catch((error) =>
      console.warn("[appsnap] Could not acknowledge capture", error),
    );
  }

  return persistenceResult;
}
