import { createHash } from "node:crypto";
import type { AgentDelta, AgentFinding } from "../shared/agent-output";

interface FindingSnapshotItem {
  readonly id: string;
  readonly fingerprint: string;
  readonly severity: AgentFinding["severity"];
}

interface FindingSnapshot {
  readonly items: FindingSnapshotItem[];
}

export type FindingDeltaCompareResult =
  | {
      readonly valid: true;
      readonly delta: AgentDelta;
      readonly currentFindings: AgentFinding[];
    }
  | {
      readonly valid: false;
    };

function tokenHash(snapshot: FindingSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
}

function snapshotFor(findings: readonly AgentFinding[]): FindingSnapshot {
  return {
    items: findings.map((finding) => ({
      id: finding.id,
      fingerprint: finding.fingerprint,
      severity: finding.severity
    }))
  };
}

export class FindingDeltaStore {
  private readonly snapshots = new Map<string, FindingSnapshot>();
  private nextId = 1;

  createToken(findings: readonly AgentFinding[]): string {
    const snapshot = snapshotFor(findings);
    const token = `delta-${this.nextId++}-${tokenHash(snapshot)}`;
    this.snapshots.set(token, snapshot);
    return token;
  }

  compare(token: string | undefined, currentFindings: readonly AgentFinding[]): FindingDeltaCompareResult {
    if (token === undefined) {
      return { valid: false };
    }

    const previous = this.snapshots.get(token);

    if (previous === undefined) {
      return { valid: false };
    }

    const previousById = new Map(previous.items.map((item) => [item.id, item]));
    const currentById = new Map(currentFindings.map((finding) => [finding.id, finding]));
    const newFindingIds: string[] = [];
    const changedFindingIds: string[] = [];
    const repeatedFindingIds: string[] = [];

    for (const finding of currentFindings) {
      const previousFinding = previousById.get(finding.id);

      if (previousFinding === undefined) {
        newFindingIds.push(finding.id);
        continue;
      }

      if (previousFinding.fingerprint !== finding.fingerprint) {
        changedFindingIds.push(finding.id);
        continue;
      }

      repeatedFindingIds.push(finding.id);
    }

    const resolvedFindingIds = previous.items
      .filter((item) => !currentById.has(item.id))
      .map((item) => item.id);
    const compactFindingIds = new Set([...newFindingIds, ...changedFindingIds]);
    const compactFindings = currentFindings.filter(
      (finding) => compactFindingIds.has(finding.id) || (finding.severity === "error" && repeatedFindingIds.includes(finding.id))
    );

    return {
      valid: true,
      delta: {
        sinceToken: token,
        newFindingIds,
        changedFindingIds,
        resolvedFindingIds,
        repeatedFindingIds
      },
      currentFindings: compactFindings
    };
  }
}

export const defaultFindingDeltaStore = new FindingDeltaStore();
