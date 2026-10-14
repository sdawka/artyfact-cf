import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_TOKEN_KEY } from "@/api/adminToken";
import { AdminTokenControl } from "./AdminTokenControl";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("AdminTokenControl", () => {
  it("dismisses outside the token panel without saving the draft", async () => {
    render(<><AdminTokenControl /><button>Outside</button></>);
    fireEvent.click(screen.getByRole("button", { name: /Admin token/ }));
    fireEvent.change(screen.getByLabelText("Token for admin actions"), { target: { value: "unsaved" } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Admin token" })).toBeNull());
    expect(sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it("saves the token, shows 'Admin: set', and Forget clears it", () => {
    render(<AdminTokenControl />);
    const button = screen.getByRole("button", { name: /Admin token/ });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Admin token" });
    const input = screen.getByLabelText("Token for admin actions") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "adm_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBe("adm_1");
    const set = screen.getByRole("button", { name: /Admin: set/ });
    expect(document.activeElement).toBe(set);
    expect(dialog.isConnected).toBe(false);
    fireEvent.click(set);
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: /Admin token/ })).toBeTruthy();
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<AdminTokenControl />);
    const button = screen.getByRole("button", { name: /Admin token/ });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("Token for admin actions"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
