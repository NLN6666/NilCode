// FILE: SettingsSidebarNav.test.tsx
// Purpose: Guards the settings sidebar search surface and its ranking index.
// Layer: Component rendering tests
// Depends on: SettingsSidebarNav, the settings search index, and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { settingRowAnchorId, type SettingsSectionId } from "../settingsNavigation";
import {
  SETTINGS_SEARCH_ENTRIES,
  rankSettingsSearchEntries,
  settingsSearchEntryTarget,
} from "../settingsSearchIndex";
import { en } from "../i18n/locales/en";

/** Rank against the real English labels, matching what the sidebar passes in at runtime. */
const sectionLabel = (section: SettingsSectionId) => en.settingsNav.sections[section].label;

describe("rankSettingsSearchEntries", () => {
  it("returns nothing for an empty query", () => {
    expect(rankSettingsSearchEntries("", 12, sectionLabel)).toHaveLength(0);
    expect(rankSettingsSearchEntries("   ", 12, sectionLabel)).toHaveLength(0);
  });

  it("ranks an exact title match first", () => {
    const [top] = rankSettingsSearchEntries("theme", 12, sectionLabel);
    expect(top?.id).toBe("appearance:theme");
  });

  it("matches on description keywords, not just titles", () => {
    const results = rankSettingsSearchEntries("wrap", 12, sectionLabel);
    expect(results.some((entry) => entry.id === "behavior:diff-line-wrapping")).toBe(true);
  });

  it("includes the activity toasts notification row", () => {
    const results = rankSettingsSearchEntries("toasts", 12, sectionLabel);
    expect(results.some((entry) => entry.id === "notifications:activity-toasts")).toBe(true);
  });

  it("indexes environment instructions and the system UI font row", () => {
    expect(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["general:environment-instructions", "appearance:system-ui-font"]),
    );
  });

  it("surfaces every row in a section when searching the section label", () => {
    const results = rankSettingsSearchEntries(
      "appearance",
      SETTINGS_SEARCH_ENTRIES.length,
      sectionLabel,
    );
    expect(results.some((entry) => entry.section === "appearance")).toBe(true);
  });

  it("respects the result limit", () => {
    expect(rankSettingsSearchEntries("e", 3, sectionLabel)).toHaveLength(3);
  });

  it("derives a deep-link anchor target from each entry's title", () => {
    // A row still rendering its English title; migrated rows anchor on their id instead.
    const toastsEntry = SETTINGS_SEARCH_ENTRIES.find(
      (entry) => entry.id === "notifications:activity-toasts",
    )!;
    expect(toastsEntry.localizedTitle).toBeUndefined();
    expect(settingsSearchEntryTarget(toastsEntry)).toBe("setting-activity-toasts");
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      if (entry.target === null) {
        expect(settingsSearchEntryTarget(entry)).toBeNull();
      } else if (!entry.localizedTitle) {
        expect(settingsSearchEntryTarget(entry)).toBe(settingRowAnchorId(entry.title));
        expect(settingsSearchEntryTarget(entry)?.startsWith("setting-")).toBe(true);
      }
    }
  });

  it("anchors localized-title rows on their id so translation cannot collapse the slug", () => {
    const localized = SETTINGS_SEARCH_ENTRIES.filter((entry) => entry.localizedTitle);
    expect(localized.length).toBeGreaterThan(0);

    // Ids are locale-independent, so these anchors survive translation; a title-derived anchor
    // would slug every Chinese title down to the bare `setting-` prefix and collide.
    for (const entry of localized) {
      expect(settingsSearchEntryTarget(entry)).toBe(settingRowAnchorId(entry.id));
    }
    const targets = localized.map((entry) => settingsSearchEntryTarget(entry));
    expect(new Set(targets).size).toBe(localized.length);
  });
});

describe("SettingsSidebarNav", () => {
  it("renders the soft search input alongside the section list", () => {
    const markup = renderToStaticMarkup(
      <SettingsSidebarNav activeSection="general" onBack={vi.fn()} onSelectSection={vi.fn()} />,
    );

    expect(markup).toContain('aria-label="Search settings"');
    expect(markup).toContain('aria-label="Settings sections"');
    expect(markup).toContain("Back to app");
  });
});
