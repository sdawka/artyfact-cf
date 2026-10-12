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
}
