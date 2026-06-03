"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { useWallet } from "@/lib/hooks/useWallet";
import { showToast } from "./toast";

// Market discussion thread. Public read; SIWE-gated post/delete. Backed by
// /api/markets/:id/comments (GET/POST) and /api/comments/:id (DELETE).
// Session cookie is sent automatically by the browser — no extra headers.

type Comment = {
  id: string;
  author: string;
  authorShort: string;
  body: string;
  createdAtIso: string;
};

const MAX_LEN = 2000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MarketComments({ marketId }: { marketId: string }) {
  const { account } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}/comments`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`comments_${res.status}`);
      const rows = (await res.json()) as Comment[];
      setComments(Array.isArray(rows) ? rows : []);
    } catch {
      // leave existing list; surface nothing noisy on a read failure
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    // Standard fetch-on-mount lifecycle; load() drives loading -> data state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (res.status === 401) {
        showToast({ kind: "error", title: "Sign in required", body: "Connect your wallet to comment." });
        return;
      }
      if (!res.ok) throw new Error(`post_${res.status}`);
      const created = (await res.json()) as Comment;
      setComments((prev) => [created, ...prev]);
      setBody("");
    } catch {
      showToast({ kind: "error", title: "Comment failed", body: "Could not post your comment." });
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`del_${res.status}`);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      showToast({ kind: "error", title: "Delete failed", body: "Could not remove the comment." });
    }
  }

  const mine = account?.address?.toLowerCase();

  return (
    <section
      className="rounded-[16px] p-4"
      style={{ background: "var(--panel-bg)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4" style={{ color: "var(--accent-bright)" }} />
        <h3 className="text-[14px] font-bold" style={{ color: "var(--tx)" }}>
          Discussion
        </h3>
        <span className="text-[12px] font-mono" style={{ color: "var(--t3)" }}>
          {comments.length}
        </span>
      </div>

      <div className="mb-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_LEN))}
          placeholder={account ? "Share your read on this market…" : "Connect wallet to comment"}
          disabled={!account || posting}
          rows={2}
          className="w-full resize-none rounded-[10px] px-3 py-2 text-[13px] outline-none disabled:opacity-50"
          style={{
            background: "var(--card-inner)",
            border: "1px solid var(--line-soft)",
            color: "var(--tx)",
          }}
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10.5px] font-mono" style={{ color: "var(--t4)" }}>
            {body.length}/{MAX_LEN}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!account || posting || !body.trim()}
            className="btn primary disabled:opacity-50"
            style={{ height: 30, padding: "0 14px", fontSize: 12 }}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
          Loading discussion…
        </p>
      ) : comments.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
          No comments yet. Be the first to weigh in.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-[12px] font-mono font-semibold"
                  style={{ color: "var(--accent-bright)" }}
                >
                  {c.authorShort}
                </span>
                <span className="text-[10.5px]" style={{ color: "var(--t4)" }}>
                  {timeAgo(c.createdAtIso)}
                </span>
                {mine && c.author.toLowerCase() === mine && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    aria-label="Delete comment"
                    className="ml-auto opacity-60 hover:opacity-100"
                    style={{ color: "var(--t3)" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p
                className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                style={{ color: "var(--t1, var(--tx))" }}
              >
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
