import { fireEvent, screen } from "@testing-library/react";

/** Exercise the visible select trigger and its portaled choices. */
export async function chooseSelect(trigger: HTMLElement, label: string) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}
