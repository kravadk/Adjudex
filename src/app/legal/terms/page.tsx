import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MiniMarkdown } from "@/components/dashboard/mini-markdown";

export const metadata = {
  title: "Terms of Service · PariAI",
  description:
    "Terms governing your use of the PariAI parimutuel prediction-market protocol. Non-custodial, jurisdiction-restricted.",
};

// Serves docs/TERMS.md at /legal/terms. The doc file is the single source
// of truth — we don't keep a parallel copy in src/. read at request time
// (Node.js runtime) so doc edits don't require a redeploy.
export default function TermsPage() {
  let body = "";
  try {
    body = readFileSync(join(process.cwd(), "docs", "TERMS.md"), "utf-8");
  } catch {
    body =
      "# Terms of Service\n\nThe terms document is not available right now. Please contact support.";
  }
  return (
    <div className="px-[22px] py-7 max-w-[820px] mx-auto">
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-2"
        style={{ color: "var(--accent-bright)" }}
      >
        Legal
      </div>
      <MiniMarkdown text={body} />
    </div>
  );
}
