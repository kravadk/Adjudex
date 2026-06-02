import { Fragment, type ReactNode } from "react";

// Tiny markdown renderer. Supports:
//   #/##/### headings, **bold**, *italic*, `inline code`, [text](url) links,
//   "- " / "* " bullet lists, "1. " ordered lists, paragraphs split by blank
//   lines. No raw HTML — every block escapes by passing through React's
//   string children, so untrusted strategyText cannot inject script tags.
export function MiniMarkdown({ text }: { text: string }) {
  if (!text?.trim()) return null;
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: paraLines.join(" ") });
  }
  return blocks;
}

function renderBlock(b: Block, key: number): ReactNode {
  if (b.type === "heading") {
    const sz = b.level === 1 ? "text-[15px]" : b.level === 2 ? "text-[14px]" : "text-[13px]";
    return (
      <div
        key={key}
        className={`${sz} font-semibold tracking-tight`}
        style={{ color: "var(--tx)" }}
      >
        {renderInline(b.text)}
      </div>
    );
  }
  if (b.type === "ul") {
    return (
      <ul key={key} className="list-disc list-outside pl-5 space-y-1">
        {b.items.map((it, j) => (
          <li key={j}>{renderInline(it)}</li>
        ))}
      </ul>
    );
  }
  if (b.type === "ol") {
    return (
      <ol key={key} className="list-decimal list-outside pl-5 space-y-1">
        {b.items.map((it, j) => (
          <li key={j}>{renderInline(it)}</li>
        ))}
      </ol>
    );
  }
  return (
    <p key={key} className="leading-relaxed">
      {renderInline(b.text)}
    </p>
  );
}

// Inline tokenizer for **bold**, *italic*, `code`, [text](url).
function renderInline(src: string): ReactNode {
  const tokens: ReactNode[] = [];
  let rest = src;
  let key = 0;
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/;
  while (rest.length) {
    const m = pattern.exec(rest);
    if (!m) {
      tokens.push(<Fragment key={key++}>{rest}</Fragment>);
      break;
    }
    if (m.index > 0) {
      tokens.push(<Fragment key={key++}>{rest.slice(0, m.index)}</Fragment>);
    }
    if (m[1]) {
      tokens.push(
        <strong key={key++} style={{ color: "var(--tx)" }}>
          {m[2]}
        </strong>,
      );
    } else if (m[3]) {
      tokens.push(<em key={key++}>{m[4]}</em>);
    } else if (m[5]) {
      tokens.push(
        <code
          key={key++}
          className="font-mono"
          style={{
            background: "var(--bg-2, #1a1a1a)",
            color: "var(--tx)",
            padding: "0 5px",
            borderRadius: 3,
            fontSize: "0.92em",
          }}
        >
          {m[6]}
        </code>,
      );
    } else if (m[7]) {
      const href = m[9];
      const safe = /^https?:\/\//i.test(href) ? href : "#";
      tokens.push(
        <a
          key={key++}
          href={safe}
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: "var(--accent-bright)" }}
        >
          {m[8]}
        </a>,
      );
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return tokens;
}
