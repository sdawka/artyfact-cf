import { StatusText } from "@/components/StatusText/StatusText";
import { TASK_GLYPH, type TaskDisplayStatus } from "./lib";

/**
 * Task status in a row: glyph + word. Only submitted (waits on a person to
 * select) is attention; blocked waits on another Task and stays neutral.
 */
export function TaskStatus({ status, title }: { status: TaskDisplayStatus; title?: string }) {
  const tone = status === "submitted" ? "attention" : "neutral";
  return <StatusText status={status} glyph={TASK_GLYPH[status]} tone={tone} {...(title && { title })} />;
}
