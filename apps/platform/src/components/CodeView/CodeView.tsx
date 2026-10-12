import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { languageFor } from "./languages";
import { codeHighlight, codeTheme } from "./theme";
import styles from "./CodeView.module.css";

export interface CodeViewProps {
  value: string;
  /** Picks the language by extension. */
  path: string;
  /** Accessible name of the editor. */
  label: string;
  readOnly?: boolean;
  onChange?(value: string): void;
}

/** The `basicSetup` subset: line numbers, folding, history, bracket matching, active line, Tab indents. */
const base: Extension = [
  lineNumbers(),
  foldGutter(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  codeTheme,
  codeHighlight,
];

/** Marks the transactions that sync the `value` prop in, so they never echo back through `onChange`. */
const fromProps = Annotation.define<boolean>();

const editability = (readOnly: boolean): Extension => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  // tabindex keeps read-only content (contenteditable=false) keyboard reachable for reading and scrolling.
  EditorView.contentAttributes.of({ "aria-readonly": String(readOnly), tabindex: "0" }),
];

/**
 * CodeMirror 6 editor. Read-only sets `EditorState.readOnly`, `editable(false)` and `aria-readonly`.
 * Import it with `lazy()` so CodeMirror stays out of the main chunk.
 */
export default function CodeView({ value, path, label, readOnly = false, onChange }: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const edit = useRef(new Compartment());
  const lang = useRef(new Compartment());
  const aria = useRef(new Compartment());

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          base,
          lang.current.of(languageFor(path) ?? []),
          edit.current.of(editability(readOnly)),
          aria.current.of(EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true" })),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromProps))) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; the effects below keep it in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: edit.current.reconfigure(editability(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageFor(path) ?? []) });
  }, [path]);

  useEffect(() => {
    view.current?.dispatch({ effects: aria.current.reconfigure(EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true" })) });
  }, [label]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: fromProps.of(true) });
  }, [value]);

  return <div ref={host} className={styles.host} data-codeview data-readonly={readOnly || undefined} />;
}
