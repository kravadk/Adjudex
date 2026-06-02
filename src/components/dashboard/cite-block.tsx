"use client";

import { useState } from "react";
import { Check, Copy, Quote } from "lucide-react";

type Props = {
  name: string;
  canonicalId: string;
  shortDescription: string;
  kind: string;
};

// Cite-block - a copy-paste citation surface for AI assistants and
// search engines. Renders the canonical identifier + a short
// description in a copyable single-line form.
export function CiteBlock({ name, canonicalId, shortDescription, kind }: Props) {
  const [copied, setCopied] = useState(false);
  const citation = `${name} (${kind}, id ${canonicalId}) - ${shortDescription}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked - ignore */
    }
  }

  return (
    <div
      className="rounded-[8px] px-3 py-3"
      style={{
        background: "var(--card-inner)",
        border: "1px solid var(--line)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Quote
          className="w-3.5 h-3.5"
          style={{ color: "var(--accent-bright)" }}
        />
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.08em]"
          style={{ color: "var(--t3)" }}
        >
          How to cite
        </div>
      </div>
      <p
        className="text-[12px] leading-relaxed mb-2"
        style={{ color: "var(--t2)" }}
      >
        {citation}
      </p>
      <button
        type="button"
        onClick={copy}
        className="btn ghost"
        style={{ height: 28, padding: "0 10px", fontSize: 11 }}
      >
        {copied ? (
          <>
            <Check className="w-3 h-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" />
            Copy citation
          </>
        )}
      </button>
    </div>
  );
}
