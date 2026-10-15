import { describe, expect, it, vi } from "vitest";
import { verificationModelDigest } from "@artyfact/model";
import { readVerificationGenome } from "../src/verification-artifacts.ts";

const COMMIT = "a".repeat(40);

describe("verification Artifacts model input", () => {
  it("reads the YAML and intent sidecars included in the canonical model digest", async () => {
    const dispose = vi.fn();
    const blobs = new Map([
      ["yaml", "id: system.artyfact\nkind: system\n"],
      ["brief", "# Intent\n"],
      ["manifest", '{"version":1}\n'],
      ["ignored", "not part of the model digest\n"],
    ]);
    const trees = new Map<string, Array<{ name: string; mode: string; type: "blob" | "tree"; hash: string }>>([
      ["root", [{ name: "genome", mode: "040000", type: "tree", hash: "genome-tree" }]],
      ["genome-tree", [
        { name: "node.yaml", mode: "100644", type: "blob", hash: "yaml" },
        { name: "intent", mode: "040000", type: "tree", hash: "intent-tree" },
        { name: "README.md", mode: "100644", type: "blob", hash: "ignored" },
      ]],
      ["intent-tree", [
        { name: "brief.md", mode: "100644", type: "blob", hash: "brief" },
        { name: "manifest.json", mode: "100644", type: "blob", hash: "manifest" },
      ]],
    ]);
    const repository = {
      [Symbol.dispose]: dispose,
      readCommit: async () => ({ hash: COMMIT, treeHash: "root" }),
      readTree: async (hash: string) => trees.get(hash) ?? [],
      readBlob: async (hash: string) => new Blob([blobs.get(hash) ?? ""]),
    };
    const artifacts = { get: async () => repository };
    const files = await readVerificationGenome(artifacts as never, {
      repo: "artyfact",
      commit: COMMIT,
      prefix: "genome",
      digest: "0".repeat(64),
    });

    expect([...files]).toEqual([
      ["intent/brief.md", "# Intent\n"],
      ["intent/manifest.json", '{"version":1}\n'],
      ["node.yaml", "id: system.artyfact\nkind: system\n"],
    ]);
    expect(verificationModelDigest(files)).not.toBe(verificationModelDigest(new Map([["node.yaml", files.get("node.yaml")!]])));
    expect(dispose).toHaveBeenCalledOnce();
  });
});
