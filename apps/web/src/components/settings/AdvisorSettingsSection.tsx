// FILE: AdvisorSettingsSection.tsx
// Purpose: Settings section for the advisor - whether it watches, and on which model.
// Layer: Settings UI components
// Depends on: server settings (advisor) and advisorSettings.logic

import {
  PROVIDER_DISPLAY_NAMES,
  type AdvisorServerSettings,
  type ServerSettings,
} from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SelectItem } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { useMessages } from "../../i18n/context";
import {
  ADVISOR_MODEL_OPTIONS,
  advisorEffortOptions,
  advisorEffortValue,
  advisorModelValue,
  parseAdvisorModelValue,
  withAdvisorEffort,
} from "./advisorSettings.logic";
import { SettingsSelectControl } from "./SettingControls";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export function AdvisorSettingsSection() {
  const m = useMessages();
  const copy = m.settings.models.advisor;
  const queryClient = useQueryClient();
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const advisor = serverSettingsQuery.data?.advisor;

  function patchAdvisor(patch: Partial<AdvisorServerSettings>) {
    const latest = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    if (!latest) return;
    queryClient.setQueryData(serverQueryKeys.settings(), {
      ...latest,
      advisor: { ...latest.advisor, ...patch },
    });
    void ensureNativeApi()
      .server.updateSettings({ advisor: patch })
      .then((settings) => queryClient.setQueryData(serverQueryKeys.settings(), settings))
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      });
  }

  if (!advisor) return null;

  const selectedOption = ADVISOR_MODEL_OPTIONS.find(
    (option) =>
      option.provider === advisor.modelSelection.provider &&
      option.slug === advisor.modelSelection.model,
  );

  const effortOptions = advisorEffortOptions(advisor.modelSelection);
  const effortValue = advisorEffortValue(advisor.modelSelection);
  const selectedEffort = effortOptions.find((level) => level.value === effortValue);

  return (
    <SettingsSection title={copy.title}>
      <SettingsRow
        title={copy.enabled.title}
        anchorKey="models:advisor-enabled"
        description={copy.enabled.description}
        control={
          <Switch
            checked={advisor.enabled}
            aria-label={copy.enabled.ariaLabel}
            onCheckedChange={(enabled) => patchAdvisor({ enabled })}
          />
        }
      />
      <SettingsRow
        title={copy.model.title}
        anchorKey="models:advisor-model"
        description={copy.model.description}
        control={
          <SettingsSelectControl
            value={advisorModelValue(advisor.modelSelection)}
            onValueChange={(value) => {
              // A value that does not name one of the offered pairs is dropped
              // rather than sent: the contract cannot represent it, so the
              // patch would be rejected after the UI already looked saved.
              const modelSelection = parseAdvisorModelValue(value, advisor.modelSelection);
              if (modelSelection === null) return;
              patchAdvisor({ modelSelection });
            }}
            ariaLabel={copy.model.ariaLabel}
            triggerClassName="w-full sm:w-52"
            valueContent={
              selectedOption
                ? `${PROVIDER_DISPLAY_NAMES[selectedOption.provider]} / ${selectedOption.name}`
                : advisor.modelSelection.model
            }
          >
            {ADVISOR_MODEL_OPTIONS.map((option) => (
              <SelectItem
                hideIndicator
                key={`${option.provider}:${option.slug}`}
                value={`${option.provider}:${option.slug}`}
              >
                {PROVIDER_DISPLAY_NAMES[option.provider]} / {option.name}
              </SelectItem>
            ))}
          </SettingsSelectControl>
        }
      />
      {effortOptions.length > 0 ? (
        <SettingsRow
          title={copy.effort.title}
          anchorKey="models:advisor-effort"
          description={copy.effort.description}
          control={
            <SettingsSelectControl
              value={effortValue}
              onValueChange={(value) => {
                // Unsupported levels come back as the same selection object, so
                // there is nothing to patch and nothing to optimistically flip.
                const modelSelection = withAdvisorEffort(advisor.modelSelection, value);
                if (modelSelection === advisor.modelSelection) return;
                patchAdvisor({ modelSelection });
              }}
              ariaLabel={copy.effort.ariaLabel}
              triggerClassName="w-full sm:w-52"
              valueContent={selectedEffort?.label ?? effortValue}
            >
              {effortOptions.map((level) => (
                <SelectItem hideIndicator key={level.value} value={level.value}>
                  {level.label}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
      ) : null}
    </SettingsSection>
  );
}
