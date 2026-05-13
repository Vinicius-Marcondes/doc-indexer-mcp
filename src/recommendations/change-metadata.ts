import type { AgentChangeMetadata } from "../shared/agent-output";
import type { NpmVersionMetadata } from "../sources/npm-registry";

export interface NpmChangeMetadataInput {
  readonly version: NpmVersionMetadata;
  readonly agentTrainingCutoff?: string;
  readonly citationIds: string[];
}

export interface BunReleaseEvidenceInput {
  readonly content: string;
  readonly agentTrainingCutoff?: string;
  readonly citationIds: string[];
}

function isoDateFromTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function afterCutoff(sinceDate: string | undefined, cutoff: string | undefined): boolean | undefined {
  if (sinceDate === undefined || cutoff === undefined) {
    return undefined;
  }

  return Date.parse(sinceDate) > Date.parse(cutoff);
}

function releaseVersionFrom(content: string): string | undefined {
  const match = /\bBun\s+v?(\d+\.\d+\.\d+)\b/iu.exec(content) ?? /\bbun-v(\d+\.\d+\.\d+)\b/iu.exec(content);
  return match?.[1];
}

function releaseDateFrom(content: string): string | undefined {
  const match = /\b(\d{4}-\d{2}-\d{2})\b/u.exec(content);
  return match?.[1];
}

function breakingFrom(content: string): boolean | undefined {
  return /\bbreaking\s+change\b/iu.test(content) || /\bbreaking\b/iu.test(content) ? true : undefined;
}

export function changeMetadataFromNpmVersion(input: NpmChangeMetadataInput): AgentChangeMetadata | undefined {
  const sinceDate = isoDateFromTimestamp(input.version.publishedAt);

  if (sinceDate === undefined) {
    return undefined;
  }

  const cutoffResult = afterCutoff(sinceDate, input.agentTrainingCutoff);

  return {
    sinceDate,
    ...(cutoffResult === undefined ? {} : { afterAgentTrainingCutoff: cutoffResult }),
    evidence: "npm-publish-time",
    citationIds: input.citationIds
  };
}

export function changeMetadataFromBunReleaseEvidence(input: BunReleaseEvidenceInput): AgentChangeMetadata | undefined {
  const sinceVersion = releaseVersionFrom(input.content);
  const sinceDate = releaseDateFrom(input.content);

  if (sinceVersion === undefined && sinceDate === undefined) {
    return undefined;
  }

  const cutoffResult = afterCutoff(sinceDate, input.agentTrainingCutoff);
  const breaking = breakingFrom(input.content);

  return {
    ...(sinceVersion === undefined ? {} : { sinceVersion }),
    ...(sinceDate === undefined ? {} : { sinceDate }),
    ...(breaking === undefined ? {} : { breaking }),
    ...(cutoffResult === undefined ? {} : { afterAgentTrainingCutoff: cutoffResult }),
    evidence: "official-source",
    citationIds: input.citationIds
  };
}
