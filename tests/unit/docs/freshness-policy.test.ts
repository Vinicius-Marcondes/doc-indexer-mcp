import { describe, expect, test } from "bun:test";
import { computeDocsFreshness } from "../../../src/docs/refresh/freshness-policy";

const now = "2026-05-14T12:00:00.000Z";

describe("docs freshness policy", () => {
  test("fresh, stale, missing, and refreshing states are computed", () => {
    expect(computeDocsFreshness({ page: null, now }).freshness).toBe("missing");
    expect(
      computeDocsFreshness({
        page: { expiresAt: "2026-05-21T12:00:00.000Z", tombstonedAt: null },
        now
      }).freshness
    ).toBe("fresh");
    expect(
      computeDocsFreshness({
        page: { expiresAt: "2026-05-01T12:00:00.000Z", tombstonedAt: null },
        now
      }).freshness
    ).toBe("stale");
    expect(
      computeDocsFreshness({
        page: { expiresAt: "2026-05-01T12:00:00.000Z", tombstonedAt: null },
        now,
        refreshPending: true
      }).freshness
    ).toBe("refreshing");
    expect(
      computeDocsFreshness({
        page: { expiresAt: "2026-05-21T12:00:00.000Z", tombstonedAt: "2026-05-13T12:00:00.000Z" },
        now
      }).freshness
    ).toBe("missing");
  });

  test("max stale age behavior matches configured policy", () => {
    const withinMax = computeDocsFreshness({
      page: { expiresAt: "2026-05-10T12:00:00.000Z", tombstonedAt: null },
      now,
      maxStaleAgeMs: 7 * 24 * 60 * 60 * 1000
    });
    const beyondMax = computeDocsFreshness({
      page: { expiresAt: "2026-04-01T12:00:00.000Z", tombstonedAt: null },
      now,
      maxStaleAgeMs: 7 * 24 * 60 * 60 * 1000
    });

    expect(withinMax.freshness).toBe("stale");
    expect(withinMax.beyondMaxStaleAge).toBe(false);
    expect(beyondMax.freshness).toBe("stale");
    expect(beyondMax.beyondMaxStaleAge).toBe(true);
    expect(beyondMax.staleAgeMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
  });
});
