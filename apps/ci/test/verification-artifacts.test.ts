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

  it("reads a large Genome concurrently, bounded, with the same sorted output and first error every time", async () => {
    type Entry = { name: string; mode: string; type: "blob" | "tree"; hash: string };
    const trees = new Map<string, Entry[]>(), blobs = new Map<string, string>();
    const expected: [string, string][] = [];
    // 30 sections x 20 nodes, listed in reverse so tree order differs from sorted order.
    trees.set("root", [{ name: "node.yaml", mode: "100644", type: "blob", hash: "root.yaml" }]);
    blobs.set("root.yaml", "id: system.big\n");
    expected.push(["node.yaml", "id: system.big\n"]);
    for (let s = 29; s >= 0; s--) {
      const section = `section.${String(s).padStart(2, "0")}`;
      trees.get("root")!.push({ name: section, mode: "040000", type: "tree", hash: section });
      trees.set(section, []);
      for (let n = 19; n >= 0; n--) {
        const name = `node.${String(n).padStart(2, "0")}`, hash = `${section}/${name}`;
        trees.get(section)!.push({ name, mode: "040000", type: "tree", hash });
        trees.set(hash, [{ name: "node.yaml", mode: "100644", type: "blob", hash: `${hash}.yaml` }]);
        blobs.set(`${hash}.yaml`, `id: ${name}\n`);
        expected.push([`${hash}/node.yaml`, `id: ${name}\n`]);
      }
    }
    expected.sort(([a], [b]) => (a < b ? -1 : 1));
    let inFlight = 0, peak = 0;
    const slow = async <T>(value: T): Promise<T> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((done) => setTimeout(done, Math.random() * 3));
      inFlight -= 1;
      return value;
    };
    const read = (oversized: string[] = []) => readVerificationGenome({
      get: async () => ({
        readCommit: async () => ({ hash: COMMIT, treeHash: "root" }),
        readTree: (hash: string) => slow(trees.get(hash) ?? null),
        readBlob: (hash: string) => slow(new Blob([oversized.includes(hash) ? "x".repeat(1_000_001) : blobs.get(hash)!])),
      }),
    } as never, { repo: "big", commit: COMMIT, prefix: "", digest: "0".repeat(64) });

    const first = await read(), second = await read();
    expect([...first]).toEqual(expected);
    expect([...second]).toEqual(expected);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(16);
    // Two oversized files: the error always names the first in sorted order.
    for (let i = 0; i < 3; i++) {
      await expect(read(["section.29/node.00.yaml", "section.03/node.19.yaml"])).rejects.toThrow("Genome file section.03/node.19/node.yaml exceeds 1000000 bytes");
    }
  });

  it("reserves text bytes before reading and starts no reads once the budget is exceeded", async () => {
    const trees = new Map<string, { name: string; mode: string; type: "blob" | "tree"; hash: string }[]>();
    trees.set("root", [{ name: "node.yaml", mode: "100644", type: "blob", hash: "root" }]);
    for (let i = 0; i < 60; i++) trees.get("root")!.push({ name: `part.${String(i).padStart(2, "0")}.yaml`, mode: "100644", type: "blob", hash: `part.${i}` });
    const big = "x".repeat(900_000);
    for (let run = 0; run < 3; run++) {
      let textBytes = 0, blobReads = 0;
      const repository = {
        readCommit: async () => ({ hash: COMMIT, treeHash: "root" }),
        readTree: async (hash: string) => trees.get(hash) ?? null,
        readBlob: async (hash: string) => {
          blobReads += 1;
          await new Promise((done) => setTimeout(done, Math.random() * 3));
          const content = hash === "root" ? "id: system.big\n" : big;
          return { size: content.length, text: async () => { textBytes += content.length; return content; } };
        },
      };
      await expect(readVerificationGenome({ get: async () => repository } as never, { repo: "big", commit: COMMIT, prefix: "", digest: "0".repeat(64) }))
        .rejects.toThrow("Genome YAML exceeds 1000000 bytes");
      expect(textBytes).toBeLessThanOrEqual(1_000_000 + 64 * 1024 + 128 * 1024);
      // The first 16 start together; once a reservation fails, finishing workers start nothing new.
      expect(blobReads).toBeLessThan(16 + 3);
    }
  });
});
