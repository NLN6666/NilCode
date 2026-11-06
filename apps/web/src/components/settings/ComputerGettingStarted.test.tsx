import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComputerGettingStarted } from "./ComputerGettingStarted";

const storage = vi.hoisted(() => ({ acknowledged: false, write: vi.fn() }));
vi.mock("~/hooks/useLocalStorage", () => ({
  useLocalStorage: () => [storage.acknowledged, storage.write],
}));

afterEach(() => {
  storage.acknowledged = false;
  storage.write.mockReset();
});

describe("ComputerGettingStarted", () => {
  it("opens the three-step guide without showing a modal or writing acknowledgement", () => {
    const markup = renderToStaticMarkup(<ComputerGettingStarted appSnapAvailable={true} />);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('id="setting-ask-for-a-task"');
    expect(markup).toContain('id="setting-approve-the-task"');
    expect(markup).toContain('id="setting-follow-and-stop"');
    expect(markup).not.toContain('inert=""');
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain('role="dialog"');
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("keeps an acknowledged guide collapsed but available to reopen", () => {
    storage.acknowledged = true;
    const markup = renderToStaticMarkup(<ComputerGettingStarted appSnapAvailable={false} />);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
  });
});
