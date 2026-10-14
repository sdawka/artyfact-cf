import { StatusChip } from "@/components/StatusChip/StatusChip";
import { TASK_GLYPH, type TaskDisplayStatus } from "./lib";

/**
 * Task status chip: glyph + word. Blocked (waits on a dependency's selection) and submitted (waits on a person to select)
 * use the attention tone; nothing here is ever pass.
 */
export function TaskStatus({ status, title }: { status: TaskDisplayStatus; title?: string }) {
  const tone = status === "blocked" || status === "submitted" ? "attention" : "neutral";
  return <StatusChip status={status} glyph={TASK_GLYPH[status]} tone={tone} {...(title && { title })} />;
}
