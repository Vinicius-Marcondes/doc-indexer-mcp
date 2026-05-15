import { describe, expect, test } from "bun:test";
import {
  calculateEmbeddingCoverage,
  calculateRate,
  classifyPageFreshness,
  getAdminKpiWindowStart,
  normalizePagination,
  parseAdminKpiWindow
} from "../../../apps/admin-console/server/src/read-models";

describe("admin read model helpers", () => {
  test("KPI window parsing defaults to 24h and accepts supported windows", () => {
    expect(parseAdminKpiWindow(undefined)).toBe("24h");
    expect(parseAdminKpiWindow("")).toBe("24h");
    expect(parseAdminKpiWindow("1h")).toBe("1h");
    expect(parseAdminKpiWindow("24h")).toBe("24h");
    expect(parseAdminKpiWindow("7d")).toBe("7d");
    expect(parseAdminKpiWindow("30d")).toBe("30d");
    expect(() => parseAdminKpiWindow("90d")).toThrow("Unsupported admin KPI window");
  });

  test("KPI window start is anchored to the supplied clock", () => {
    const now = "2026-05-14T12:00:00.000Z";

    expect(getAdminKpiWindowStart("1h", now)).toBe("2026-05-14T11:00:00.000Z");
    expect(getAdminKpiWindowStart("24h", now)).toBe("2026-05-13T12:00:00.000Z");
    expect(getAdminKpiWindowStart("7d", now)).toBe("2026-05-07T12:00:00.000Z");
    expect(getAdminKpiWindowStart("30d", now)).toBe("2026-04-14T12:00:00.000Z");
  });

  test("KPI rates are null when there is no denominator and bounded otherwise", () => {
    expect(calculateRate(0, 0)).toBeNull();
    expect(calculateRate(1, 4)).toBe(0.25);
    expect(calculateRate(5, 4)).toBe(1);
    expect(calculateEmbeddingCoverage({ chunkCount: 0, embeddedChunkCount: 0 })).toBeNull();
    expect(calculateEmbeddingCoverage({ chunkCount: 3, embeddedChunkCount: 2 })).toBe(2 / 3);
    expect(calculateEmbeddingCoverage({ chunkCount: 3, embeddedChunkCount: 4 })).toBe(1);
  });

  test("page freshness uses tombstone, expiry, and source TTL semantics", () => {
    const now = "2026-05-14T12:00:00.000Z";
    const defaultTtlSeconds = 3600;

    expect(
      classifyPageFreshness({
        now,
        defaultTtlSeconds,
        expiresAt: "2026-05-14T13:00:00.000Z",
        tombstonedAt: null
      })
    ).toBe("fresh");
    expect(
      classifyPageFreshness({
        now,
        defaultTtlSeconds,
        expiresAt: "2026-05-14T11:30:00.000Z",
        tombstonedAt: null
      })
    ).toBe("stale");
    expect(
      classifyPageFreshness({
        now,
        defaultTtlSeconds,
        expiresAt: "2026-05-14T10:30:00.000Z",
        tombstonedAt: null
      })
    ).toBe("expired");
    expect(
      classifyPageFreshness({
        now,
        defaultTtlSeconds,
        expiresAt: "2026-05-14T13:00:00.000Z",
        tombstonedAt: "2026-05-14T11:59:00.000Z"
      })
    ).toBe("tombstoned");
  });

  test("pagination clamps limits and rejects invalid cursor values", () => {
    expect(normalizePagination({})).toEqual({ limit: 50, cursor: null });
    expect(normalizePagination({ limit: 500, cursor: 12 })).toEqual({ limit: 100, cursor: 12 });
    expect(normalizePagination({ limit: -5 })).toEqual({ limit: 1, cursor: null });
    expect(() => normalizePagination({ cursor: -1 })).toThrow("Pagination cursor");
    expect(() => normalizePagination({ limit: 1.5 })).toThrow("Pagination limit");
  });
});
