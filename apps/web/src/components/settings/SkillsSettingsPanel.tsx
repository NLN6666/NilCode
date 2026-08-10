// FILE: SkillsSettingsPanel.tsx
// Purpose: Settings → Skills panel. Lists every skill folder on this machine (~/.synara/skills
// plus each provider's own folder), shows which providers actually load each skill, and lets
// the user enable/disable it — per provider, per row, per section, or all at once. Opt-outs are
// scoped to a provider, so silencing a skill for one agent leaves the others alone.

import type { DisabledSkillsByProvider, ProviderKind, ServerSettings } from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { SettingsRow, SettingsSection } from "~/components/settings/SettingsPanelPrimitives";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
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
  isSkillDisabledForProvider,
  nextDisabledSkills,
  providerDisplayName,
  type SettingsSkillGroup,
  type SkillToggleTarget,
  skillToggleState,
  toggleTargetsForGroups,
} from "./skillsSettingsModel";

function SkillProviderStack({ providers }: { providers: ReadonlyArray<ProviderKind> }) {
  const m = useMessages();
  if (providers.length === 0) {
    return null;
  }

  const label = providers.map(providerDisplayName).join(", ");
  const stackLabel = m.settings.skills.providerReach(providers.length, label);
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

/**
 * Per-provider switches for one skill. Rendered inside the row's disclosure so the common
 * case stays a single switch, and the per-provider detail is one click away.
 */
function SkillProviderToggles(props: {
  group: SettingsSkillGroup;
  disabled: DisabledSkillsByProvider;
  onToggle: (targets: ReadonlyArray<SkillToggleTarget>, enabled: boolean) => void;
}) {
  const m = useMessages();
  const { group, disabled, onToggle } = props;
  return (
    <ul className="flex flex-col gap-1.5 pt-2 pl-5">
      {group.providers.map((provider) => {
        const enabled = !isSkillDisabledForProvider(disabled, provider, group.key);
        return (
          <li key={provider} className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <ProviderIcon provider={provider} className="size-3.5 shrink-0" />
              <span className="truncate text-xs text-muted-foreground">
                {providerDisplayName(provider)}
              </span>
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) =>
                onToggle([{ key: group.key, providers: [provider] }], Boolean(checked))
              }
              aria-label={m.settings.skills.enableSkillForProvider(
                group.displayName,
                providerDisplayName(provider),
              )}
            />
          </li>
        );
      })}
    </ul>
  );
}

export function SkillsSettingsPanel() {
  const m = useMessages();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(skillsCatalogQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [expandedSkillKey, setExpandedSkillKey] = useState<string | null>(null);

  const disabled = serverSettingsQuery.data?.skills.disabled;

  const skillGroups = buildSettingsSkillGroups(catalogQuery.data?.skills ?? [], m.settings.skills);
  const skillSections = buildSettingsSkillSections(
    catalogQuery.data?.skills ?? [],
    m.settings.skills,
  );

  // Batched so a provider switch, a row, a section, and the whole catalog all travel the
  // same path: a single settings patch, one optimistic flip, one rollback on failure.
  const setSkillsEnabled = (targets: ReadonlyArray<SkillToggleTarget>, enabled: boolean) => {
    if (targets.length === 0) {
      return;
    }
    // Read through the query cache (not the render closure) so rapid toggles
    // build on each other instead of clobbering the previous patch.
    const latestSettings = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    const currentDisabled = latestSettings?.skills.disabled ?? disabled;
    if (!currentDisabled) {
      return;
    }
    const nextDisabled = nextDisabledSkills(currentDisabled, targets, enabled);
    if (latestSettings) {
      // Optimistic flip; a failed patch invalidates back to the server state.
      queryClient.setQueryData(serverQueryKeys.settings(), {
        ...latestSettings,
        skills: { ...latestSettings.skills, disabled: nextDisabled },
      });
    }
    void ensureNativeApi()
      .server.updateSettings({ skills: { disabled: nextDisabled } })
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
  // A skill counts as enabled while any provider that reaches it still loads it.
  const enabledSkills = disabled
    ? skillGroups.filter(
        (group) => skillToggleState(toggleTargetsForGroups([group]), disabled) !== "none",
      ).length
    : totalSkills;
  const synaraSkillsDir = catalogQuery.data?.synaraSkillsDir;
  const allTargets = toggleTargetsForGroups(skillGroups);
  const allToggleState = disabled ? skillToggleState(allTargets, disabled) : "all";

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
                  onCheckedChange={(checked) => setSkillsEnabled(allTargets, Boolean(checked))}
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
        const sectionTargets = toggleTargetsForGroups(section.groups);
        const sectionToggleState = disabled ? skillToggleState(sectionTargets, disabled) : "all";
        return (
          <SettingsSection
            key={section.key}
            title={section.title}
            action={
              <Switch
                checked={sectionToggleState === "all"}
                indeterminate={sectionToggleState === "partial"}
                onCheckedChange={(checked) => setSkillsEnabled(sectionTargets, Boolean(checked))}
                aria-label={m.settings.skills.toggleSection(section.title)}
              />
            }
          >
            {section.groups.map((group) => {
              const groupTargets = toggleTargetsForGroups([group]);
              const groupState = disabled ? skillToggleState(groupTargets, disabled) : "all";
              const expanded = expandedSkillKey === group.key;
              const expandable = group.providers.length > 1;
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
                        {expandable ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            aria-expanded={expanded}
                            onClick={() => setExpandedSkillKey(expanded ? null : group.key)}
                          >
                            <DisclosureChevron open={expanded} className="size-3" />
                            <SkillProviderStack providers={group.providers} />
                          </button>
                        ) : (
                          <SkillProviderStack providers={group.providers} />
                        )}
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
                      {expandable && disabled ? (
                        <DisclosureRegion open={expanded}>
                          <SkillProviderToggles
                            group={group}
                            disabled={disabled}
                            onToggle={setSkillsEnabled}
                          />
                        </DisclosureRegion>
                      ) : null}
                    </span>
                  }
                  control={
                    <Switch
                      checked={groupState === "all"}
                      indeterminate={groupState === "partial"}
                      onCheckedChange={(checked) =>
                        setSkillsEnabled(groupTargets, Boolean(checked))
                      }
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
