import { useInRouterContext } from "react-router";
import { kindColour, titleOf, useKindViews } from "@/model/kinds";
import { useModelOptional } from "@/model/useModel";
import { useSelection } from "@/model/useSelection";
import styles from "./NodeChip.module.css";

export interface NodeChipProps {
  /** Any model id; unknown ids render as their id with kind "Unknown". */
  id: string;
  /** Overrides the model name. */
  label?: string;
  /** Overrides the model kind (for objects outside the index, e.g. realizations). */
  kind?: string;
  /** Show the id in code type after the name. */
  showId?: boolean;
  size?: "sm" | "md";
  /** Click handler; defaults to focusing the node (opens the Inspector). */
  onSelect?: (id: string) => void;
  /** `false` renders static text (no button, no brackets). */
  interactive?: boolean;
  className?: string;
}

/** Glyph + name for any model object. Clicking focuses it unless `interactive={false}`. */
export function NodeChip(props: NodeChipProps) {
  const inRouter = useInRouterContext();
  if (props.interactive === false || props.onSelect || !inRouter) return <Chip {...props} />;
  return <FocusChip {...props} />;
}

function FocusChip(props: NodeChipProps) {
  const { setFocus } = useSelection();
  return <Chip {...props} onSelect={(id) => setFocus(id)} />;
}

function Chip({ id, label, kind, showId, size = "md", onSelect, interactive, className }: NodeChipProps) {
  const entry = useModelOptional()?.byId(id);
  const info = useKindViews().of(kind ?? entry?.kind ?? "unknown");
  const name = label ?? (entry ? titleOf(entry, info) : id);
  const content = (
    <>
      <span className={styles.glyph} style={kindColour(info)} aria-hidden="true">{info.glyph}</span>
      <span className={styles.name}>{name}</span>
      {showId && name !== id && <code className={styles.id}>{id}</code>}
      <span className="sr-only">, {info.label}</span>
    </>
  );
  const cls = [styles.chip, styles[size], className].filter(Boolean).join(" ");
  if (interactive === false || !onSelect) {
    return <span className={cls} title={`${info.label}: ${id}`} data-kind={info.kind}>{content}</span>;
  }
  return (
    <button
      type="button"
      className={`u-brackets ${cls} ${styles.button}`}
      title={`${info.label}: ${id}`}
      data-kind={info.kind}
      onClick={() => onSelect(id)}
    >
      {content}
    </button>
  );
}
