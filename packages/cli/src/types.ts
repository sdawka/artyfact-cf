/** Subset of the platform DTOs the CLI reads (see apps/platform/shared/api.ts). Tolerant of both response shapes. */
export interface Packet {
  systemId?: string;
  realizationId?: string;
  evolutionId?: string;
  intent?: string;
  acceptanceCriteria: { id: string; text?: string; gate?: boolean }[];
  permittedPaths: string[];
  protectedPaths: string[];
  commands: string[];
  hash?: string;
  markdown?: string;
  /** Harness-agnostic AGENTS.md block rendered by the platform; preferred over the local fallback renderer. */
  agentsMd?: string;
  /** Present when the realization was started for a Task. */
  task?: { id: string; title?: string; intent?: string; nodes?: string[]; dependsOn?: string[]; independence?: string; wave?: number | null };
  workspace?: { remote?: string; fork?: string; secret?: string };
}

export interface PacketPayload {
  packet: Packet;
  realization?: { id?: string; systemId?: string; workspace?: { repo?: string; fork?: string; tokenExpiresAt?: string } };
  remote?: string;
  systemId?: string;
  token?: { value?: string; expiresAt?: string; remote?: string };
}

export interface EvaluationRow {
  criterion: string;
  verdict: string;
  execution: string;
  hook?: string;
}

export interface ConflictRow {
  kind: string;
  subjects: string[];
  message: string;
  candidates?: string[];
}

/** `.artyfact.json` */
export interface WorkspaceConfig {
  platform: string;
  systemId: string;
  evolutionId: string;
  realizationId: string;
  forkRepo: string;
  remote: string;
  tokenExpires?: string;
  packetHash?: string;
  /** Realization secret for platform calls. The file is mode 0600 and git-excluded. */
  secret?: string;
  /** The Task this workspace was claimed for (`artyfact claim`). */
  taskId?: string;
  /** Fork write token saved by `claim` only (mode 0600, git-excluded); `start` never stores it. `ARTYFACT_TOKEN` overrides it. */
  token?: string;
}

// TODO(contract): mirror of Task, TasksResponse and ClaimTaskResponse in apps/platform/shared/api.ts. The CLI
// package's tsconfig rootDir cannot import that file, so these are local subsets of the wire shapes.
export interface TaskRow {
  id: string;
  evolutionId: string;
  evolutionTitle?: string;
  title?: string;
  status: string;
  wave: number | null;
  dependsOn: string[];
  blockedOn: string[];
  nodes: string[];
  footprint?: { globs?: string[]; paths?: string[]; unmatched?: string[] };
  claim?: { agentLabel: string };
}

export interface TaskConflictRow { kind: string; tasks: [string, string]; subjects: string[]; message: string }

export interface TasksPayload { tasks: TaskRow[]; conflicts: TaskConflictRow[]; waves: Record<string, string[][]> }

export interface ClaimPayload {
  systemId?: string;
  realization: { id: string; evolutionId?: string; workspace?: { fork?: string; tokenExpiresAt?: string } };
  packet: Packet;
  token: { value: string; expiresAt?: string; remote?: string } | null;
  secret: string | null;
  remote?: string;
  task?: { id: string };
  fresh: boolean;
}
