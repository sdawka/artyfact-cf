import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { CopyButton } from "./CopyButton";

afterEach(() => vi.unstubAllGlobals());

describe("CopyButton", () => {
  it("announces Copied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
    render(<CopyButton value="screen.people" />);
    act(() => screen.getByRole("button", { name: "Copy screen.people" }).click());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied"));
    expect(screen.getByRole("button").textContent).toBe("Copied");
  });
  it("says when copying failed", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    render(<CopyButton value="x" />);
    act(() => screen.getByRole("button").click());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copy failed"));
  });
});
