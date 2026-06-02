import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MiniMarkdown } from "@/components/dashboard/mini-markdown";

export const metadata = {
  title: "Privacy Policy · Adjudex",
  description:
    "How Adjudex handles your data. Non-custodial, cookieless analytics, minimal off-chain footprint.",
};

export default function PrivacyPage() {
  let body = "";
  try {
    body = readFileSync(join(process.cwd(), "docs", "PRIVACY.md"), "utf-8");
  } catch {
    body =
      "# Privacy Policy\n\nThe privacy document is not available right now. Please contact support.";
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
