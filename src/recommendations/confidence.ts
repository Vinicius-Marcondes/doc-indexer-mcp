import type { CacheStatus, Confidence, ResponseWarning } from "../shared/contracts";

export interface ConfidenceInput {
  readonly cacheStatus?: CacheStatus;
  readonly officialSourceCount: number;
  readonly localEvidenceCount: number;
  readonly partialProjectData?: boolean;
  readonly parseFailureCount?: number;
}

export interface ConfidenceResult {
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
}

function warning(id: string, title: string, detail: string, evidence: string[]): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence,
    sources: ["local-project:confidence"]
  };
}

export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const warnings: ResponseWarning[] = [];
  const parseFailureCount = input.parseFailureCount ?? 0;

  if (parseFailureCount > 0) {
    warnings.push(
      warning("confidence-parse-failures", "Confidence lowered by parse failures", "One or more project files failed to parse.", [
        `parseFailureCount=${parseFailureCount}`
      ])
    );
  }

  if (input.cacheStatus === "stale") {
    warnings.push(
      warning("confidence-stale-cache", "Confidence lowered by stale cache", "Some source evidence came from stale cache.", [
        "cacheStatus=stale"
      ])
    );
  }

  if (input.partialProjectData === true) {
    warnings.push(
      warning(
        "confidence-partial-project-data",
        "Confidence lowered by partial project data",
        "Project evidence is incomplete or ambiguous.",
        ["partialProjectData=true"]
      )
    );
  }

  if (input.officialSourceCount === 0) {
    warnings.push(
      warning(
        "confidence-missing-official-sources",
        "Confidence lowered by missing official sources",
        "No official source evidence was available.",
        ["officialSourceCount=0"]
      )
    );
  }

  if (parseFailureCount > 0 || input.cacheStatus === "stale" || input.officialSourceCount === 0) {
    return {
      confidence: "low",
      warnings
    };
  }

  if (input.localEvidenceCount > 0 && input.partialProjectData !== true) {
    return {
      confidence: "high",
      warnings
    };
  }

  return {
    confidence: "medium",
    warnings
  };
}
