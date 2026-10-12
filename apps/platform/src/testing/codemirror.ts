import { EditorView } from "@codemirror/view";
import { act } from "@testing-library/react";

function editorIn(root: ParentNode): EditorView {
  const el = root.querySelector<HTMLElement>(".cm-editor");
  const view = el && EditorView.findFromDOM(el);
  if (!view) throw new Error("No CodeMirror editor found");
  return view;
}

/** The text of the first CodeMirror editor under `root`. */
export function editorText(root: ParentNode = document): string {
  return editorIn(root).state.doc.toString();
}

/** Types `text` at the end of the first editor under `root`, as user input. Throws if the editor is read-only. */
export function typeInEditor(root: ParentNode, text: string) {
  const view = editorIn(root);
  if (view.state.readOnly) throw new Error("The editor is read-only");
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

/** Replaces the whole document of the first editor under `root`, as user input. */
export function replaceEditorText(root: ParentNode, text: string) {
  const view = editorIn(root);
  if (view.state.readOnly) throw new Error("The editor is read-only");
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}
