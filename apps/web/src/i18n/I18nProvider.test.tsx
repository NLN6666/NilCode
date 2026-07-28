import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useMessages } from "./context";
import { I18nProvider } from "./I18nProvider";

function LanguageLabelProbe() {
  const m = useMessages();
  return <span>{m.settings.general.coreDefaults.language.title}</span>;
}

describe("I18nProvider", () => {
  it("serves the catalog for the active locale", () => {
    const english = renderToStaticMarkup(
      <I18nProvider locale="en">
        <LanguageLabelProbe />
      </I18nProvider>,
    );
    expect(english).toContain("Language");

    const chinese = renderToStaticMarkup(
      <I18nProvider locale="zh-CN">
        <LanguageLabelProbe />
      </I18nProvider>,
    );
    expect(chinese).toContain("语言");
  });

  it("falls back to English for consumers rendered outside a provider", () => {
    expect(renderToStaticMarkup(<LanguageLabelProbe />)).toContain("Language");
  });
});
