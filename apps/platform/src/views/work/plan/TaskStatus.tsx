import { StatusChip } from "@/components/StatusChip/StatusChip";
import { TASK_GLYPH, type TaskDisplayStatus } from "./lib";

/** Task status chip: glyph + word. Blocked is attention (it waits on a person to promote its dependency); nothing here is ever pass. */
export function TaskStatus({ status, title }: { status: TaskDisplayStatus; title?: string }) {
  const tone = status === "blocked" || status === "claimed" ? "attention" : status === "rejected" ? "fail" : "neutral";
  return <StatusChip status={status} glyph={TASK_GLYPH[status]} tone={tone} {...(title && { title })} />;
}
