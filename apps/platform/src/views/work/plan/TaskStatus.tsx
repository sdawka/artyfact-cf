import { StatusText } from "@/components/StatusText/StatusText";
import { TASK_GLYPH, type TaskDisplayStatus } from "./lib";

/**
 * Task status in a row: glyph + word. Blocked (waits on a dependency's selection) and submitted (waits on a person to
 * select) use the attention tone; nothing here is ever pass.
 */
export function TaskStatus({ status, title }: { status: TaskDisplayStatus; title?: string }) {
  const tone = status === "blocked" || status === "submitted" ? "attention" : "neutral";
  return <StatusText status={status} glyph={TASK_GLYPH[status]} tone={tone} {...(title && { title })} />;
}
