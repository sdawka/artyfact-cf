/** Read-only eligibility shared by local coordinator hints and server summaries. */
export interface AvailableTask {
  id: string;
  status: string;
  dependsOn: readonly string[];
  selectedCandidate?: string | null;
  attempts?: readonly { status: string; leaseExpiresAt: string }[];
}
export interface AvailabilityPlan {
  status: string;
  tasks: readonly AvailableTask[];
  analysis?: { conflicts: readonly { tasks: readonly string[] }[] };
}
export type TaskAvailabilityAction = 'claim' | 'resume';
const live = (task: AvailableTask | undefined, now: number): boolean => {
  const last = task?.attempts?.at(-1);
  return !!last && last.status !== 'ended' && Date.parse(last.leaseExpiresAt) > now;
};
/** Dependencies must be selected even for recovery; never offer a second live writer or submitted work. */
export function taskAvailability(plan: AvailabilityPlan, task: AvailableTask, now: number = Date.now()): TaskAvailabilityAction | undefined {
  if (plan.status === 'promoted' || !['pending', 'claimed', 'working'].includes(task.status) || live(task, now)) return undefined;
  if (task.status !== 'pending' && !task.attempts?.length) return undefined;
  const byId = (id: string) => plan.tasks.find(t => t.id === id);
  if (!task.dependsOn.every(id => !!byId(id)?.selectedCandidate)) return undefined;
  if ((plan.analysis?.conflicts ?? []).some(c => c.tasks.includes(task.id) && c.tasks.some(id => id !== task.id && live(byId(id), now)))) return undefined;
  return task.attempts?.length ? 'resume' : 'claim';
}
