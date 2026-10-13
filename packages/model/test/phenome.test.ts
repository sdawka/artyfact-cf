import { describe, expect, it } from "vitest";
import { PHENOME_LIMITS, PhenomeEventHeader } from "../src/index";

const ok = {
  systemId: "system.peopling",
  thingId: "thing.app",
  artifactId: "artifact.webapp",
  buildId: "0123456789abcdef0123456789abcdef01234567",
  commit: "0123456789abcdef0123456789abcdef01234567",
  emittedAt: "2026-10-12T10:00:00.000Z",
  kind: "journey.step",
  payload: { step: 1 },
};

describe("PhenomeEventHeader", () => {
  it("accepts a minimal event and keeps optional fields", () => {
    expect(PhenomeEventHeader.parse(ok)).toEqual(ok);
    const full = { ...ok, id: "e1", systemCommit: "sc-3", deploymentId: "dep-1", subject: "screen.people", criterion: "C.people.list" };
    expect(PhenomeEventHeader.parse(full)).toEqual(full);
  });

  it("accepts a timestamp with an offset", () => {
    expect(PhenomeEventHeader.safeParse({ ...ok, emittedAt: "2026-10-12T10:00:00+02:00" }).success).toBe(true);
  });

  it.each([
    ["missing systemId", { ...ok, systemId: undefined }],
    ["empty thingId", { ...ok, thingId: "" }],
    ["non-hex commit", { ...ok, commit: "not-a-sha" }],
    ["bad emittedAt", { ...ok, emittedAt: "yesterday" }],
    ["kind with spaces", { ...ok, kind: "journey step" }],
    ["overlong buildId", { ...ok, buildId: "x".repeat(129) }],
    ["numeric subject", { ...ok, subject: 3 }],
  ])("rejects %s", (_name, raw) => {
    expect(PhenomeEventHeader.safeParse(raw).success).toBe(false);
  });

  it("publishes the ingest caps", () => {
    expect(PHENOME_LIMITS).toEqual({ eventBytes: 8192, eventsPerRequest: 100, rowsPerSystem: 5000 });
  });
});
