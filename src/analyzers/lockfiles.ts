import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Confidence, ResponseWarning } from "../shared/contracts";

const lockfileNames = ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

export type LockfileName = (typeof lockfileNames)[number];
export type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn" | "mixed" | "unknown";

export interface LockfileFileSystem {
  readonly exists: (path: string) => boolean;
}

export interface LockfilePresence {
  readonly bunLock: boolean;
  readonly bunLockb: boolean;
  readonly packageLock: boolean;
  readonly pnpmLock: boolean;
  readonly yarnLock: boolean;
  readonly present: LockfileName[];
  readonly foreign: Exclude<LockfileName, "bun.lock" | "bun.lockb">[];
}

export interface PackageManagerSignal {
  readonly name: PackageManagerName;
  readonly confidence: Confidence;
}

export interface LockfileAnalysis {
  readonly lockfiles: LockfilePresence;
  readonly packageManager: PackageManagerSignal;
  readonly warnings: ResponseWarning[];
}

function defaultFileSystem(): LockfileFileSystem {
  return {
    exists: existsSync
  };
}

function warning(id: string, title: string, detail: string, evidence: string[]): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence,
    sources: evidence.map((item) => `local-project:${item.replace("Found ", "")}`)
  };
}

function classify(lockfiles: LockfilePresence): PackageManagerSignal {
  const hasBun = lockfiles.bunLock || lockfiles.bunLockb;

  if (lockfiles.bunLock && lockfiles.foreign.length === 0) {
    return { name: "bun", confidence: "high" };
  }

  if (hasBun && lockfiles.foreign.length > 0) {
    return { name: "bun", confidence: "medium" };
  }

  if (lockfiles.bunLockb) {
    return { name: "bun", confidence: "medium" };
  }

  if (lockfiles.foreign.length > 1) {
    return { name: "mixed", confidence: "medium" };
  }

  if (lockfiles.packageLock) {
    return { name: "npm", confidence: "high" };
  }

  if (lockfiles.pnpmLock) {
    return { name: "pnpm", confidence: "high" };
  }

  if (lockfiles.yarnLock) {
    return { name: "yarn", confidence: "high" };
  }

  return { name: "unknown", confidence: "low" };
}

export function analyzeLockfiles(projectRoot: string, fileSystem: LockfileFileSystem = defaultFileSystem()): LockfileAnalysis {
  const present = lockfileNames.filter((name) => fileSystem.exists(resolve(projectRoot, name)));
  const foreign = present.filter(
    (name): name is Exclude<LockfileName, "bun.lock" | "bun.lockb"> => name !== "bun.lock" && name !== "bun.lockb"
  );
  const lockfiles: LockfilePresence = {
    bunLock: present.includes("bun.lock"),
    bunLockb: present.includes("bun.lockb"),
    packageLock: present.includes("package-lock.json"),
    pnpmLock: present.includes("pnpm-lock.yaml"),
    yarnLock: present.includes("yarn.lock"),
    present,
    foreign
  };
  const warnings: ResponseWarning[] = [];

  if ((lockfiles.bunLock || lockfiles.bunLockb) && lockfiles.foreign.length > 0) {
    warnings.push(
      warning(
        "mixed-lockfiles",
        "Mixed lockfiles detected",
        "Bun and non-Bun lockfiles coexist in this project.",
        lockfiles.present.map((name) => `Found ${name}`)
      )
    );
  }

  if (lockfiles.bunLockb && !lockfiles.bunLock) {
    warnings.push(
      warning("legacy-bun-lockb", "Legacy Bun binary lockfile detected", "Only legacy bun.lockb was found.", [
        "Found bun.lockb"
      ])
    );
  }

  return {
    lockfiles,
    packageManager: classify(lockfiles),
    warnings
  };
}
