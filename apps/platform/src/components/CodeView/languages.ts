import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";

/** The CodeMirror language for a path, by extension (yaml, js/jsx/mjs/cjs, ts/tsx/mts/cts, json, md); none otherwise. */
export function languageFor(path: string): Extension | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "yaml":
    case "yml":
      return yaml();
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "markdown":
      return markdown();
    default:
      return null;
  }
}
