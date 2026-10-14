import { describe, expect, it } from "vitest";
import { readIntentSources } from "../src/index";

const HASH = `sha256:${"a".repeat(64)}`;
const manifest = (path = "docs/design.md") => JSON.stringify({
  version: 1,
  nodes: [{ nodeId: "system.example", briefSections: ["Outcome"], documents: [{ path, hash: HASH }] }],
});

describe("readIntentSources", () => {
  it("rejects duplicate JSON keys instead of accepting the last value", () => {
    const sources = readIntentSources({ "intent/manifest.json": '{"version":1,"version":1,"nodes":[]}' });

    expect(sources.fidelity).toBe("invalid");
    expect(sources.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-key", path: "intent/manifest.json", severity: "blocked" }),
    ]));
  });

  it.each(["/etc/passwd", "C:/secret.md", "file:/Users/me/secret.md", "../secret.md", "docs/../secret.md", "docs\\secret.md", "./docs.md", "docs/line\nbreak.md"])(
    "rejects unsafe document reference %s",
    (path) => {
      const sources = readIntentSources({ "intent/brief.md": "hello", "intent/manifest.json": manifest(path) });

      expect(sources.fidelity).toBe("invalid");
      expect(sources.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsafe-path" })]));
    },
  );

  it("enforces sidecar limits in UTF-8 bytes", () => {
    const sources = readIntentSources({
      "intent/brief.md": "💡".repeat(16 * 1024 + 1),
      "intent/manifest.json": manifest(),
    });

    expect(sources.fidelity).toBe("invalid");
    expect(sources.issues).toContainEqual(expect.objectContaining({ code: "limit", path: "intent/brief.md" }));
  });

  it("preserves exact brief bytes while hashing equivalent manifest meaning canonically", () => {
    const first = readIntentSources({ "intent/brief.md": "hello", "intent/manifest.json": manifest() });
    const reordered = readIntentSources({
      "intent/brief.md": "hello",
      "intent/manifest.json": `{"nodes":[{"documents":[{"hash":"${HASH}","path":"docs/design.md"}],"briefSections":["Outcome"],"nodeId":"system.example"}],"version":1}`,
    });

    expect(first.fidelity).toBe("unchecked");
    expect(first.brief).toBe("hello");
    expect(first.briefHash).toBe("sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(reordered.manifestHash).toBe(first.manifestHash);
    expect(reordered.hash).toBe(first.hash);
    expect(first.documents).toEqual([{ path: "docs/design.md", declaredHash: HASH, status: "declared" }]);
  });

  it("verifies referenced document bytes when present and blocks a hash mismatch", () => {
    const verified = readIntentSources({ "intent/brief.md": "hello", "intent/manifest.json": JSON.stringify({
      version: 1,
      nodes: [{ nodeId: "system.example", briefSections: ["Outcome"], documents: [{ path: "docs/design.md", hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }] }],
    }), "docs/design.md": "hello" });
    const mismatched = readIntentSources({ "intent/brief.md": "hello", "intent/manifest.json": manifest(), "docs/design.md": "hello" });

    expect(verified.documents).toEqual([expect.objectContaining({ status: "verified", actualHash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" })]);
    expect(mismatched.fidelity).toBe("invalid");
    expect(mismatched.documents).toEqual([expect.objectContaining({ status: "mismatch" })]);
  });

  it("labels absent legacy sidecars as unchecked fidelity without a blocker", () => {
    const sources = readIntentSources({ "node.yaml": "id: system.legacy" });

    expect(sources.fidelity).toBe("missing");
    expect(sources.issues).toEqual([
      expect.objectContaining({ code: "missing", path: "intent/brief.md", severity: "review" }),
      expect.objectContaining({ code: "missing", path: "intent/manifest.json", severity: "review" }),
    ]);
  });
});
