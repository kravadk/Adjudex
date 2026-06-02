import { describe, expect, it } from "vitest";
import { resolveMarketLifecycle } from "../market-lifecycle";

describe("market lifecycle", () => {
  const nowMs = new Date("2026-05-31T12:00:00.000Z").getTime();

  it("keeps explicit terminal and review states from indexed status", () => {
    expect(resolveMarketLifecycle({ status: "draft", nowMs })).toBe("draft");
    expect(resolveMarketLifecycle({ status: "resolving", nowMs })).toBe("resolving");
    expect(resolveMarketLifecycle({ status: "resolved", nowMs })).toBe("resolved");
    expect(resolveMarketLifecycle({ status: "claimable", nowMs })).toBe("claimable");
    expect(resolveMarketLifecycle({ status: "archived", nowMs })).toBe("archived");
  });

  it("locks open markets after their real deadline", () => {
    expect(
      resolveMarketLifecycle({
        status: "open",
        deadlineIso: "2026-05-31T11:59:00.000Z",
        nowMs,
      }),
    ).toBe("locked");
  });

  it("keeps open markets open before deadline", () => {
    expect(
      resolveMarketLifecycle({
        status: "open",
        deadlineIso: "2026-05-31T12:01:00.000Z",
        nowMs,
      }),
    ).toBe("open");
  });

  it("treats a resolved outcome as resolved even if legacy status is stale", () => {
    expect(
      resolveMarketLifecycle({
        status: "open",
        resolvedOutcome: "YES",
        deadlineIso: "2026-05-31T12:01:00.000Z",
        nowMs,
      }),
    ).toBe("resolved");
  });
});
