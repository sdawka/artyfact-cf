import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** Editor chrome from theme tokens only (dark). */
export const codeTheme = EditorView.theme(
  {
    "&": {
      color: "var(--color-text-primary)",
      backgroundColor: "var(--color-surface-primary)",
      fontSize: "var(--font-size-sm)",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "var(--border-radius-md)",
    },
    "&.cm-focused": { outline: "var(--focus-ring)", outlineOffset: "2px" },
    ".cm-scroller": { fontFamily: "var(--font-code)", lineHeight: "1.5" },
    ".cm-content": { caretColor: "var(--color-brand-primary)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-brand-primary)" },
    ".cm-gutters": {
      color: "var(--color-text-subtle)",
      backgroundColor: "var(--color-surface-primary)",
      borderRight: "1px solid var(--color-border-subtle)",
    },
    ".cm-activeLine": { backgroundColor: "var(--color-surface-secondary)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--color-surface-secondary)", color: "var(--color-text-secondary)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-primary-light)" },
    ".cm-matchingBracket": { outline: "1px solid var(--color-border)" },
  },
  { dark: true },
);

/** Token colours: theme tokens only, never the success colour (it is reserved for pass). */
export const codeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--color-brand-primary)" },
    { tag: [t.string, t.special(t.string)], color: "var(--color-status-info)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--color-semantic-error)" },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--color-text-primary)", fontWeight: "600" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--color-text-subtle)", fontStyle: "italic" },
    { tag: [t.heading], color: "var(--color-brand-primary)", fontWeight: "600" },
    { tag: [t.link, t.url], color: "var(--color-status-info)", textDecoration: "underline" },
    { tag: [t.typeName, t.className], color: "var(--color-text-secondary)" },
    { tag: [t.punctuation, t.bracket, t.separator], color: "var(--color-text-secondary)" },
  ]),
);
