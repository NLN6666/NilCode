// FILE: SkillsSettingsPanel.tsx
// Purpose: Settings → Skills panel. Lists every skill from the unified cross-provider
// catalog (~/.synara/skills plus each provider's skills folder), shows which provider
// a skill comes from, and lets the user enable/disable each one — individually, per
// origin section, or all at once. Disabled skills are hidden from the composer skill
// picker on every provider.

import type { ProviderKind, ServerSettings } from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ProviderIcon } from "~/components/ProviderIcon";
import { SettingsRow, SettingsSection } from "~/components/settings/SettingsPanelPrimitives";
import { Switch } from "~/components/ui/switch";
import { useMessages } from "../../i18n/context";
import { SkillCubeIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import {
  providerDiscoveryQueryKeys,
  skillsCatalogQueryOptions,
} from "~/lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import {
  buildSettingsSkillGroups,
  buildSettingsSkillSections,
  nextDisabledSkillNames,
  providerDisplayName,
  settingsSkillNameKey,
  skillToggleState,
} from "./skillsSettingsModel";

function SkillProviderStack({ providers }: { providers: ReadonlyArray<ProviderKind> }) {
  const m = useMessages();
  if (providers.length === 0) {
    return null;
  }

  const label = providers.map(providerDisplayName).join(", ");
  const stackLabel = m.settings.skills.providerCopies(providers.length, label);
  return (
    <span
      className="inline-flex shrink-0 items-center -space-x-1"
      aria-label={stackLabel}
      title={stackLabel}
    >
      {providers.map((provider) => (
        <span
          key={provider}
          className="inline-flex size-4 items-center justify-center rounded-full border border-background bg-background"
        >
          <ProviderIcon provider={provider} className="size-3" />
        </span>
      ))}
    </span>
  );
}

export function SkillsSettingsPanel() {
  const m = useMessages();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(skillsCatalogQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());

  const disabledSkillNames = new Set(
    (serverSettingsQuery.data?.skills.disabled ?? []).map((name) => settingsSkillNameKey(name)),
  );

  const skillGroups = buildSettingsSkillGroups(catalogQuery.data?.skills ?? [], m.settings.skills);
  const skillSections = buildSettingsSkillSections(
    catalogQuery.data?.skills ?? [],
    m.settings.skills,
  );

  // Batched so one row, one section, and the whole catalog all travel the same path:
  // a single settings patch, one optimistic flip, one rollback on failure.
  const setSkillsEnabled = (skillKeys: ReadonlyArray<string>, enabled: boolean) => {
    if (skillKeys.length === 0) {
      return;
    }
    // Read through the query cache (not the render closure) so rapid toggles
    // build on each other instead of clobbering the previous patch.
    const latestSettings = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    const currentDisabled = latestSettings?.skills.disabled ?? [...disabledSkillNames];
    const disabled = nextDisabledSkillNames(currentDisabled, skillKeys, enabled);
    if (latestSettings) {
      // Optimistic flip; a failed patch invalidates back to the server state.
      queryClient.setQueryData(serverQueryKeys.settings(), {
        ...latestSettings,
        skills: { disabled },
      });
    }
    void ensureNativeApi()
      .server.updateSettings({ skills: { disabled } })
      .then((nextSettings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        // Composer skill pickers are served filtered by these toggles.
        void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      });
  };

  const totalSkills = skillGroups.length;
  const enabledSkills = skillGroups.filter((group) => !disabledSkillNames.has(group.key)).length;
  const synaraSkillsDir = catalogQuery.data?.synaraSkillsDir;
  const allSkillKeys = skillGroups.map((group) => group.key);
  const allToggleState = skillToggleState(allSkillKeys, disabledSkillNames);

  return (
    <div className="space-y-8">
      <SettingsSection title={m.settings.skills.portable}>
        <SettingsRow
          title={m.settings.skills.folder.title}
          description={m.settings.skills.folder.description}
          status={
            synaraSkillsDir ? (
              <code className="break-all text-[11px] text-muted-foreground">{synaraSkillsDir}</code>
            ) : null
          }
          control={
            <span className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                {catalogQuery.isLoading
                  ? m.settings.skills.scanning
                  : m.settings.skills.enabledCount(enabledSkills, totalSkills)}
              </span>
              {totalSkills > 0 ? (
                <Switch
                  checked={allToggleState === "all"}
                  indeterminate={allToggleState === "partial"}
                  onCheckedChange={(checked) => setSkillsEnabled(allSkillKeys, Boolean(checked))}
                  aria-label={m.settings.skills.toggleAll}
                />
              ) : null}
            </span>
          }
        />
      </SettingsSection>

      {catalogQuery.isError ? (
        <SettingsSection title={m.settings.skills.sectionTitle}>
          <SettingsRow
            title={m.settings.skills.discoveryFailed.title}
            description={m.settings.skills.discoveryFailed.description}
          />
        </SettingsSection>
      ) : null}

      {!catalogQuery.isLoading && !catalogQuery.isError && totalSkills === 0 ? (
        <SettingsSection title={m.settings.skills.sectionTitle}>
          <SettingsRow
            title={m.settings.skills.noneFound.title}
            description={m.settings.skills.noneFound.description}
          />
        </SettingsSection>
      ) : null}

      {skillSections.map((section) => {
        const sectionKeys = section.groups.map((group) => group.key);
        const sectionToggleState = skillToggleState(sectionKeys, disabledSkillNames);
        return (
          <SettingsSection
            key={section.key}
            title={section.title}
            action={
              <Switch
                checked={sectionToggleState === "all"}
                indeterminate={sectionToggleState === "partial"}
                onCheckedChange={(checked) => setSkillsEnabled(sectionKeys, Boolean(checked))}
                aria-label={m.settings.skills.toggleSection(section.title)}
              />
            }
          >
            {section.groups.map((group) => {
              const enabled = !disabledSkillNames.has(group.key);
              return (
                <SettingsRow
                  key={group.key}
                  title={
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <SkillCubeIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate">{group.displayName}</span>
                    </span>
                  }
                  description={group.description}
                  status={
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <SkillProviderStack providers={group.providers} />
                        <span className="truncate text-[11px] text-muted-foreground">
                          {group.sources.map((source) => source.originInfo.label).join(" · ")}
                        </span>
                      </span>
                      {group.sources.map((source) => (
                        <code
                          key={source.skill.path}
                          className="truncate text-[11px] text-muted-foreground"
                        >
                          {source.skill.path}
                        </code>
                      ))}
                    </span>
                  }
                  control={
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) => setSkillsEnabled([group.key], Boolean(checked))}
                      aria-label={m.settings.skills.enableSkill(group.displayName)}
                    />
                  }
                />
              );
            })}
          </SettingsSection>
        );
      })}
    </div>
  );
}
