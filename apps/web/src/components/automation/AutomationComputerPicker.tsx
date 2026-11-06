import { readExecutionContext } from "~/lib/hosts/executionContext";
import type { AutomationFormState } from "~/lib/automationForm";
import {
  portableAutomationDraft,
  prepareWorkspaceAutomation,
} from "~/lib/hosts/automationWorkspace";
import { readWorkspaceFrame, workspaceRoute } from "~/lib/hosts/workspaceFrame";
import { readWorkspaceSessions } from "~/lib/hosts/workspaceSessions";
import { useTranslation } from "~/i18n";
import { ComputerPicker, useWorkspaceComputers } from "../hosts/ComputerPicker";
import { toastManager } from "../ui/toast";

export function AutomationComputerPicker({
  form,
  disabled,
  onMoved,
}: {
  readonly form: AutomationFormState;
  readonly disabled: boolean;
  readonly onMoved: () => void;
}) {
  const { t } = useTranslation();
  const { computers, currentId, localId, navigate } = useWorkspaceComputers();
  const context = readExecutionContext();
  if (context?.controller.capabilities.remoteConnections !== true)
    return <span>{context?.execution.label ?? t("computer:picker_thisComputer")}</span>;
  const select = (id: string) => {
    if (disabled || id === currentId) return;
    const frame = readWorkspaceFrame();
    try {
      const draft = portableAutomationDraft(form);
      let path: string;
      if (id === localId) {
        const prepare = frame ? frame.controller.prepareAutomation : prepareWorkspaceAutomation;
        if (!prepare) throw new Error(t("automation:computerNeedsUpdateToCreateAutomations"));
        path = prepare(draft);
      } else {
        const session = (frame?.controller.sessions ?? readWorkspaceSessions)().find(
          (entry) => entry.host.executionScope.environmentId === id,
        );
        if (
          session?.error ||
          session?.summary?.state !== "open" ||
          !session.navigation?.prepareAutomation
        )
          throw new Error(t("computer:picker_notConnected"));
        path = workspaceRoute(id, session.navigation.prepareAutomation(draft));
      }
      onMoved();
      navigate(path);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("automation:couldNotSelectComputer"),
        description: error instanceof Error ? error.message : t("computer:picker_tryAgain"),
      });
    }
  };
  return (
    <ComputerPicker
      computers={computers}
      value={currentId}
      disabled={disabled}
      purpose={t("computer:picker_runOn")}
      onChange={select}
      onManage={() => navigate("/settings?section=connections")}
    />
  );
}
