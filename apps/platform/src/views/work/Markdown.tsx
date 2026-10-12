import type { ReactNode } from "react";
import styles from "./work.module.css";

/** `code`, **bold**; everything else is literal text. Output is React text nodes, never HTML. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("`") ? <code key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</code> : <strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "code"; text: string };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) body.push(lines[i]!);
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ t: "h", level: h[1]!.length, text: h[2]! }); continue; }
    const li = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const kind = li[1] ? "ul" : "ol";
      const prev = blocks.at(-1);
      if (prev && prev.t === kind) prev.items.push(li[3]!);
      else blocks.push({ t: kind, items: [li[3]!] });
      continue;
    }
    if (!line.trim()) continue;
    const prev = blocks.at(-1);
    if (prev?.t === "p") prev.text += ` ${line.trim()}`;
    else blocks.push({ t: "p", text: line.trim() });
  }
  return blocks;
}

/** Small safe markdown renderer for Task Packets: headings, lists, fenced code, `code`, **bold**. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className={styles.markdown}>
      {parse(source).map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case "h": {
            const level = Math.min(6, b.level + 2); // the view owns h1/h2
            const H = `h${level}` as "h3";
            return <H key={k}>{inline(b.text, k)}</H>;
          }
          case "p":
            return <p key={k}>{inline(b.text, k)}</p>;
          case "ul":
            return <ul key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ol>;
          case "code":
            return <pre key={k}><code>{b.text}</code></pre>;
        }
      })}
    </div>
  );
}
