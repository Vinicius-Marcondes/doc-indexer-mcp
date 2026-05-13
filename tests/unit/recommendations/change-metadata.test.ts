import { describe, expect, test } from "bun:test";
import {
  changeMetadataFromBunReleaseEvidence,
  changeMetadataFromNpmVersion
} from "../../../src/recommendations/change-metadata";
import type { NpmVersionMetadata } from "../../../src/sources/npm-registry";

function version(overrides: Partial<NpmVersionMetadata> = {}): NpmVersionMetadata {
  return {
    version: "2.0.0",
    peerDependencies: {},
    engines: {},
    ...overrides
  };
}

describe("change metadata", () => {
  test("npm publish time can populate sinceDate", () => {
    expect(
      changeMetadataFromNpmVersion({
        version: version({ publishedAt: "2026-01-02T03:04:05.000Z" }),
        citationIds: ["c-npm"]
      })
    ).toEqual({
      sinceDate: "2026-01-02",
      evidence: "npm-publish-time",
      citationIds: ["c-npm"]
    });
  });

  test("official release metadata can populate sinceVersion when fixture source includes it", () => {
    expect(
      changeMetadataFromBunReleaseEvidence({
        content: "Bun v1.3.13 was released on 2026-05-11 with runtime updates.",
        citationIds: ["c-release"]
      })
    ).toEqual({
      sinceVersion: "1.3.13",
      sinceDate: "2026-05-11",
      evidence: "official-source",
      citationIds: ["c-release"]
    });
  });

  test("missing source date omits afterAgentTrainingCutoff", () => {
    expect(
      changeMetadataFromBunReleaseEvidence({
        content: "Bun v1.3.13 includes runtime updates.",
        agentTrainingCutoff: "2025-01-01",
        citationIds: ["c-release"]
      })
    ).toEqual({
      sinceVersion: "1.3.13",
      evidence: "official-source",
      citationIds: ["c-release"]
    });
  });

  test("cutoff comparison is true only when source date is later", () => {
    expect(
      changeMetadataFromNpmVersion({
        version: version({ publishedAt: "2026-01-02T03:04:05.000Z" }),
        agentTrainingCutoff: "2025-01-01",
        citationIds: ["c-npm"]
      })?.afterAgentTrainingCutoff
    ).toBe(true);

    expect(
      changeMetadataFromNpmVersion({
        version: version({ publishedAt: "2024-01-02T03:04:05.000Z" }),
        agentTrainingCutoff: "2025-01-01",
        citationIds: ["c-npm"]
      })?.afterAgentTrainingCutoff
    ).toBe(false);
  });

  test("breaking flag is omitted unless source metadata supports it", () => {
    expect(
      changeMetadataFromBunReleaseEvidence({
        content: "Bun v1.3.13 was released on 2026-05-11.",
        citationIds: ["c-release"]
      })?.breaking
    ).toBeUndefined();

    expect(
      changeMetadataFromBunReleaseEvidence({
        content: "Bun v1.3.13 was released on 2026-05-11. Breaking change: updated behavior.",
        citationIds: ["c-release"]
      })?.breaking
    ).toBe(true);
  });
});
