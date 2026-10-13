export interface Mutation { name: string; ops: { op: "set" | "push" | "remove" | "dup"; path: unknown[]; value?: unknown }[] }
export function applyMutation<T>(snapshot: T, mutation: Mutation): T;
