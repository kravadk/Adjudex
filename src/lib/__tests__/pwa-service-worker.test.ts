import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA service worker", () => {
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

  it("keeps API and user data requests network-only", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain("if (isApiRequest(url)) return;");
  });

  it("only pre-caches the offline shell", () => {
    expect(source).toContain('const SHELL_URLS = ["/offline"]');
    expect(source).not.toContain("/portfolio");
    expect(source).not.toContain("/market/");
  });
});
