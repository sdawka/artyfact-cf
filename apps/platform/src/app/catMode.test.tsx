import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { testQueryClient } from "@/testing/render";
import { CatModeRoot } from "./catMode";

describe("CatModeRoot", () => {
  it("marks the root element only while the flag is on, and clears it on unmount", () => {
    const qc = testQueryClient();
    qc.setQueryData(qk.platform(), { hostedDemo: false, catMode: true });
    const view = render(<QueryClientProvider client={qc}><CatModeRoot /></QueryClientProvider>);
    expect(document.documentElement.dataset.catMode).toBe("on");
    view.unmount();
    expect(document.documentElement.dataset.catMode).toBeUndefined();
    const off = testQueryClient();
    off.setQueryData(qk.platform(), { hostedDemo: false, catMode: false });
    render(<QueryClientProvider client={off}><CatModeRoot /></QueryClientProvider>);
    expect(document.documentElement.dataset.catMode).toBeUndefined();
  });
});
