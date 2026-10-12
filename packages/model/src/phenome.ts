import { z } from "zod";

// One event a deployed app emits about itself (the Phenome). The platform stamps `seq`, `receivedAt` and the
// realization on ingest; everything here is what the emitter sends.

/** Per-event and per-request caps the ingest route enforces. */
export const PHENOME_LIMITS = { eventBytes: 8 * 1024, eventsPerRequest: 100, rowsPerSystem: 5000 } as const;

const token = (max: number) => z.string().min(1).max(max);
const sha = z.string().regex(/^[0-9a-f]{7,64}$/, "expected a hex commit hash");

export const PhenomeEventHeader = z.object({
  /** Emitter-chosen id; duplicates are dropped on ingest. */
  id: token(128).optional(),
  systemId: token(200),
  thingId: token(200),
  artifactId: token(200),
  /** The app's `BUILD_ID`, which is its commit. */
  buildId: token(128),
  commit: sha,
  systemCommit: token(200).optional(),
  deploymentId: token(200).optional(),
  emittedAt: z.iso.datetime({ offset: true }),
  /** Dotted event kind such as `journey.step` or `criterion.observed`. */
  kind: z.string().regex(/^[A-Za-z][\w.:-]{0,63}$/, "expected a dotted event kind"),
  subject: token(200).optional(),
  criterion: token(200).optional(),
  payload: z.unknown(),
});
export type PhenomeEventHeader = z.infer<typeof PhenomeEventHeader> & { payload: unknown };
