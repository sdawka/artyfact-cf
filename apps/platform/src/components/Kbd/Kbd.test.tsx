import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { Kbd, platformKey } from "./Kbd";

const platform = (p: string) => vi.spyOn(navigator, "platform", "get").mockReturnValue(p);
afterEach(() => vi.restoreAllMocks());

describe("Kbd", () => {
  it("maps the command key per platform", () => {
    expect(platformKey("Mod", true)).toBe("⌘");
    expect(platformKey("⌘", false)).toBe("Ctrl");
    expect(platformKey("K", false)).toBe("K");
  });
  it("renders Ctrl+K off Apple platforms and ⌘K on them", () => {
    platform("Linux x86_64");
    const a = render(<Kbd keys={["Mod", "K"]} />);
    expect(a.container.textContent).toBe("Ctrl+K");
    expect(a.container.querySelectorAll("kbd kbd").length).toBe(2);
    a.unmount();
    platform("MacIntel");
    expect(render(<Kbd keys={["Mod", "K"]} />).container.textContent).toBe("⌘K");
  });
  it("sequences read 'g then w'", () => {
    expect(render(<Kbd keys={["g", "w"]} sequence />).container.textContent).toBe("g then w");
  });
});
