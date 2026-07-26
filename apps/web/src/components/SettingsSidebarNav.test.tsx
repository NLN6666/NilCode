// FILE: SettingsSidebarNav.test.tsx
// Purpose: Guards the settings sidebar search surface and its ranking index.
// Layer: Component rendering tests
// Depends on: SettingsSidebarNav, the settings search index, and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { settingRowAnchorId } from "../settingsNavigation";
import {
  SETTINGS_SEARCH_ENTRIES,
  rankSettingsSearchEntries,
  settingsSearchEntryTarget,
} from "../settingsSearchIndex";
import { en } from "../i18n/locales/en";

/** Rank against the real English catalog, matching what the sidebar passes in at runtime. */
const m = en;

describe("rankSettingsSearchEntries", () => {
  it("returns nothing for an empty query", () => {
    expect(rankSettingsSearchEntries("", 12, m)).toHaveLength(0);
    expect(rankSettingsSearchEntries("   ", 12, m)).toHaveLength(0);
  });

  it("ranks an exact title match first", () => {
    const [top] = rankSettingsSearchEntries("theme", 12, m);
    expect(top?.id).toBe("appearance:theme");
  });

  it("matches on description keywords, not just titles", () => {
    const results = rankSettingsSearchEntries("wrap", 12, m);
    expect(results.some((entry) => entry.id === "behavior:diff-line-wrapping")).toBe(true);
  });

  it("includes the activity toasts notification row", () => {
    const results = rankSettingsSearchEntries("toasts", 12, m);
    expect(results.some((entry) => entry.id === "notifications:activity-toasts")).toBe(true);
  });

  it("indexes environment instructions and the system UI font row", () => {
    expect(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["general:environment-instructions", "appearance:system-ui-font"]),
    );
  });

  it("surfaces every row in a section when searching the section label", () => {
    const results = rankSettingsSearchEntries("appearance", SETTINGS_SEARCH_ENTRIES.length, m);
    expect(results.some((entry) => entry.section === "appearance")).toBe(true);
  });

  it("respects the result limit", () => {
    expect(rankSettingsSearchEntries("e", 3, m)).toHaveLength(3);
  });

  it("anchors every row on its id so translation cannot collapse the slug", () => {
    // Ids are locale-independent; a title-derived anchor would slug every Chinese title down to
    // the bare `setting-` prefix and collide.
    const anchored = SETTINGS_SEARCH_ENTRIES.filter((entry) => entry.target !== null);
    expect(anchored.length).toBeGreaterThan(0);

    for (const entry of anchored) {
      expect(settingsSearchEntryTarget(entry)).toBe(settingRowAnchorId(entry.id));
      expect(settingsSearchEntryTarget(entry)?.startsWith("setting-")).toBe(true);
    }
    const targets = anchored.map((entry) => settingsSearchEntryTarget(entry));
    expect(new Set(targets).size).toBe(anchored.length);

    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      if (entry.target === null) expect(settingsSearchEntryTarget(entry)).toBeNull();
    }
  });

  it("resolves every result title from the active catalog", () => {
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(entry.title(m)).not.toBe("");
    }
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
