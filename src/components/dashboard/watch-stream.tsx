"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, Minus, Play } from "lucide-react";

type Props = {
  streamUrl: string;
  title?: string;
};

// Floating Watch Stream player. Renders the configured streamUrl in
// an iframe (Twitch/YouTube embed-compatible URLs). The player has
// minimised + full-tab modes and can be collapsed without losing the
// page scroll position.
export function WatchStream({ streamUrl, title }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!streamUrl) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn ghost inline-flex"
        style={{ height: 30, padding: "0 11px", fontSize: 11.5 }}
      >
        <Play className="w-3 h-3" />
        Watch stream
      </button>
    );
  }

  const width = expanded ? 720 : 380;
  const height = expanded ? 405 : 214;
  return (
    <div
      className="fixed z-40 panel"
      style={{
        right: 24,
        bottom: 80,
        width,
        padding: 0,
        borderColor: "var(--line)",
        boxShadow:
          "0 24px 56px -16px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02) inset",
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2 border-b"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: "#ef4444", boxShadow: "0 0 8px #ef4444" }}
        />
        <span
          className="text-[11px] font-mono uppercase tracking-[0.08em] flex-1 truncate"
          style={{ color: "var(--t2)" }}
        >
          {title ?? "Live stream"}
        </span>
        <a
          href={streamUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-grid place-items-center w-6 h-6 rounded-[5px] hover:bg-[#2a2a2a]"
          style={{ color: "var(--t3)" }}
          title="Open in new tab"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-grid place-items-center w-6 h-6 rounded-[5px] hover:bg-[#2a2a2a]"
          style={{ color: "var(--t3)" }}
          title={expanded ? "Shrink" : "Expand"}
        >
          <Maximize2 className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-grid place-items-center w-6 h-6 rounded-[5px] hover:bg-[#2a2a2a]"
          style={{ color: "var(--t3)" }}
          title="Minimise"
        >
          <Minus className="w-3 h-3" />
        </button>
      </div>
      <iframe
        src={streamUrl}
        width={width}
        height={height}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        title={title ?? "Live stream"}
        style={{ display: "block", border: "none" }}
      />
    </div>
  );
}
