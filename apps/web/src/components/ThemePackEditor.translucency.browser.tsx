import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { t } from "~/i18n";

// A see-through desktop window: macOS vibrancy by default, Hyprland's compositor blur on demand.
const windowTranslucency = vi.hoisted(() => ({ current: "native" as "native" | "compositor" }));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/lib/desktopWindowTranslucency", () => ({
  readDesktopWindowTranslucency: () => windowTranslucency.current,
}));

import { ThemePackEditor } from "./ThemePackEditor";
import { DEFAULT_THEME_STATE, parseStoredThemeState } from "~/theme/theme.logic";

const root = document.documentElement;
const setWindowMaterial = vi.fn(async () => true);
let previousTheme: string | null;

beforeEach(() => {
  previousTheme = localStorage.getItem("synara:theme");
  windowTranslucency.current = "native";
  setWindowMaterial.mockClear();
  window.desktopBridge = {
    setTheme: async () => {},
    setWindowMaterial,
  } as unknown as NonNullable<typeof window.desktopBridge>;
});

afterEach(() => {
  delete (window as { desktopBridge?: unknown }).desktopBridge;
  if (previousTheme === null) localStorage.removeItem("synara:theme");
  else localStorage.setItem("synara:theme", previousTheme);
  window.dispatchEvent(new StorageEvent("storage", { key: "synara:theme" }));
});

// Playwright cannot fill range inputs; drive them the way a drag does, through React's
// value tracker and a native input event.
function setSliderValue(label: string, value: number) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing slider ${label}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    input,
    String(value),
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("tunes opacity, desktop blur, and scope, then switches to a solid window", async () => {
  localStorage.setItem("synara:theme", JSON.stringify({ ...DEFAULT_THEME_STATE, mode: "dark" }));
  await render(<ThemePackEditor variant="dark" />);
  await expect.poll(() => root.getAttribute("data-window-material")).toBe("translucent");
  await expect.poll(() => root.getAttribute("data-window-translucency")).toBe("window");

  const darkTheme = t("common:darkTheme");
  const opacityLabel = t("common:translucencyOpacity", { value0: darkTheme });
  const blurLabel = t("common:backgroundBlur", { value0: darkTheme });
  const sidebarOnlyLabel = t("common:translucentSidebarOnly", { value0: darkTheme });
  const opacity = page.getByRole("slider", { name: opacityLabel });
  const blur = page.getByRole("slider", { name: blurLabel });
  await expect.element(opacity).toHaveValue("90");
  await expect.element(blur).toHaveValue("64");
  const sidebarOnly = page.getByRole("switch", { name: sidebarOnlyLabel });
  await expect.element(sidebarOnly).not.toBeChecked();
  await expect
    .poll(() => setWindowMaterial.mock.lastCall)
    .toEqual([{ material: "translucent", blurRadius: 64 }]);

  await sidebarOnly.click();
  await expect.poll(() => root.getAttribute("data-window-translucency")).toBe("sidebar");

  // Both sliders stop at a floor: no fill over no blur would leave a see-through window.
  setSliderValue(opacityLabel, 0);
  setSliderValue(blurLabel, 0);
  await expect
    .poll(() => root.style.getPropertyValue("--app-sidebar-surface"))
    .toMatch(/ 15%, transparent\)$/);

  await page.getByRole("switch", { name: sidebarOnlyLabel }).click();
  await expect.poll(() => root.getAttribute("data-window-translucency")).toBe("window");
  await expect
    .poll(() => root.style.getPropertyValue("--app-window-background"))
    .toMatch(/ 15%, transparent\)$/);
  // The coat has to actually paint on the body, not only exist as a variable.
  const bodyAlpha = () =>
    Number(getComputedStyle(document.body).backgroundColor.match(/[\d.]+(?=\)$)/)?.[0]);
  await expect.poll(bodyAlpha).toBeCloseTo(0.15, 2);
  setSliderValue(opacityLabel, 60);
  await expect.poll(bodyAlpha).toBeCloseTo(0.6, 2);
  await expect
    .poll(() => setWindowMaterial.mock.lastCall)
    .toEqual([{ material: "translucent", blurRadius: 1 }]);
  expect(parseStoredThemeState(localStorage.getItem("synara:theme")).translucency.dark).toEqual({
    opacity: 60,
    blur: 1,
    sidebarOnly: false,
  });

  await page
    .getByRole("button", {
      name: t("common:automaticBackgroundBlur", { value0: darkTheme }),
    })
    .click();
  await expect
    .poll(() => setWindowMaterial.mock.lastCall)
    .toEqual([{ material: "opaque", blurRadius: 0 }]);
  expect(
    parseStoredThemeState(localStorage.getItem("synara:theme")).translucency.dark.blur,
  ).toBeNull();

  await page.getByRole("radio", { name: t("common:solid") }).click();
  await expect.poll(() => root.getAttribute("data-window-material")).toBe("opaque");
  expect(root.getAttribute("data-window-translucency")).toBe("none");
  await expect
    .poll(() => setWindowMaterial.mock.lastCall)
    .toEqual([{ material: "opaque", blurRadius: 0 }]);
  await expect.element(opacity).not.toBeInTheDocument();
});

it("leaves the blur to Hyprland on a compositor-blurred window", async () => {
  windowTranslucency.current = "compositor";
  localStorage.setItem("synara:theme", JSON.stringify({ ...DEFAULT_THEME_STATE, mode: "dark" }));
  window.dispatchEvent(new StorageEvent("storage", { key: "synara:theme" }));
  await render(<ThemePackEditor variant="dark" />);
  await expect.poll(() => root.getAttribute("data-window-material")).toBe("translucent");
  await expect.poll(() => root.getAttribute("data-window-translucency")).toBe("window");
  await expect.element(page.getByText(t("settings:compositorControlsBlur"))).toBeInTheDocument();
  await expect
    .element(
      page.getByRole("slider", {
        name: t("common:backgroundBlur", { value0: t("common:darkTheme") }),
      }),
    )
    .not.toBeInTheDocument();
  // Opacity still drives the CSS coat over the compositor blur.
  setSliderValue(t("common:translucencyOpacity", { value0: t("common:darkTheme") }), 60);
  await expect
    .poll(() => root.style.getPropertyValue("--app-window-background"))
    .toMatch(/ 60%, transparent\)$/);
  expect(setWindowMaterial).not.toHaveBeenCalled();
});
